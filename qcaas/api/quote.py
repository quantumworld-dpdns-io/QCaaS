from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.deps import get_current_customer, get_payload_key
from ..config import Settings, app_settings
from ..core.backends.router import Router
from ..schemas.common import ErrorResponse
from ..schemas.quote import QuoteRequest, QuoteResponse
from ..services.quote_service import run_quote
from ..storage.db import get_session
from ..storage.models import Customer
from .deps import get_router

router = APIRouter(prefix="/v2", tags=["quote"])


@router.post(
    "/quote",
    response_model=QuoteResponse,
    summary="Quote QPU time and cost for IBM Composer and Classiq without executing",
    responses={
        401: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def quote(
    req: QuoteRequest,
    customer: Customer = Depends(get_current_customer),
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
    router_: Router = Depends(get_router),
    payload_key: str | None = Depends(get_payload_key),
) -> QuoteResponse:
    return await run_quote(req, customer, session, settings, router_, payload_key)
