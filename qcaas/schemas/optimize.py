from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .common import (
    Billing,
    BudgetPlan,
    CircuitFormat,
    Constraints,
    OptimizationBackend,
    RedundancyMode,
)


class CircuitInput(BaseModel):
    circuit_format: CircuitFormat
    circuit_payload: str | dict[str, Any] = Field(
        description="Source text (QASM2/QASM3/Qmod) or a JSON gate-list object."
    )
    target_backend: str = Field(default="ibm_sherbrooke", examples=["ibm_sherbrooke"])
    optimization_level: int = Field(default=2, ge=0, le=3)
    shots: int = Field(default=1024, ge=1, le=100_000)
    budget_mode: BudgetPlan = BudgetPlan.payg
    optimization_backend: OptimizationBackend = OptimizationBackend.auto
    constraints: Constraints = Field(default_factory=Constraints)
    redundancy_mode: RedundancyMode = Field(default_factory=RedundancyMode)


class OptimizeRequest(CircuitInput):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "circuit_format": "openqasm2",
                    "circuit_payload": (
                        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n'
                        "h q[0];\ncx q[0],q[1];\nmeasure q -> c;\n"
                    ),
                    "target_backend": "ibm_sherbrooke",
                    "optimization_level": 2,
                    "include_simulation": True,
                    "shots": 1024,
                    "budget_mode": "payg",
                    "optimization_backend": "auto",
                    "redundancy_mode": {"mode": "fallback", "primary": "ibm_composer"},
                }
            ]
        }
    )
    include_simulation: bool = True
    noisy_simulation: bool = Field(
        default=False, description="Simulate with the target backend's noise model (slower)."
    )
    execute_on_qpu: bool = Field(
        default=False,
        description="Submit the selected circuit to real IBM hardware. Requires server opt-in.",
    )
    target_bitstrings: list[str] | None = Field(
        default=None, description="Bitstrings considered 'success' for the interpretation."
    )
    context: InterpretContext | None = None


class InterpretContext(BaseModel):
    algorithm: str | None = Field(default=None, examples=["QAOA", "VQE"])
    problem_description: str | None = None
    target_metric: str | None = None


class CircuitMetrics(BaseModel):
    depth: int
    gate_count: int
    two_qubit_gate_count: int
    width: int
    estimated_duration_sec: float | None = Field(
        default=None, description="Critical-path duration of one shot on the target."
    )
    constraint_violations: list[str] = Field(default_factory=list)


class BackendResult(BaseModel):
    backend: OptimizationBackend
    status: str = Field(description="success | error | timeout | not_applicable | skipped")
    reason: str | None = None
    depth: int | None = None
    gate_count: int | None = None
    two_qubit_gate_count: int | None = None
    width: int | None = None
    estimated_qpu_runtime_sec: float | None = None
    estimated_qpu_cost_usd: float | None = None
    duration_ms: int | None = None
    transpiled_circuit: TranspiledCircuit | None = None
    metrics: CircuitMetrics | None = None


class TranspiledCircuit(BaseModel):
    format: str = Field(description="openqasm3 | openqasm2 | qmod")
    source: str
    layout: dict[str, int] | None = Field(
        default=None, description="virtual qubit index (str) -> physical qubit."
    )


class SelectedResult(BaseModel):
    backend: OptimizationBackend
    reason: str
    depth: int | None = None
    gate_count: int | None = None


class SimulationResult(BaseModel):
    counts: dict[str, int]
    probabilities: dict[str, float]
    shots: int
    noisy: bool = False


class NoiseConcern(BaseModel):
    kind: str
    location: str
    value: float
    message: str


class Interpretation(BaseModel):
    summary: str
    success_probability: float | None = None
    key_metrics: dict[str, Any] = Field(default_factory=dict)
    noise_concerns: list[str] = Field(default_factory=list)
    noise_analysis: list[NoiseConcern] = Field(default_factory=list)
    business_interpretation: str
    recommendations: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    confidence: str = Field(description="low | medium | high")


class QpuExecution(BaseModel):
    submitted: bool
    ibm_job_id: str | None = None
    status: str | None = None
    usage_estimation_sec: float | None = None
    actual_usage_sec: float | None = None
    counts: dict[str, int] | None = None
    message: str | None = None


class OptimizeResponse(BaseModel):
    job_id: str
    status: str
    target_backend: str
    backends_used: list[OptimizationBackend]
    results: dict[str, BackendResult]
    selected_result: SelectedResult
    transpiled_circuit: TranspiledCircuit | None
    gate_count_before: int
    gate_count_after: int | None
    depth_before: int
    depth_after: int | None
    estimated_qpu_runtime_sec: float | None
    estimated_qpu_cost_usd: float | None
    simulation_result: SimulationResult | None
    interpretation: Interpretation | None
    qpu_execution: QpuExecution | None = None
    billing: Billing
    created_at: str


OptimizeRequest.model_rebuild()
