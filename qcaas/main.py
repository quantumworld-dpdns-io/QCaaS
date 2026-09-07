from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import health, interpret, jobs, optimize, quote
from .auth.api_key import ensure_dev_customer
from .config import Settings, get_settings
from .core.backends.router import Router
from .core.errors import QCaaSError
from .storage.db import init_db, session_factory

log = logging.getLogger("qcaas")

DESCRIPTION = """
Quantum-Computing-as-a-Service MVP.

* **POST /v2/optimize** – upload a circuit, get an optimised ISA circuit for an IBM backend, a
  simulation, a QPU cost estimate and a business-language interpretation. IBM Composer and
  Classiq run as redundant engines (`single | fallback | parallel`).
* **POST /v2/quote** – price a job before running it.
* **POST /v2/interpret** – turn measurement results into business language.
* **GET /v2/jobs** – history for your API key.

Authenticate with the `X-API-Key` header. Optionally add `X-Payload-Key` to encrypt stored
payloads with your own secret.
"""


def _warm_backend(settings: Settings) -> None:
    try:
        from .core.backends.ibm import resolve_backend

        resolve_backend(settings.default_backend, settings)
        log.info("warmed backend %s", settings.default_backend)
    except Exception as exc:  # noqa: BLE001
        log.warning("backend warm-up failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    logging.basicConfig(level=settings.log_level)
    init_db(settings)
    if settings.dev_api_key and not settings.is_production:
        with session_factory()() as s:
            ensure_dev_customer(s, settings.dev_api_key, settings.api_key_salt)
            s.commit()
    app.state.router = Router(settings)
    threading.Thread(target=_warm_backend, args=(settings,), daemon=True).start()
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        openapi_tags=[
            {"name": "optimize"},
            {"name": "quote"},
            {"name": "interpret"},
            {"name": "jobs"},
            {"name": "health"},
        ],
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https://.*\.vercel\.app" if not settings.is_production else None,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["X-API-Key", "X-Payload-Key", "Content-Type"],
        expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
    )

    @app.exception_handler(QCaaSError)
    async def _domain_error(_: Request, exc: QCaaSError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": exc.message, "detail": exc.detail, "code": exc.code},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "request validation failed",
                "detail": exc.errors(),
                "code": "validation_error",
            },
        )

    app.include_router(health.router)
    app.include_router(optimize.router)
    app.include_router(quote.router)
    app.include_router(interpret.router)
    app.include_router(jobs.router)
    return app


app = create_app()
