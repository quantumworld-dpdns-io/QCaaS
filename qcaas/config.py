"""Application settings. Every secret and path comes from the environment (or .env)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fastapi import Request
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="QCAAS_", extra="ignore")

    app_name: str = "QCaaS API"
    environment: str = "dev"  # dev | staging | production
    log_level: str = "INFO"

    # Storage
    database_url: str = "sqlite:///./data/qcaas.db"
    retention_days_default: int = 30

    # Security
    api_key_salt: str = "change-me-in-production"
    dev_api_key: str | None = Field(
        default="dev-key-change-me",
        description="If set (dev/staging only), a customer with this key is created at startup.",
    )
    cors_origins: list[str] = ["http://localhost:3000"]
    rate_limit_per_minute: int = 60

    # IBM
    ibm_token: str | None = None
    ibm_instance: str | None = None
    ibm_channel: str = "ibm_quantum_platform"
    offline_mode: bool = Field(
        default=True,
        description="Use qiskit_ibm_runtime fake backends instead of the live service.",
    )
    default_backend: str = "ibm_sherbrooke"
    allow_qpu_execution: bool = Field(
        default=False, description="Master switch for execute_on_qpu (Phase 8). Costs real money."
    )

    # Classiq
    classiq_enabled: bool = True

    # Service-to-service token for /internal/* (accounts service). Unset => routes are 404.
    admin_token: str | None = None

    # Router
    fallback_timeout_sec: float = 30.0
    request_timeout_sec: float = 120.0
    auto_parallel_min_width: int = 10
    auto_parallel_min_gates: int = 100

    # Pricing
    pricing_path: Path = PACKAGE_DIR / "pricing.yaml"
    quote_validity_hours: int = 24

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def app_settings(request: Request) -> Settings:
    """FastAPI dependency: the Settings instance the running app was created with."""
    return request.app.state.settings
