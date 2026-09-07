from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import __version__
from ..config import Settings, app_settings
from ..core.backends.classiq import classiq_credentials_present, classiq_installed

router = APIRouter(tags=["health"])


@router.get("/healthz", summary="Liveness/readiness probe")
def healthz(settings: Settings = Depends(app_settings)) -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "environment": settings.environment,
        "offline_mode": settings.offline_mode,
        "default_backend": settings.default_backend,
        "qpu_execution_allowed": settings.allow_qpu_execution,
        "classiq": {
            "enabled": settings.classiq_enabled,
            "installed": classiq_installed(),
            "credentials": classiq_credentials_present(),
        },
    }
