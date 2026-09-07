"""Phase 8: real QPU execution (opt-in, guarded twice: request flag + server switch)."""

from __future__ import annotations

import logging
import math

from qiskit import QuantumCircuit

from ..config import Settings
from ..schemas.optimize import QpuExecution

log = logging.getLogger(__name__)

MIN_MAX_EXECUTION_TIME = 300  # IBM Runtime lower bound (seconds)
FINAL_STATES = {"DONE", "CANCELLED", "ERROR"}


def execution_blocked_reason(settings: Settings) -> str | None:
    if not settings.allow_qpu_execution:
        return "QPU execution is disabled on this server (QCAAS_ALLOW_QPU_EXECUTION=false)."
    if settings.offline_mode or not settings.ibm_token:
        return "Server is in offline mode / has no IBM credentials; nothing was submitted."
    return None


def submit_to_qpu(
    circuit: QuantumCircuit,
    shots: int,
    backend,
    settings: Settings,
    estimated_qpu_seconds: float | None,
) -> QpuExecution:
    blocked = execution_blocked_reason(settings)
    if blocked:
        return QpuExecution(submitted=False, message=blocked)
    from qiskit_ibm_runtime import SamplerV2

    sampler = SamplerV2(mode=backend)
    budget = int(math.ceil((estimated_qpu_seconds or 0.0) * 2))
    sampler.options.max_execution_time = max(MIN_MAX_EXECUTION_TIME, budget)
    job = sampler.run([circuit], shots=shots)
    usage = None
    try:
        est = job.usage_estimation or {}
        usage = (
            float(est.get("quantum_seconds")) if est.get("quantum_seconds") is not None else None
        )
    except Exception:  # noqa: BLE001
        usage = None
    return QpuExecution(
        submitted=True,
        ibm_job_id=job.job_id(),
        status=str(job.status()),
        usage_estimation_sec=usage,
        message="submitted; poll GET /v2/jobs/{job_id} for status and actual usage",
    )


def fetch_qpu_status(ibm_job_id: str, settings: Settings) -> QpuExecution:
    if settings.offline_mode or not settings.ibm_token:
        return QpuExecution(
            submitted=True, ibm_job_id=ibm_job_id, message="offline: cannot refresh"
        )
    from qiskit_ibm_runtime import QiskitRuntimeService

    service = QiskitRuntimeService(
        channel=settings.ibm_channel, token=settings.ibm_token, instance=settings.ibm_instance
    )
    job = service.job(ibm_job_id)
    status = str(job.status())
    out = QpuExecution(submitted=True, ibm_job_id=ibm_job_id, status=status)
    try:
        usage = job.usage()
        out.actual_usage_sec = float(usage) if usage is not None else None
    except Exception:  # noqa: BLE001
        pass
    if status.upper().endswith("DONE"):
        try:
            res = job.result()[0]
            out.counts = {k: int(v) for k, v in res.join_data().get_counts().items()}
        except Exception as exc:  # noqa: BLE001
            out.message = f"result fetch failed: {exc}"
    return out
