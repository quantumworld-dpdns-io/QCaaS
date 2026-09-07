from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class JobSummary(BaseModel):
    job_id: str
    kind: str
    status: str
    target_backend: str | None
    selected_backend: str | None
    total_usd: float | None
    created_at: str
    expires_at: str | None


class JobDetail(JobSummary):
    request: dict[str, Any] | None
    response: dict[str, Any] | None
    backend_results: list[dict[str, Any]]


class JobList(BaseModel):
    items: list[JobSummary]
    total: int
