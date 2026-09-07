from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from fastapi import Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..config import Settings, app_settings
from ..storage.db import get_session
from ..storage.models import Customer
from .api_key import find_customer_by_key


@dataclass
class _Bucket:
    tokens: float
    updated: float


@dataclass
class RateLimiter:
    """Per-customer token bucket (in-memory; single-process MVP)."""

    default_per_minute: int
    buckets: dict[str, _Bucket] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def check(self, key: str, per_minute: int | None = None) -> tuple[bool, int, int]:
        limit = per_minute or self.default_per_minute
        now = time.monotonic()
        with self.lock:
            b = self.buckets.get(key)
            if b is None:
                b = _Bucket(tokens=float(limit), updated=now)
                self.buckets[key] = b
            b.tokens = min(float(limit), b.tokens + (now - b.updated) * (limit / 60.0))
            b.updated = now
            if b.tokens >= 1.0:
                b.tokens -= 1.0
                return True, limit, int(b.tokens)
            return False, limit, 0


_limiter: RateLimiter | None = None


def get_rate_limiter(settings: Settings = Depends(app_settings)) -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter(settings.rate_limit_per_minute)
    return _limiter


def get_current_customer(
    request: Request,
    response: Response,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> Customer:
    if not x_api_key:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing API key", "code": "unauthorized"},
            headers={"WWW-Authenticate": "ApiKey"},
        )
    customer = find_customer_by_key(session, x_api_key, settings.api_key_salt)
    if customer is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid API key", "code": "unauthorized"},
            headers={"WWW-Authenticate": "ApiKey"},
        )
    ok, limit, remaining = limiter.check(customer.id, customer.rate_limit_per_minute)
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    if not ok:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate limit exceeded", "code": "rate_limited"},
            headers={
                "Retry-After": "60",
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
            },
        )
    request.state.customer = customer
    return customer


def get_payload_key(
    x_payload_key: str | None = Header(default=None, alias="X-Payload-Key"),
) -> str | None:
    return x_payload_key or None
