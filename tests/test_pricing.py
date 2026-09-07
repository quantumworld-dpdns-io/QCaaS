"""Pricing must reproduce the numbers in the spec (.ignore/specs.txt, section 三)."""

import csv
import io

import pytest

from qcaas.core.cost.estimator import assumed_classiq_seconds, estimate_qpu_seconds
from qcaas.core.cost.table import pricing_csv
from qcaas.schemas.common import BudgetPlan


@pytest.mark.parametrize(
    ("plan", "seconds", "expected"),
    [
        (BudgetPlan.payg, 5, 8.00),
        (BudgetPlan.payg, 20, 32.00),
        (BudgetPlan.payg, 60, 96.00),
        (BudgetPlan.flex, 20, 24.00),
        (BudgetPlan.premium, 20, 16.00),
        (BudgetPlan.payg, 17, 27.20),  # Medium workload via Classiq (-15 %)
    ],
)
def test_qpu_cost_matches_spec(pricing, plan, seconds, expected):
    assert pricing.qpu_cost(seconds, plan) == expected


def test_classiq_platform_fee_amortisation(pricing):
    # $50k / (2000 jobs * 12 months) = $2.08
    assert pricing.classiq_fee_per_job == 2.08


def test_billing_block_ibm(pricing):
    b = pricing.billing(BudgetPlan.payg, 20.0, used_classiq=False)
    assert b.qpu_cost_usd == 32.00
    assert b.classiq_platform_fee_usd is None
    assert b.service_fee_usd >= pricing.min_service_fee
    assert b.total_usd == round(b.qpu_cost_usd + b.service_fee_usd, 2)


def test_billing_block_classiq_itemised(pricing):
    b = pricing.billing(BudgetPlan.payg, 17.0, used_classiq=True)
    assert b.qpu_cost_usd == 27.20
    assert b.classiq_platform_fee_usd == 2.08
    assert b.total_usd == round(27.20 + b.service_fee_usd + 2.08, 2)


def test_actual_usage_overrides_estimate(pricing):
    b = pricing.billing(BudgetPlan.payg, 20.0, actual_qpu_seconds=10.0)
    assert b.actual_qpu_cost_usd == 16.00
    assert b.total_usd == round(16.00 + b.service_fee_usd, 2)


def test_service_fee_has_target_margin(pricing):
    cost = pricing.service_cost(classical_minutes=1.0)
    fee = pricing.service_fee(classical_minutes=1.0)
    assert fee >= cost / (1 - pricing.service_margin) - 0.01


def test_estimator_formula(pricing):
    est = pricing.estimation
    sec = estimate_qpu_seconds(1e-6, 1024, pricing)
    assert sec == round(1024 * (1e-6 + est["repetition_delay_sec"]) + est["job_overhead_sec"], 4)
    assert assumed_classiq_seconds(sec, pricing) < sec


def test_pricing_csv_reproduces_spec_table(pricing):
    rows = list(csv.DictReader(io.StringIO(pricing_csv(pricing))))
    medium_ibm = next(
        r
        for r in rows
        if r["workload"].startswith("Medium")
        and r["backend"] == "ibm_composer"
        and r["plan"] == "payg"
    )
    medium_cq = next(
        r
        for r in rows
        if r["workload"].startswith("Medium") and r["backend"] == "classiq" and r["plan"] == "payg"
    )
    assert float(medium_ibm["qpu_cost_usd"]) == 32.00
    assert float(medium_cq["qpu_seconds"]) == 17.0
    assert float(medium_cq["qpu_cost_usd"]) == 27.20
    assert float(medium_cq["classiq_platform_fee_usd"]) == 2.08
    assert len(rows) == 3 * 2 * 3
