from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import Settings
from ..schemas.common import Billing
from ..storage.crypto import encrypt_text
from ..storage.models import BackendResultRow, BillingRecord, Customer, Job
from ..storage.retention import expiry_for


def _dump(model: BaseModel | dict | None) -> str | None:
    if model is None:
        return None
    if isinstance(model, BaseModel):
        return model.model_dump_json()
    return json.dumps(model)


def persist_job(
    session: Session,
    *,
    job_id: str,
    customer: Customer,
    kind: str,
    settings: Settings,
    request: BaseModel | dict | None,
    response: BaseModel | dict | None,
    payload_key: str | None = None,
    status: str = "completed",
    target_backend: str | None = None,
    selected_backend: str | None = None,
    mode_used: str | None = None,
    total_usd: float | None = None,
    estimated_qpu_seconds: float | None = None,
    ibm_job_id: str | None = None,
    classical_ms: int | None = None,
    backend_results: list[dict[str, Any]] | None = None,
    billing: Billing | None = None,
    internal_breakdown: dict | None = None,
) -> Job:
    req_text, resp_text = _dump(request), _dump(response)
    encrypted = False
    if payload_key:
        salt = settings.api_key_salt
        req_text = encrypt_text(req_text, payload_key, salt) if req_text else None
        resp_text = encrypt_text(resp_text, payload_key, salt) if resp_text else None
        encrypted = True
    job = Job(
        id=job_id,
        customer_id=customer.id,
        kind=kind,
        status=status,
        target_backend=target_backend,
        selected_backend=selected_backend,
        mode_used=mode_used,
        request_json=req_text,
        response_json=resp_text,
        encrypted=encrypted,
        total_usd=total_usd,
        estimated_qpu_seconds=estimated_qpu_seconds,
        ibm_job_id=ibm_job_id,
        classical_ms=classical_ms,
        expires_at=expiry_for(customer.retention_days or settings.retention_days_default),
    )
    for r in backend_results or []:
        job.backend_results.append(BackendResultRow(**r))
    if billing is not None:
        job.billing = BillingRecord(
            plan=billing.plan.value,
            qpu_cost_usd=billing.qpu_cost_usd,
            service_fee_usd=billing.service_fee_usd,
            classiq_platform_fee_usd=billing.classiq_platform_fee_usd or 0.0,
            actual_qpu_cost_usd=billing.actual_qpu_cost_usd,
            total_usd=billing.total_usd,
            internal_json=json.dumps(internal_breakdown) if internal_breakdown else None,
        )
    session.add(job)
    session.flush()
    return job
