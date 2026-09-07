"""IBM path: Qiskit preset pass manager against a live or fake IBM backend Target."""

from __future__ import annotations

import logging
import time
from functools import lru_cache

from qiskit import qasm3
from qiskit.providers import BackendV2
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

from ...config import Settings, get_settings
from ...schemas.common import OptimizationBackend
from ..circuits import LoadedCircuit
from ..errors import BackendNotFound, BackendUnavailable, NotApplicable
from ..metrics import DurationDefaults, compute_metrics
from .base import OptimizationOutcome, OptimizationRequest

log = logging.getLogger(__name__)


def _fake_name(name: str) -> str:
    n = name.lower()
    if n.startswith("ibm_"):
        n = "fake_" + n[4:]
    elif not n.startswith("fake_"):
        n = "fake_" + n
    return n


@lru_cache(maxsize=16)
def _fake_backend(name: str) -> BackendV2:
    from qiskit_ibm_runtime.fake_provider import FakeProviderForBackendV2

    provider = FakeProviderForBackendV2()
    fake = _fake_name(name)
    try:
        return provider.backend(fake)
    except Exception as exc:  # noqa: BLE001
        available = sorted(b.name for b in provider.backends())
        raise BackendNotFound(
            f"backend '{name}' not available in offline mode",
            f"available (offline): {', '.join(available)}",
        ) from exc


@lru_cache(maxsize=16)
def _live_backend(name: str, token: str, instance: str | None, channel: str) -> BackendV2:
    from qiskit_ibm_runtime import QiskitRuntimeService

    try:
        service = QiskitRuntimeService(channel=channel, token=token, instance=instance)
        return service.backend(name)
    except Exception as exc:  # noqa: BLE001
        raise BackendUnavailable(f"could not load IBM backend '{name}'", str(exc)) from exc


def resolve_backend(name: str, settings: Settings | None = None) -> BackendV2:
    settings = settings or get_settings()
    if settings.offline_mode or not settings.ibm_token:
        return _fake_backend(name)
    return _live_backend(name, settings.ibm_token, settings.ibm_instance, settings.ibm_channel)


def duration_defaults(settings: Settings | None = None) -> DurationDefaults:
    from ..cost.pricing import get_pricing

    est = get_pricing((settings or get_settings()).pricing_path).estimation
    return DurationDefaults(
        one_qubit_sec=est["default_1q_gate_sec"],
        two_qubit_sec=est["default_2q_gate_sec"],
        measure_sec=est["default_measure_sec"],
    )


class IBMComposerBackend:
    name = OptimizationBackend.ibm_composer

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def optimize(self, loaded: LoadedCircuit, req: OptimizationRequest) -> OptimizationOutcome:
        if loaded.circuit is None:
            raise NotApplicable(
                "IBM Composer path needs a gate-level circuit",
                "Qmod models must be synthesised by Classiq first.",
            )
        t0 = time.perf_counter()
        backend = resolve_backend(req.target_backend, self.settings)
        if loaded.circuit.num_qubits > backend.num_qubits:
            raise NotApplicable(
                f"circuit needs {loaded.circuit.num_qubits} qubits, "
                f"backend {backend.name} has {backend.num_qubits}"
            )
        pm = generate_preset_pass_manager(
            backend=backend, optimization_level=req.optimization_level, seed_transpiler=req.seed
        )
        isa = pm.run(loaded.circuit)
        metrics = compute_metrics(
            isa, backend.target, req.constraints, duration_defaults(self.settings)
        )
        layout = None
        if isa.layout is not None:
            try:
                idx = isa.layout.initial_index_layout(filter_ancillas=True)
                layout = {str(v): int(p) for v, p in enumerate(idx)}
            except Exception:  # noqa: BLE001
                layout = None
        return OptimizationOutcome(
            backend=self.name,
            status="success",
            circuit=isa,
            metrics=metrics,
            qasm=qasm3.dumps(isa),
            qasm_format="openqasm3",
            layout=layout,
            duration_ms=int((time.perf_counter() - t0) * 1000),
            extra={"backend_name": backend.name, "backend_num_qubits": backend.num_qubits},
        )
