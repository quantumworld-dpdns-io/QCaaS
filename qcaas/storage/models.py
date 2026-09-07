from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def now_utc() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(12))
    plan: Mapped[str] = mapped_column(String(16), default="payg")
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    rate_limit_per_minute: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    jobs: Mapped[list[Job]] = relationship(back_populates="customer")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # optimize | quote | interpret
    status: Mapped[str] = mapped_column(String(16), default="completed")
    target_backend: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selected_backend: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mode_used: Mapped[str | None] = mapped_column(String(16), nullable=True)
    request_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    total_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_qpu_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    ibm_job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    classical_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, index=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped[Customer] = relationship(back_populates="jobs")
    backend_results: Mapped[list[BackendResultRow]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    billing: Mapped[BillingRecord | None] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )


class BackendResultRow(Base):
    """Both backends' results are always stored, even when only one is returned (spec §4)."""

    __tablename__ = "backend_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    backend: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gate_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    two_qubit_gate_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_qpu_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_qpu_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)

    job: Mapped[Job] = relationship(back_populates="backend_results")


class BillingRecord(Base):
    __tablename__ = "billing_records"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True)
    plan: Mapped[str] = mapped_column(String(16))
    qpu_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    service_fee_usd: Mapped[float] = mapped_column(Float, default=0.0)
    classiq_platform_fee_usd: Mapped[float] = mapped_column(Float, default=0.0)
    actual_qpu_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_usd: Mapped[float] = mapped_column(Float, default=0.0)
    internal_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped[Job] = relationship(back_populates="billing")
