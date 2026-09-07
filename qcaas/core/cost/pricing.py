"""Pricing table (pricing.yaml) and billing computation."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from ...schemas.common import Billing, BudgetPlan


@dataclass(frozen=True)
class Pricing:
    qpu_plans: dict[str, float]
    service_costs: dict[str, float]
    service_margin: float
    min_service_fee: float
    classiq: dict
    estimation: dict

    # ---- primitives ---------------------------------------------------------------
    def qpu_rate_per_sec(self, plan: BudgetPlan | str) -> float:
        key = plan.value if isinstance(plan, BudgetPlan) else plan
        return self.qpu_plans[key] / 60.0

    def qpu_cost(self, qpu_seconds: float, plan: BudgetPlan | str) -> float:
        return round(max(qpu_seconds, 0.0) * self.qpu_rate_per_sec(plan), 2)

    @property
    def classiq_fee_per_job(self) -> float:
        c = self.classiq
        jobs = max(int(c.get("jobs_per_month", 1)), 1) * 12
        return round(float(c.get("annual_contract_usd", 0.0)) / jobs, 2)

    def service_cost(
        self, classical_minutes: float | None = None, engineer_minutes: float = 0.0
    ) -> float:
        sc = self.service_costs
        if classical_minutes is None:
            classical_minutes = float(self.estimation.get("classical_minutes_per_job", 0.0))
        return (
            float(sc.get("api_fee_per_request", 0.0))
            + classical_minutes * float(sc.get("classical_compute_per_min", 0.0))
            + engineer_minutes * float(sc.get("engineer_review_per_min", 0.0))
        )

    def service_fee(
        self, classical_minutes: float | None = None, engineer_minutes: float = 0.0
    ) -> float:
        cost = self.service_cost(classical_minutes, engineer_minutes)
        fee = cost / (1.0 - self.service_margin) if self.service_margin < 1 else cost
        return round(max(fee, self.min_service_fee), 2)

    # ---- billing block ------------------------------------------------------------
    def billing(
        self,
        plan: BudgetPlan,
        qpu_seconds: float,
        used_classiq: bool = False,
        classical_minutes: float | None = None,
        engineer_minutes: float = 0.0,
        actual_qpu_seconds: float | None = None,
    ) -> Billing:
        qpu = self.qpu_cost(qpu_seconds, plan)
        fee = self.service_fee(classical_minutes, engineer_minutes)
        classiq_fee: float | None = None
        if used_classiq:
            if self.classiq.get("visible_to_customer", True):
                classiq_fee = self.classiq_fee_per_job
            else:
                fee = round(fee + self.classiq_fee_per_job, 2)
        actual = self.qpu_cost(actual_qpu_seconds, plan) if actual_qpu_seconds is not None else None
        total = round((actual if actual is not None else qpu) + fee + (classiq_fee or 0.0), 2)
        return Billing(
            plan=plan,
            qpu_cost_usd=qpu,
            service_fee_usd=fee,
            classiq_platform_fee_usd=classiq_fee,
            actual_qpu_cost_usd=actual,
            total_usd=total,
        )

    def internal_breakdown(self, plan: BudgetPlan, qpu_seconds: float, used_classiq: bool) -> dict:
        b = self.billing(plan, qpu_seconds, used_classiq)
        cost = self.service_cost() + (self.classiq_fee_per_job if used_classiq else 0.0)
        return {
            "plan": plan.value,
            "qpu_cost_usd": b.qpu_cost_usd,
            "service_cost_usd": round(cost, 4),
            "service_fee_usd": b.service_fee_usd,
            "classiq_platform_fee_usd": self.classiq_fee_per_job if used_classiq else 0.0,
            "total_cost_usd": round(b.qpu_cost_usd + cost, 2),
            "total_price_usd": b.total_usd,
            "service_margin": round(
                1 - cost / (b.service_fee_usd + (b.classiq_platform_fee_usd or 0.0)), 3
            )
            if (b.service_fee_usd + (b.classiq_platform_fee_usd or 0.0)) > 0
            else 0.0,
        }


def load_pricing(path: Path | str) -> Pricing:
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return Pricing(
        qpu_plans={k: float(v) for k, v in raw["qpu_plans"].items()},
        service_costs={k: float(v) for k, v in raw.get("service_costs", {}).items()},
        service_margin=float(raw.get("service_margin", 0.6)),
        min_service_fee=float(raw.get("min_service_fee", 0.05)),
        classiq=dict(raw.get("classiq", {})),
        estimation={k: float(v) for k, v in raw.get("estimation", {}).items()},
    )


@lru_cache(maxsize=4)
def get_pricing(path: Path | str) -> Pricing:
    return load_pricing(Path(path))
