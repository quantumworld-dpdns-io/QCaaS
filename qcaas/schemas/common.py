from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class CircuitFormat(StrEnum):
    qiskit_python = "qiskit_python"
    openqasm2 = "openqasm2"
    openqasm3 = "openqasm3"
    json = "json"
    qmod = "qmod"


class OptimizationBackend(StrEnum):
    ibm_composer = "ibm_composer"
    classiq = "classiq"
    auto = "auto"


class RedundancyModeName(StrEnum):
    single = "single"
    parallel = "parallel"
    fallback = "fallback"


class BudgetPlan(StrEnum):
    payg = "payg"
    flex = "flex"
    premium = "premium"


class SelectionMetric(StrEnum):
    qpu_cost = "qpu_cost"
    depth = "depth"
    gate_count = "gate_count"


class ResultFormat(StrEnum):
    ibm_job_result_json = "ibm_job_result_json"
    counts_dict = "counts_dict"
    csv = "csv"


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_depth: int | None = Field(default=None, ge=1)
    max_width: int | None = Field(default=None, ge=1)
    max_gate_count: int | None = Field(default=None, ge=1)
    error_bound: float | None = Field(
        default=None, gt=0, le=1, description="Classiq only: approximation error bound."
    )


class RedundancyMode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: RedundancyModeName = RedundancyModeName.fallback
    primary: OptimizationBackend = OptimizationBackend.ibm_composer
    timeout_sec: float | None = Field(
        default=None, gt=0, le=600, description="Override the server fallback timeout."
    )
    selection_metric: SelectionMetric = SelectionMetric.qpu_cost


class Billing(BaseModel):
    plan: BudgetPlan
    qpu_cost_usd: float
    service_fee_usd: float
    classiq_platform_fee_usd: float | None = Field(
        default=None, description="Present only when the Classiq fee is itemised."
    )
    actual_qpu_cost_usd: float | None = None
    total_usd: float


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    code: str
