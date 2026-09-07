from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .common import Billing, BudgetPlan, ResultFormat
from .optimize import Interpretation, InterpretContext


class InterpretRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "result_format": "counts_dict",
                    "result_payload": {"00": 480, "11": 496, "01": 24, "10": 24},
                    "context": {
                        "algorithm": "QAOA",
                        "problem_description": "portfolio optimization with 10 assets",
                        "target_metric": "maximize probability of low-energy states",
                    },
                    "target_bitstrings": ["00", "11"],
                }
            ]
        }
    )
    result_format: ResultFormat
    result_payload: dict[str, Any] | str
    context: InterpretContext | None = None
    target_bitstrings: list[str] | None = None
    target_backend: str | None = Field(
        default=None, description="If given, backend error rates are included in the analysis."
    )
    physical_qubits: list[int] | None = Field(
        default=None, description="Physical qubits the job ran on (enables readout-error analysis)."
    )
    budget_mode: BudgetPlan = BudgetPlan.payg


class InterpretResponse(BaseModel):
    job_id: str
    summary: str
    key_metrics: dict[str, Any]
    noise_analysis: list[dict[str, Any]]
    business_interpretation: str
    recommendations: list[str]
    next_steps: list[str]
    confidence: str
    interpretation: Interpretation
    billing: Billing
    created_at: str
