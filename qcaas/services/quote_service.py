from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from ..config import Settings
from ..core.backends.base import OptimizationRequest
from ..core.backends.classiq import classiq_credentials_present, classiq_installed
from ..core.backends.ibm import resolve_backend
from ..core.backends.router import CLASSIQ, IBM, Router
from ..core.circuits import load_circuit
from ..core.cost.estimator import assumed_classiq_seconds
from ..core.errors import BackendUnavailable
from ..schemas.common import BudgetPlan, OptimizationBackend, RedundancyMode, RedundancyModeName
from ..schemas.quote import BackendEstimate, QuoteRequest, QuoteResponse
from ..storage.models import Customer, new_id
from .optimize_service import backend_results_from, rows_from
from .persist import persist_job


def _per_plan(pricing, seconds: float) -> dict[BudgetPlan, float]:
    return {p: pricing.qpu_cost(seconds, p) for p in BudgetPlan}


async def run_quote(
    req: QuoteRequest,
    customer: Customer,
    session: Session,
    settings: Settings,
    router: Router,
    payload_key: str | None = None,
) -> QuoteResponse:
    t0 = time.perf_counter()
    quote_id = new_id()
    pricing = router.pricing
    resolve_backend(req.target_backend, settings)  # 404 early on unknown backend
    loaded = load_circuit(req.circuit_format, req.circuit_payload)
    opt_req = OptimizationRequest(
        target_backend=req.target_backend,
        optimization_level=req.optimization_level,
        constraints=req.constraints,
    )

    estimates: dict[str, BackendEstimate] = {}
    if loaded.is_qmod:
        # Only Classiq can turn a model into a circuit; IBM numbers come from re-transpiling it.
        routed = await router.route(
            loaded,
            opt_req,
            OptimizationBackend.classiq,
            RedundancyMode(mode=RedundancyModeName.single, primary=CLASSIQ),
            req.shots,
        )
    else:
        routed = await router.route(
            loaded,
            opt_req,
            OptimizationBackend.ibm_composer,
            RedundancyMode(mode=RedundancyModeName.single, primary=IBM),
            req.shots,
        )
    results = backend_results_from(routed, req.shots, req.budget_mode, pricing)
    for key, r in results.items():
        estimates[key] = BackendEstimate(
            backend=r.backend,
            status="estimated" if r.status == "success" else r.status,
            note=r.reason,
            depth=r.depth,
            gate_count=r.gate_count,
            estimated_qpu_runtime_sec=r.estimated_qpu_runtime_sec,
            estimated_qpu_cost_usd=_per_plan(pricing, r.estimated_qpu_runtime_sec)
            if r.estimated_qpu_runtime_sec
            else None,
        )

    ibm = estimates.get(IBM.value)
    if ibm is None or ibm.estimated_qpu_runtime_sec is None:
        raise BackendUnavailable(
            "could not estimate the circuit on the IBM target", routed.selection_reason
        )

    if CLASSIQ.value not in estimates:
        assumed = assumed_classiq_seconds(ibm.estimated_qpu_runtime_sec, pricing)
        saving = pricing.classiq.get("assumed_qpu_seconds_saving", 0.0)
        avail = classiq_installed() and classiq_credentials_present() and settings.classiq_enabled
        estimates[CLASSIQ.value] = BackendEstimate(
            backend=CLASSIQ,
            status="assumed",
            note=(
                f"assumes {saving:.0%} QPU-time saving from Classiq transpilation; "
                + (
                    "actual synthesis runs at /v2/optimize"
                    if avail
                    else "Classiq not configured on this server"
                )
            ),
            estimated_qpu_runtime_sec=assumed,
            estimated_qpu_cost_usd=_per_plan(pricing, assumed),
        )

    plan = req.budget_mode
    cq = estimates[CLASSIQ.value]
    ibm_total = pricing.qpu_cost(ibm.estimated_qpu_runtime_sec, plan)
    cq_total = (
        pricing.qpu_cost(cq.estimated_qpu_runtime_sec, plan) + pricing.classiq_fee_per_job
        if cq.estimated_qpu_runtime_sec is not None
        else None
    )
    if cq_total is not None and cq_total < ibm_total:
        recommended = CLASSIQ
        saving_pct = (ibm_total - cq_total) / ibm_total if ibm_total else 0.0
        reason = (
            f"Classiq estimated QPU time {cq.estimated_qpu_runtime_sec:.2f}s "
            f"vs {ibm.estimated_qpu_runtime_sec:.2f}s; "
            f"saves {saving_pct:.0%} net of the Classiq platform fee ({cq.status})"
        )
        qpu_sec = cq.estimated_qpu_runtime_sec or 0.0
        used_classiq = True
    else:
        recommended = IBM
        reason = (
            "IBM Composer is cheaper for this circuit: the Classiq platform fee outweighs "
            "the estimated QPU saving"
            if cq_total is not None
            else "Classiq estimate unavailable"
        )
        qpu_sec = ibm.estimated_qpu_runtime_sec
        used_classiq = False

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    billing = pricing.billing(plan, qpu_sec, used_classiq)
    now = datetime.now(UTC)
    response = QuoteResponse(
        quote_id=quote_id,
        target_backend=req.target_backend,
        shots=req.shots,
        plan=plan,
        estimates=estimates,
        recommended_backend=recommended,
        recommendation_reason=reason,
        estimated_qpu_runtime_sec=qpu_sec,
        estimated_qpu_cost_usd=billing.qpu_cost_usd,
        service_fee_usd=billing.service_fee_usd,
        total_usd=billing.total_usd,
        billing=billing,
        valid_until=(now + timedelta(hours=settings.quote_validity_hours)).isoformat(),
        created_at=now.isoformat(),
    )
    persist_job(
        session,
        job_id=quote_id,
        customer=customer,
        kind="quote",
        settings=settings,
        request=req,
        response=response,
        payload_key=payload_key,
        target_backend=req.target_backend,
        selected_backend=recommended.value,
        mode_used="quote",
        total_usd=billing.total_usd,
        estimated_qpu_seconds=qpu_sec,
        classical_ms=elapsed_ms,
        backend_results=rows_from(results, routed.selected),
        billing=billing,
        internal_breakdown=pricing.internal_breakdown(plan, qpu_sec, used_classiq),
    )
    return response
