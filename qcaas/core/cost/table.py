"""Pricing spreadsheet generator (docs/pricing.csv) reproducing the spec's workload table."""

from __future__ import annotations

import csv
import io

from ...schemas.common import BudgetPlan
from .pricing import Pricing

# (label, qpu_seconds, shots) - the QPU-second assumptions used in the spec.
WORKLOADS = [
    ("Small experiment (5q, 50 gates)", 5.0, 1024),
    ("Medium optimization (10q, 150 gates)", 20.0, 4096),
    ("Large VQE/QAOA (15q, 300 gates)", 60.0, 8192),
]

COLUMNS = [
    "workload", "backend", "plan", "shots", "qpu_seconds", "qpu_cost_usd", "service_cost_usd",
    "classiq_platform_fee_usd", "total_cost_usd", "service_fee_usd", "suggested_price_usd",
    "service_margin",
]  # fmt: skip


def pricing_rows(pricing: Pricing) -> list[dict]:
    saving = float(pricing.classiq.get("assumed_qpu_seconds_saving", 0.0))
    rows = []
    for label, secs, shots in WORKLOADS:
        for backend, eff in (("ibm_composer", secs), ("classiq", round(secs * (1 - saving), 4))):
            for plan in BudgetPlan:
                used_classiq = backend == "classiq"
                b = pricing.internal_breakdown(plan, eff, used_classiq)
                rows.append(
                    {
                        "workload": label,
                        "backend": backend,
                        "plan": plan.value,
                        "shots": shots,
                        "qpu_seconds": eff,
                        "qpu_cost_usd": b["qpu_cost_usd"],
                        "service_cost_usd": b["service_cost_usd"],
                        "classiq_platform_fee_usd": b["classiq_platform_fee_usd"],
                        "total_cost_usd": b["total_cost_usd"],
                        "service_fee_usd": b["service_fee_usd"],
                        "suggested_price_usd": b["total_price_usd"],
                        "service_margin": b["service_margin"],
                    }
                )
    return rows


def pricing_csv(pricing: Pricing) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    w.writeheader()
    w.writerows(pricing_rows(pricing))
    return buf.getvalue()
