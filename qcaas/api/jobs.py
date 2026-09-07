from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth.deps import get_current_customer, get_payload_key
from ..config import Settings, app_settings
from ..schemas.common import ErrorResponse
from ..schemas.jobs import JobDetail, JobList, JobSummary
from ..services.qpu import FINAL_STATES, fetch_qpu_status
from ..storage.crypto import decrypt_text
from ..storage.db import get_session
from ..storage.models import Customer, Job

router = APIRouter(prefix="/v2", tags=["jobs"])


def _summary(job: Job) -> JobSummary:
    return JobSummary(
        job_id=job.id,
        kind=job.kind,
        status=job.status,
        target_backend=job.target_backend,
        selected_backend=job.selected_backend,
        total_usd=job.total_usd,
        created_at=job.created_at.isoformat(),
        expires_at=job.expires_at.isoformat() if job.expires_at else None,
    )


@router.get(
    "/jobs",
    response_model=JobList,
    summary="List this customer's jobs",
    responses={401: {"model": ErrorResponse}},
)
def list_jobs(
    kind: str | None = Query(default=None, pattern="^(optimize|quote|interpret)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    customer: Customer = Depends(get_current_customer),
    session: Session = Depends(get_session),
) -> JobList:
    base = select(Job).where(Job.customer_id == customer.id)
    if kind:
        base = base.where(Job.kind == kind)
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.scalars(base.order_by(Job.created_at.desc()).offset(offset).limit(limit)).all()
    return JobList(items=[_summary(j) for j in rows], total=int(total))


@router.get(
    "/jobs/{job_id}",
    response_model=JobDetail,
    summary="Job detail (payloads decrypt only with the original X-Payload-Key)",
    responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
def get_job(
    job_id: str,
    customer: Customer = Depends(get_current_customer),
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
    payload_key: str | None = Depends(get_payload_key),
) -> JobDetail:
    job = session.get(Job, job_id)
    if job is None or job.customer_id != customer.id:
        raise HTTPException(404, detail={"error": "job not found", "code": "not_found"})

    def _load(text: str | None):
        if text is None:
            return None
        if job.encrypted:
            if not payload_key:
                return {"encrypted": True}
            plain = decrypt_text(text, payload_key, settings.api_key_salt)
            return (
                json.loads(plain) if plain else {"encrypted": True, "error": "wrong X-Payload-Key"}
            )
        return json.loads(text)

    response = _load(job.response_json)
    # Phase 8: refresh a submitted QPU job's status from IBM.
    if job.ibm_job_id and job.status not in {"completed", "failed"} and isinstance(response, dict):
        try:
            qpu = fetch_qpu_status(job.ibm_job_id, settings)
            response["qpu_execution"] = qpu.model_dump()
            if qpu.status and any(qpu.status.upper().endswith(s) for s in FINAL_STATES):
                job.status = "completed"
        except Exception as exc:  # noqa: BLE001
            response.setdefault("qpu_execution", {})["message"] = f"status refresh failed: {exc}"

    return JobDetail(
        **_summary(job).model_dump(),
        request=_load(job.request_json),
        response=response,
        backend_results=[
            {
                "backend": r.backend,
                "status": r.status,
                "reason": r.reason,
                "depth": r.depth,
                "gate_count": r.gate_count,
                "two_qubit_gate_count": r.two_qubit_gate_count,
                "width": r.width,
                "estimated_qpu_seconds": r.estimated_qpu_seconds,
                "estimated_qpu_cost_usd": r.estimated_qpu_cost_usd,
                "duration_ms": r.duration_ms,
                "selected": r.selected,
            }
            for r in job.backend_results
        ],
    )
