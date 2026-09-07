"""Local simulation with Qiskit Aer (ideal or with the target's noise model)."""

from __future__ import annotations

from qiskit import QuantumCircuit

from ..schemas.optimize import SimulationResult
from .circuits.loader import ensure_measured

MAX_SIM_QUBITS = 28


def simulate(qc: QuantumCircuit, shots: int, backend=None, noisy: bool = False, seed: int = 7) -> SimulationResult:
    from qiskit_aer import AerSimulator
    from qiskit_aer.primitives import SamplerV2

    from .metrics import active_width

    if active_width(qc) > MAX_SIM_QUBITS:
        raise ValueError(f"simulation limited to {MAX_SIM_QUBITS} active qubits")

    circ = ensure_measured(qc)
    if noisy and backend is not None:
        sim = AerSimulator.from_backend(backend)
        sampler = SamplerV2.from_backend(backend, seed_simulator=seed)
    else:
        sim = AerSimulator()
        sampler = SamplerV2(seed=seed)
    # ISA circuits use the backend basis (ecr/rz/sx/x); Aer supports them directly, but
    # a wide transpiled circuit carries idle qubits - strip them so the statevector stays small.
    circ = _strip_idle_qubits(circ)
    del sim  # AerSimulator only used for noise-model construction inside from_backend
    result = sampler.run([circ], shots=shots).result()[0]
    counts = {k: int(v) for k, v in result.join_data().get_counts().items()}
    total = sum(counts.values()) or 1
    probs = {k: round(v / total, 6) for k, v in sorted(counts.items(), key=lambda kv: -kv[1])}
    return SimulationResult(counts=counts, probabilities=probs, shots=shots, noisy=noisy)


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
