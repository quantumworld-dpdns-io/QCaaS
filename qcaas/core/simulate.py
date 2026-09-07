"""Local simulation with Qiskit Aer (ideal or with the target's noise model)."""

from __future__ import annotations

from qiskit import QuantumCircuit

from ..schemas.optimize import SimulationResult
from .circuits.loader import ensure_measured

MAX_SIM_QUBITS = 28


def simulate(qc: QuantumCircuit, shots: int, backend=None, noisy: bool = False, seed: int = 7) -> SimulationResult:
    from qiskit_aer.noise import NoiseModel
    from qiskit_aer.primitives import SamplerV2

    from .metrics import active_width

    if active_width(qc) > MAX_SIM_QUBITS:
        raise ValueError(f"simulation limited to {MAX_SIM_QUBITS} active qubits")

    circ = ensure_measured(qc)
    if noisy and backend is not None:
        # Noise model is keyed by physical qubit, so the circuit must keep its full width.
        noise_model = NoiseModel.from_backend(backend)
        sampler = SamplerV2(
            seed=seed,
            options={"backend_options": {"noise_model": noise_model, "method": "automatic"}},
        )
        # Keep physical qubit indices; only drop qubits above the highest used one so the
        # statevector stays tractable (idle low-index qubits are cheap in MPS/automatic).
        circ = _truncate_to_used_qubits(circ)
    else:
        sampler = SamplerV2(seed=seed)
        # ISA circuits carry idle qubits; strip them so the statevector stays small.
        circ = _strip_idle_qubits(circ)
    result = sampler.run([circ], shots=shots).result()[0]
    counts = {k: int(v) for k, v in result.join_data().get_counts().items()}
    total = sum(counts.values()) or 1
    probs = {k: round(v / total, 6) for k, v in sorted(counts.items(), key=lambda kv: -kv[1])}
    return SimulationResult(counts=counts, probabilities=probs, shots=shots, noisy=noisy)


def _truncate_to_used_qubits(qc: QuantumCircuit) -> QuantumCircuit:
    """Drop qubits above the highest-index used qubit, preserving physical indices below it."""
    hi = -1
    for inst in qc.data:
        for q in inst.qubits:
            hi = max(hi, qc.find_bit(q).index)
    if hi < 0 or hi + 1 == qc.num_qubits:
        return qc
    out = QuantumCircuit(hi + 1, qc.num_clbits)
    for inst in qc.data:
        qargs = [out.qubits[qc.find_bit(q).index] for q in inst.qubits]
        cargs = [out.clbits[qc.find_bit(c).index] for c in inst.clbits]
        out.append(inst.operation, qargs, cargs)
    return out


def _strip_idle_qubits(qc: QuantumCircuit) -> QuantumCircuit:
    used = []
    seen = set()
    for inst in qc.data:
        for q in inst.qubits:
            i = qc.find_bit(q).index
            if i not in seen:
                seen.add(i)
                used.append(i)
    if len(used) == qc.num_qubits:
        return qc
    used.sort()
    remap = {old: new for new, old in enumerate(used)}
    out = QuantumCircuit(len(used), qc.num_clbits)
    for inst in qc.data:
        qargs = [out.qubits[remap[qc.find_bit(q).index]] for q in inst.qubits]
        cargs = [out.clbits[qc.find_bit(c).index] for c in inst.clbits]
        out.append(inst.operation, qargs, cargs)
    return out
