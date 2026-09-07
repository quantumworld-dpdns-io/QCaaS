from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.deps import get_current_customer, get_payload_key
from ..config import Settings, app_settings
from ..core.backends.router import Router
from ..schemas.common import ErrorResponse
from ..schemas.optimize import OptimizeRequest, OptimizeResponse
from ..services.optimize_service import run_optimize
from ..storage.db import get_session
from ..storage.models import Customer
from .deps import get_router

router = APIRouter(prefix="/v2", tags=["optimize"])


@router.post(
    "/optimize",
    response_model=OptimizeResponse,
    summary="Optimise a circuit for an IBM backend (IBM Composer + Classiq redundancy)",
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def optimize(
    req: OptimizeRequest,
    customer: Customer = Depends(get_current_customer),
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
    router_: Router = Depends(get_router),
    payload_key: str | None = Depends(get_payload_key),
) -> OptimizeResponse:
    """Upload a circuit → transpile/optimise for `target_backend` → simulate → estimate cost →
    business interpretation. `redundancy_mode` controls IBM/Classiq fallback or parallel runs."""
    return await run_optimize(req, customer, session, settings, router_, payload_key)
