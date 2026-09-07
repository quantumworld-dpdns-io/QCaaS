from __future__ import annotations

from pydantic import BaseModel, Field

from .common import Billing, BudgetPlan, OptimizationBackend
from .optimize import CircuitInput


class QuoteRequest(CircuitInput):
    pass


class BackendEstimate(BaseModel):
    backend: OptimizationBackend
    status: str = Field(description="estimated | assumed | not_applicable | error")
    note: str | None = None
    depth: int | None = None
    gate_count: int | None = None
    estimated_qpu_runtime_sec: float | None = None
    estimated_qpu_cost_usd: dict[BudgetPlan, float] | None = Field(
        default=None, description="Cost per plan for this backend."
    )


class QuoteResponse(BaseModel):
    quote_id: str
    target_backend: str
    shots: int
    plan: BudgetPlan
    estimates: dict[str, BackendEstimate]
    recommended_backend: OptimizationBackend
    recommendation_reason: str
    estimated_qpu_runtime_sec: float
    estimated_qpu_cost_usd: float
    service_fee_usd: float
    total_usd: float
    billing: Billing
    valid_until: str
    created_at: str
