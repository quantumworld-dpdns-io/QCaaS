"""QPU time estimation.

estimated_qpu_seconds = shots * (critical_path_duration + repetition_delay) + job_overhead

When a real IBM Runtime job exists, `job.usage_estimation` / actual usage overrides this.
"""

from __future__ import annotations

from .pricing import Pricing


def estimate_qpu_seconds(circuit_duration_sec: float, shots: int, pricing: Pricing) -> float:
    est = pricing.estimation
    rep_delay = float(est.get("repetition_delay_sec", 0.0))
    overhead = float(est.get("job_overhead_sec", 0.0))
    return round(shots * (max(circuit_duration_sec, 0.0) + rep_delay) + overhead, 4)


def assumed_classiq_seconds(ibm_seconds: float, pricing: Pricing) -> float:
    """Quote-time assumption when Classiq cannot synthesise the given input."""
    saving = float(pricing.classiq.get("assumed_qpu_seconds_saving", 0.0))
    overhead = float(pricing.estimation.get("job_overhead_sec", 0.0))
    variable = max(ibm_seconds - overhead, 0.0)
    return round(variable * (1.0 - saving) + overhead, 4)
