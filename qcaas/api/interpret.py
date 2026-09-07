from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.deps import get_current_customer, get_payload_key
from ..config import Settings, app_settings
from ..core.cost.pricing import Pricing
from ..schemas.common import ErrorResponse
from ..schemas.interpret import InterpretRequest, InterpretResponse
from ..services.interpret_service import run_interpret
from ..storage.db import get_session
from ..storage.models import Customer
from .deps import get_pricing_dep

router = APIRouter(prefix="/v2", tags=["interpret"])


@router.post(
    "/interpret",
    response_model=InterpretResponse,
    summary="Business-language interpretation of measurement results",
    responses={401: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def interpret(
    req: InterpretRequest,
    customer: Customer = Depends(get_current_customer),
    session: Session = Depends(get_session),
    settings: Settings = Depends(app_settings),
    pricing: Pricing = Depends(get_pricing_dep),
    payload_key: str | None = Depends(get_payload_key),
) -> InterpretResponse:
    return run_interpret(req, customer, session, settings, pricing, payload_key)
