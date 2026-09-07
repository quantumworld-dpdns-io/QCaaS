from __future__ import annotations

import time
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from ..config import Settings
from ..core.backends.ibm import resolve_backend
from ..core.cost.pricing import Pricing
from ..core.interpret.report import build_interpretation
from ..core.interpret.rules import analyze_backend_noise, analyze_counts, parse_counts
from ..schemas.interpret import InterpretRequest, InterpretResponse
from ..storage.models import Customer, new_id
from .persist import persist_job


def run_interpret(
    req: InterpretRequest,
    customer: Customer,
    session: Session,
    settings: Settings,
    pricing: Pricing,
    payload_key: str | None = None,
) -> InterpretResponse:
    t0 = time.perf_counter()
    job_id = new_id()
    counts = parse_counts(req.result_format, req.result_payload)
    ca = analyze_counts(counts, req.target_bitstrings)

    na = None
    backend_name = None
    if req.target_backend:
        backend = resolve_backend(req.target_backend, settings)
        backend_name = backend.name
        if req.physical_qubits:
            na = analyze_backend_noise(backend, req.physical_qubits)

    interp = build_interpretation(ca, na, None, req.context, backend_name)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    billing = pricing.billing(
        req.budget_mode, 0.0, False, classical_minutes=max(elapsed_ms / 60000, 0.01)
    )
    response = InterpretResponse(
        job_id=job_id,
        summary=interp.summary,
        key_metrics=interp.key_metrics,
        noise_analysis=[c.model_dump() for c in interp.noise_analysis],
        business_interpretation=interp.business_interpretation,
        recommendations=interp.recommendations,
        next_steps=interp.next_steps,
        confidence=interp.confidence,
        interpretation=interp,
        billing=billing,
        created_at=datetime.now(UTC).isoformat(),
    )
    persist_job(
        session,
        job_id=job_id,
        customer=customer,
        kind="interpret",
        settings=settings,
        request=req,
        response=response,
        payload_key=payload_key,
        target_backend=req.target_backend,
        mode_used="interpret",
        total_usd=billing.total_usd,
        classical_ms=elapsed_ms,
        billing=billing,
    )
    return response
