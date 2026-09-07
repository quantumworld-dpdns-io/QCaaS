"""Circuit metrics: depth, gate counts, width and a critical-path duration estimate."""

from __future__ import annotations

from dataclasses import dataclass

from qiskit import QuantumCircuit
from qiskit.converters import circuit_to_dag

from ..schemas.common import Constraints
from ..schemas.optimize import CircuitMetrics

NON_GATE_OPS = {"barrier", "measure", "reset", "delay"}


@dataclass(frozen=True)
class DurationDefaults:
    one_qubit_sec: float = 6.0e-8
    two_qubit_sec: float = 5.0e-7
    measure_sec: float = 1.2e-6


def gate_count(qc: QuantumCircuit) -> int:
    return sum(v for k, v in qc.count_ops().items() if k not in NON_GATE_OPS)


def active_width(qc: QuantumCircuit) -> int:
    used = set()
    for inst in qc.data:
        if inst.operation.name == "barrier":
            continue
        used.update(qc.find_bit(q).index for q in inst.qubits)
    return len(used)


def physical_qubits(qc: QuantumCircuit) -> list[int]:
    used = set()
    for inst in qc.data:
        if inst.operation.name == "barrier":
            continue
        used.update(qc.find_bit(q).index for q in inst.qubits)
    return sorted(used)


def _op_duration(name: str, qargs: tuple[int, ...], target, defaults: DurationDefaults) -> float:
    if name == "barrier":
        return 0.0
    if target is not None and name in target:
        props = target[name].get(qargs)
        dur = getattr(props, "duration", None) if props is not None else None
        if dur:
            return float(dur)
    if name == "measure":
        return defaults.measure_sec
    if name in {"delay", "reset"}:
        return defaults.one_qubit_sec
    return defaults.two_qubit_sec if len(qargs) >= 2 else defaults.one_qubit_sec


def critical_path_duration(
    qc: QuantumCircuit, target=None, defaults: DurationDefaults | None = None
) -> float:
    """Longest qubit-time path through the circuit, in seconds."""
    defaults = defaults or DurationDefaults()
    dag = circuit_to_dag(qc)
    qubit_time = dict.fromkeys(qc.qubits, 0.0)
    for node in dag.topological_op_nodes():
        qargs = tuple(qc.find_bit(q).index for q in node.qargs)
        d = _op_duration(node.op.name, qargs, target, defaults)
        start = max((qubit_time[q] for q in node.qargs), default=0.0)
        end = start + d
        for q in node.qargs:
            qubit_time[q] = end
    return max(qubit_time.values(), default=0.0)


def check_constraints(m: CircuitMetrics, c: Constraints | None) -> list[str]:
    if c is None:
        return []
    v: list[str] = []
    if c.max_depth is not None and m.depth > c.max_depth:
        v.append(f"depth {m.depth} exceeds max_depth {c.max_depth}")
    if c.max_width is not None and m.width > c.max_width:
        v.append(f"width {m.width} exceeds max_width {c.max_width}")
    if c.max_gate_count is not None and m.gate_count > c.max_gate_count:
        v.append(f"gate_count {m.gate_count} exceeds max_gate_count {c.max_gate_count}")
    return v


def compute_metrics(
    qc: QuantumCircuit,
    target=None,
    constraints: Constraints | None = None,
    defaults: DurationDefaults | None = None,
) -> CircuitMetrics:
    m = CircuitMetrics(
        depth=qc.depth(lambda inst: inst.operation.name not in {"barrier"}),
        gate_count=gate_count(qc),
        two_qubit_gate_count=qc.num_nonlocal_gates(),
        width=active_width(qc),
        estimated_duration_sec=critical_path_duration(qc, target, defaults),
    )
    m.constraint_violations = check_constraints(m, constraints)
    return m
