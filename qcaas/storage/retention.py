"""Data retention: purge payloads past each customer's retention window (default 30 days)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Job


def expiry_for(retention_days: int, now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + timedelta(days=max(int(retention_days), 0))


def purge_expired(session: Session, now: datetime | None = None) -> int:
    """Blank request/response payloads of expired jobs. Metadata and billing are kept."""
    now = now or datetime.now(UTC)
    stmt = select(Job).where(
        Job.expires_at.is_not(None), Job.expires_at <= now, Job.purged_at.is_(None)
    )
    n = 0
    for job in session.scalars(stmt):
        job.request_json = None
        job.response_json = None
        job.purged_at = now
        n += 1
    session.flush()
    return n
