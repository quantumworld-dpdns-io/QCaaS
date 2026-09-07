from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from qiskit import QuantumCircuit

from ...schemas.common import Constraints, OptimizationBackend
from ...schemas.optimize import CircuitMetrics
from ..circuits import LoadedCircuit


@dataclass
class OptimizationRequest:
    target_backend: str
    optimization_level: int = 2
    constraints: Constraints = field(default_factory=Constraints)
    seed: int | None = 42


@dataclass
class OptimizationOutcome:
    backend: OptimizationBackend
    status: str  # success | error | timeout | not_applicable | skipped
    reason: str | None = None
    circuit: QuantumCircuit | None = None  # ISA circuit for the target (if any)
    metrics: CircuitMetrics | None = None
    qasm: str | None = None
    qasm_format: str = "openqasm3"
    layout: dict[str, int] | None = None
    duration_ms: int | None = None
    extra: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "success" and self.metrics is not None


class OptimizerBackend(Protocol):
    name: OptimizationBackend

    def optimize(self, loaded: LoadedCircuit, req: OptimizationRequest) -> OptimizationOutcome: ...
