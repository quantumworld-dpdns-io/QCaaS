"""Classiq path: synthesise a serialised Qmod model, then measure it against the IBM target.

Classiq is model-first. The `qmod` payload accepted here is the *serialised model JSON*
produced by `classiq.create_model(main)` (a `SerializedModel` string). Native `.qmod` text
and Python-defined models are not accepted, because parsing them would require executing
customer code or an SDK feature that is not documented. Any other circuit format is reported
as `not_applicable` so the router falls back to the IBM path.
"""

from __future__ import annotations

import json
import logging
import time

from ...config import Settings, get_settings
from ...schemas.common import OptimizationBackend
from ..circuits import LoadedCircuit
from ..errors import BackendUnavailable, InvalidCircuit, NotApplicable
from ..metrics import compute_metrics
from .base import OptimizationOutcome, OptimizationRequest
from .ibm import duration_defaults, resolve_backend

log = logging.getLogger(__name__)


def classiq_available() -> bool:
    try:
        import classiq  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def _synthesize(qmod_json: str, req: OptimizationRequest) -> tuple[str, dict]:
    """Run Classiq synthesis. Returns (qasm, info). Isolated for mocking in tests."""
    try:
        import classiq
        from classiq import Constraints as CqConstraints
        from classiq import Preferences as CqPreferences
    except ImportError as exc:
        raise BackendUnavailable("classiq SDK not installed") from exc

    model = qmod_json
    c = req.constraints
    cq_kwargs: dict = {}
    if c.max_depth is not None:
        cq_kwargs["max_depth"] = c.max_depth
    if c.max_width is not None:
        cq_kwargs["max_width"] = c.max_width
    if c.max_gate_count is not None:
        cq_kwargs["max_gate_count"] = {"cx": c.max_gate_count}
    cq_kwargs["optimization_parameter"] = "depth"
    if cq_kwargs:
        model = classiq.set_constraints(model, CqConstraints(**cq_kwargs))
    prefs: dict = {"timeout_seconds": 300}
    if c.error_bound is not None:
        prefs["synthesize_all_separately"] = False
    model = classiq.set_preferences(model, CqPreferences(**prefs))

    qprog = classiq.synthesize(model)
    # SDK >= 0.70 returns a QuantumProgram; older versions return serialized JSON.
    if isinstance(qprog, str):
        from classiq import QuantumProgram

        qprog = QuantumProgram.from_qprog(qprog)
    qasm = qprog.transpiled_circuit.qasm if qprog.transpiled_circuit else qprog.qasm
    info = {
        "classiq_width": getattr(qprog.data, "width", None),
        "classiq_depth": getattr(qprog.transpiled_circuit, "depth", None),
    }
    return qasm, info


class ClassiqBackend:
    name = OptimizationBackend.classiq

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def optimize(self, loaded: LoadedCircuit, req: OptimizationRequest) -> OptimizationOutcome:
        if not loaded.is_qmod:
            raise NotApplicable(
                "Classiq synthesis needs a Qmod model",
                "Send circuit_format='qmod' with the serialised model from classiq.create_model().",
            )
        if not self.settings.classiq_enabled:
            raise NotApplicable("Classiq backend disabled by server configuration")
        try:
            json.loads(loaded.qmod or "")
        except json.JSONDecodeError as exc:
            raise InvalidCircuit(
                "qmod payload must be the serialised model JSON from classiq.create_model()"
            ) from exc

        t0 = time.perf_counter()
        qasm, info = _synthesize(loaded.qmod, req)

        # Measure the synthesised circuit against the same IBM target as the IBM path.
        from qiskit import qasm2, qasm3

        try:
            qc = qasm3.loads(qasm) if qasm.lstrip().startswith("OPENQASM 3") else qasm2.loads(
                qasm, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS
            )
        except Exception as exc:  # noqa: BLE001
            raise BackendUnavailable("Classiq returned QASM that Qiskit cannot parse", str(exc)) from exc

        backend = resolve_backend(req.target_backend, self.settings)
        from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

        pm = generate_preset_pass_manager(
            backend=backend, optimization_level=req.optimization_level, seed_transpiler=req.seed
        )
        isa = pm.run(qc)
        metrics = compute_metrics(isa, backend.target, req.constraints, duration_defaults(self.settings))
        return OptimizationOutcome(
            backend=self.name,
            status="success",
            circuit=isa,
            metrics=metrics,
            qasm=qasm3.dumps(isa),
            qasm_format="openqasm3",
            duration_ms=int((time.perf_counter() - t0) * 1000),
            extra=info,
        )
