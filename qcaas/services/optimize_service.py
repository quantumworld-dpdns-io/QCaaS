from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from ..config import Settings
from ..core.backends.base import OptimizationOutcome, OptimizationRequest
from ..core.backends.ibm import duration_defaults, resolve_backend
from ..core.backends.router import CLASSIQ, RoutedResult, Router
from ..core.circuits import load_circuit
from ..core.cost.estimator import estimate_qpu_seconds
from ..core.errors import BackendUnavailable
from ..core.interpret.report import build_interpretation
from ..core.interpret.rules import analyze_backend_noise, analyze_counts
from ..core.metrics import compute_metrics, physical_qubits
from ..core.simulate import simulate
from ..schemas.optimize import (
    BackendResult,
    CircuitMetrics,
    OptimizeRequest,
    OptimizeResponse,
    SelectedResult,
    TranspiledCircuit,
)
from ..storage.models import Customer, new_id
from .persist import persist_job
from .qpu import submit_to_qpu

log = logging.getLogger(__name__)


def backend_results_from(
    routed: RoutedResult, shots: int, plan, pricing
) -> dict[str, BackendResult]:
    results: dict[str, BackendResult] = {}
    for b, o in routed.outcomes.items():
        est_sec = est_cost = None
        if o.ok and o.metrics is not None:
            est_sec = estimate_qpu_seconds(o.metrics.estimated_duration_sec or 0.0, shots, pricing)
            est_cost = pricing.qpu_cost(est_sec, plan)
        m = o.metrics
        results[b.value] = BackendResult(
            backend=b,
            status=o.status,
            reason=o.reason,
            depth=m.depth if m else None,
            gate_count=m.gate_count if m else None,
            two_qubit_gate_count=m.two_qubit_gate_count if m else None,
            width=m.width if m else None,
            estimated_qpu_runtime_sec=est_sec,
            estimated_qpu_cost_usd=est_cost,
            duration_ms=o.duration_ms,
            transpiled_circuit=TranspiledCircuit(
                format=o.qasm_format, source=o.qasm, layout=o.layout
            )
            if o.qasm
            else None,
            metrics=m,
        )
    return results


def rows_from(
    results: dict[str, BackendResult], selected: OptimizationOutcome | None
) -> list[dict]:
    rows = []
    for key, r in results.items():
        rows.append(
            {
                "backend": key,
                "status": r.status,
                "reason": r.reason,
                "depth": r.depth,
                "gate_count": r.gate_count,
                "two_qubit_gate_count": r.two_qubit_gate_count,
                "width": r.width,
                "estimated_qpu_seconds": r.estimated_qpu_runtime_sec,
                "estimated_qpu_cost_usd": r.estimated_qpu_cost_usd,
                "duration_ms": r.duration_ms,
                "selected": selected is not None and selected.backend.value == key,
            }
        )
    return rows


async def run_optimize(
    req: OptimizeRequest,
    customer: Customer,
    session: Session,
    settings: Settings,
    router: Router,
    payload_key: str | None = None,
) -> OptimizeResponse:
    t0 = time.perf_counter()
    job_id = new_id()
    pricing = router.pricing
    resolve_backend(req.target_backend, settings)  # 404 early on unknown backend
    loaded = load_circuit(req.circuit_format, req.circuit_payload)
    opt_req = OptimizationRequest(
        target_backend=req.target_backend,
        optimization_level=req.optimization_level,
        constraints=req.constraints,
    )
    before: CircuitMetrics | None = None
    if loaded.circuit is not None:
        before = compute_metrics(loaded.circuit, None, None, duration_defaults(settings))

    routed = await router.route(
        loaded, opt_req, req.optimization_backend, req.redundancy_mode, req.shots
    )
    results = backend_results_from(routed, req.shots, req.budget_mode, pricing)
    sel = routed.selected

    if sel is None or sel.metrics is None:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        billing = pricing.billing(req.budget_mode, 0.0, False, classical_minutes=elapsed_ms / 60000)
        persist_job(
            session,
            job_id=job_id,
            customer=customer,
            kind="optimize",
            settings=settings,
            request=req,
            response={
                "error": routed.selection_reason,
                "results": {k: v.model_dump() for k, v in results.items()},
            },
            payload_key=payload_key,
            status="failed",
            target_backend=req.target_backend,
            mode_used=routed.mode_used.value,
            total_usd=billing.total_usd,
            classical_ms=elapsed_ms,
            backend_results=rows_from(results, None),
            billing=billing,
        )
        session.commit()  # keep the failed-job record despite the error response
        raise BackendUnavailable(
            "no optimization backend produced a result", routed.selection_reason
        )

    if before is None:
        pre = sel.extra.get("pre_metrics")
        before = CircuitMetrics(**pre) if pre else sel.metrics

    est_sec = results[sel.backend.value].estimated_qpu_runtime_sec or 0.0
    backend_obj = resolve_backend(req.target_backend, settings)

    simulation = None
    sim_note = None
    if req.include_simulation and sel.circuit is not None:
        try:
            simulation = await asyncio.to_thread(
                simulate, sel.circuit, req.shots, backend_obj, req.noisy_simulation
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("simulation skipped: %s", exc)
            sim_note = str(exc)

    ca = analyze_counts(simulation.counts, req.target_bitstrings) if simulation else None
    na = analyze_backend_noise(
        backend_obj,
        physical_qubits(sel.circuit) if sel.circuit else [],
        sel.circuit,
        sel.metrics.estimated_duration_sec,
    )
    interpretation = build_interpretation(ca, na, sel.metrics, req.context, backend_obj.name)
    if sim_note:
        interpretation.recommendations.insert(0, f"Simulation skipped: {sim_note}")

    qpu_exec = None
    if req.execute_on_qpu and sel.circuit is not None:
        qpu_exec = await asyncio.to_thread(
            submit_to_qpu, sel.circuit, req.shots, backend_obj, settings, est_sec
        )

    used_classiq = any(o.status == "success" for b, o in routed.outcomes.items() if b == CLASSIQ)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    billing = pricing.billing(
        req.budget_mode,
        est_sec,
        used_classiq,
        classical_minutes=max(elapsed_ms / 60000, 0.01),
        actual_qpu_seconds=qpu_exec.actual_usage_sec if qpu_exec else None,
    )
    sel_result = results[sel.backend.value]
    response = OptimizeResponse(
        job_id=job_id,
        status="completed" if not (qpu_exec and qpu_exec.submitted) else "qpu_submitted",
        target_backend=backend_obj.name,
        backends_used=routed.backends_used,
        results=results,
        selected_result=SelectedResult(
            backend=sel.backend,
            reason=routed.selection_reason,
            depth=sel.metrics.depth,
            gate_count=sel.metrics.gate_count,
        ),
        transpiled_circuit=sel_result.transpiled_circuit,
        gate_count_before=before.gate_count,
        gate_count_after=sel.metrics.gate_count,
        depth_before=before.depth,
        depth_after=sel.metrics.depth,
        estimated_qpu_runtime_sec=est_sec,
        estimated_qpu_cost_usd=sel_result.estimated_qpu_cost_usd,
        simulation_result=simulation,
        interpretation=interpretation,
        qpu_execution=qpu_exec,
        billing=billing,
        created_at=datetime.now(UTC).isoformat(),
    )
    persist_job(
        session,
        job_id=job_id,
        customer=customer,
        kind="optimize",
        settings=settings,
        request=req,
        response=response,
        payload_key=payload_key,
        status=response.status,
        target_backend=backend_obj.name,
        selected_backend=sel.backend.value,
        mode_used=routed.mode_used.value,
        total_usd=billing.total_usd,
        estimated_qpu_seconds=est_sec,
        ibm_job_id=qpu_exec.ibm_job_id if qpu_exec else None,
        classical_ms=elapsed_ms,
        backend_results=rows_from(results, sel),
        billing=billing,
        internal_breakdown=pricing.internal_breakdown(req.budget_mode, est_sec, used_classiq),
    )
    return response
