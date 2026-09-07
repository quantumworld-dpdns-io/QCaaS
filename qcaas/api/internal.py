"""Internal (service-to-service) endpoints used by the accounts service.

Guarded by the `X-Admin-Token` header, which must equal `QCAAS_ADMIN_TOKEN`. When that setting is
unset the routes answer 404, so a public deployment without an accounts service exposes nothing.
Hidden from the public OpenAPI document.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth.api_key import create_customer
from ..config import Settings, app_settings
from ..storage.db import get_session
from ..storage.models import Customer, Job

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def require_admin(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    settings: Settings = Depends(app_settings),
) -> None:
    if not settings.admin_token:
        raise HTTPException(404, detail={"error": "not found", "code": "not_found"})
    if not hmac.compare_digest(x_admin_token or "", settings.admin_token):
        raise HTTPException(401, detail={"error": "invalid admin token", "code": "unauthorized"})


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    plan: str = Field(default="payg", pattern="^(payg|flex|premium)$")
    retention_days: int = Field(default=30, ge=0, le=3650)
    external_id: str | None = Field(default=None, max_length=64)


class CustomerPatch(BaseModel):
    active: bool | None = None
    plan: str | None = Field(default=None, pattern="^(payg|flex|premium)$")
    retention_days: int | None = Field(default=None, ge=0, le=3650)
    name: str | None = Field(default=None, min_length=1, max_length=200)


def _customer(c: Customer) -> dict:
    return {
        "customer_id": c.id,
        "name": c.name,
        "key_prefix": c.key_prefix,
        "plan": c.plan,
        "retention_days": c.retention_days,
        "active": c.active,
        "external_id": c.external_id,
        "created_at": c.created_at.isoformat(),
    }


@router.post("/customers", status_code=201, dependencies=[Depends(require_admin)])
def create_customer_endpoint(
    body: CustomerCreate,
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
) -> dict:
    if body.external_id:
        existing = session.scalar(select(Customer).where(Customer.external_id == body.external_id))
        if existing is not None:
            raise HTTPException(
                409, detail={"error": "external_id already provisioned", "code": "conflict"}
            )
    customer, key = create_customer(
        session, body.name, settings.api_key_salt, body.plan, body.retention_days
    )
    customer.external_id = body.external_id
    session.flush()
    return {**_customer(customer), "api_key": key}


@router.get("/customers", dependencies=[Depends(require_admin)])
def list_customers(session: Session = Depends(get_session)) -> dict:
    rows = session.scalars(select(Customer).order_by(Customer.created_at.desc())).all()
    return {"items": [_customer(c) for c in rows], "total": len(rows)}


@router.patch("/customers/{customer_id}", dependencies=[Depends(require_admin)])
def patch_customer(
    customer_id: str, body: CustomerPatch, session: Session = Depends(get_session)
) -> dict:
    c = session.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, detail={"error": "customer not found", "code": "not_found"})
    for field in ("active", "plan", "retention_days", "name"):
        value = getattr(body, field)
        if value is not None:
            setattr(c, field, value)
    session.flush()
    return _customer(c)


@router.get("/jobs", dependencies=[Depends(require_admin)])
def list_all_jobs(
    customer_id: str | None = None,
    kind: str | None = Query(default=None, pattern="^(optimize|quote|interpret)$"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> dict:
    base = select(Job)
    if customer_id:
        base = base.where(Job.customer_id == customer_id)
    if kind:
        base = base.where(Job.kind == kind)
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.scalars(base.order_by(Job.created_at.desc()).offset(offset).limit(limit)).all()
    return {
        "items": [
            {
                "job_id": j.id,
                "customer_id": j.customer_id,
                "kind": j.kind,
                "status": j.status,
                "target_backend": j.target_backend,
                "selected_backend": j.selected_backend,
                "mode_used": j.mode_used,
                "total_usd": j.total_usd,
                "estimated_qpu_seconds": j.estimated_qpu_seconds,
                "created_at": j.created_at.isoformat(),
            }
            for j in rows
        ],
        "total": int(total),
    }


@router.get("/stats", dependencies=[Depends(require_admin)])
def stats(session: Session = Depends(get_session)) -> dict:
    customers = session.scalar(select(func.count()).select_from(Customer)) or 0
    active = session.scalar(select(func.count()).where(Customer.active.is_(True))) or 0
    by_kind = dict(
        session.execute(select(Job.kind, func.count()).group_by(Job.kind)).all()  # type: ignore[arg-type]
    )
    revenue = session.scalar(select(func.coalesce(func.sum(Job.total_usd), 0.0))) or 0.0
    qpu = session.scalar(select(func.coalesce(func.sum(Job.estimated_qpu_seconds), 0.0))) or 0.0
    by_backend = dict(
        session.execute(
            select(Job.selected_backend, func.count())
            .where(Job.selected_backend.is_not(None))
            .group_by(Job.selected_backend)
        ).all()  # type: ignore[arg-type]
    )
    return {
        "customers": int(customers),
        "active_customers": int(active),
        "jobs": {
            "total": int(sum(by_kind.values())),
            "by_kind": {k: int(v) for k, v in by_kind.items()},
        },
        "selected_backends": {k: int(v) for k, v in by_backend.items()},
        "revenue_usd": round(float(revenue), 2),
        "estimated_qpu_seconds": round(float(qpu), 2),
    }
