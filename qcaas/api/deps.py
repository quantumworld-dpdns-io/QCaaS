from __future__ import annotations

from fastapi import Request

from ..core.backends.router import Router
from ..core.cost.pricing import Pricing


def get_router(request: Request) -> Router:
    return request.app.state.router


def get_pricing_dep(request: Request) -> Pricing:
    return request.app.state.router.pricing
