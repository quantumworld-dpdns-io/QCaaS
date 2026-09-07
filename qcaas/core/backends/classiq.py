"""Classiq path.

Two Classiq entry points exist in the SDK (verified against classiq 1.28):

* ``synthesize(serialized_model)`` - full high-level synthesis. Needs a Qmod *model*. The
  ``qmod`` payload accepted here is the serialised model JSON produced by
  ``classiq.create_model(main)``. Native ``.qmod`` text cannot be parsed by the SDK and Python
  Qmod would require executing customer code, so neither is accepted.
* ``quantum_program_from_qasm(qasm)`` - sends an OpenQASM 2/3 circuit through Classiq's
  server-side transpiler and returns a QuantumProgram. This is what gives Classiq a role for
  gate-level input (QASM/JSON). It is a transpilation pass, not a re-synthesis.

Both need Classiq credentials. Machine-to-machine credentials are read by the SDK from
``CLASSIQ_CLIENT_ID`` / ``CLASSIQ_CLIENT_SECRET`` (optionally ``CLASSIQ_ORG_ID``); an interactive
login leaves a token in ``$CLASSIQ_DIR/.classiq-credentials`` (or ``$HOME``). Without either,
the adapter reports ``not_applicable`` so the router falls back to IBM instead of blocking on a
browser login prompt.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from qiskit import QuantumCircuit, qasm2, qasm3
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

from ...config import Settings, get_settings
from ...schemas.common import OptimizationBackend
from ..circuits import LoadedCircuit
from ..errors import BackendUnavailable, InvalidCircuit, NotApplicable
from ..metrics import compute_metrics
from .base import OptimizationOutcome, OptimizationRequest
from .ibm import duration_defaults, resolve_backend

log = logging.getLogger(__name__)

M2M_ENV = ("CLASSIQ_CLIENT_ID", "CLASSIQ_CLIENT_SECRET")


def classiq_installed() -> bool:
    try:
        import classiq  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def classiq_credentials_present() -> bool:
    if all(os.getenv(k) for k in M2M_ENV) or os.getenv("CLASSIQ_XCH_TOKEN"):
        return True
    home = os.getenv("CLASSIQ_DIR") or os.getenv("HOME") or os.getenv("USERPROFILE") or ""
    return bool(home) and (Path(home) / ".classiq-credentials").exists()


def _parse_qasm(text: str) -> QuantumCircuit:
    try:
        if text.lstrip().startswith("OPENQASM 3"):
            return qasm3.loads(text)
        return qasm2.loads(text, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)
    except Exception as exc:  # noqa: BLE001
        raise BackendUnavailable(
            "Classiq returned QASM that Qiskit cannot parse", str(exc)
        ) from exc


def _qprog_qasm(qprog) -> str:
    tc = getattr(qprog, "transpiled_circuit", None)
    code = getattr(tc, "qasm", None) if tc is not None else None
    code = code or getattr(qprog, "qasm", None)
    if not code:
        raise BackendUnavailable("Classiq QuantumProgram carried no QASM")
    return str(code)


def _qprog_info(qprog, method: str) -> dict:
    tc = getattr(qprog, "transpiled_circuit", None)
    return {
        "method": method,
        "classiq_width": getattr(getattr(qprog, "data", None), "width", None),
        "classiq_depth": getattr(tc, "depth", None) if tc is not None else None,
    }


def synthesize_model(qmod_json: str, req: OptimizationRequest) -> tuple[str, dict]:
    """Full Classiq synthesis of a serialised model. Isolated so tests can mock it."""
    import classiq
    from classiq import Constraints as CqConstraints
    from classiq import Preferences as CqPreferences

    c = req.constraints
    kwargs: dict = {"optimization_parameter": "depth"}
    if c.max_depth is not None:
        kwargs["max_depth"] = c.max_depth
    if c.max_width is not None:
        kwargs["max_width"] = c.max_width
    if c.max_gate_count is not None:
        kwargs["max_gate_count"] = {"cx": c.max_gate_count}
    qprog = classiq.synthesize(
        qmod_json,
        constraints=CqConstraints(**kwargs),
        preferences=CqPreferences(timeout_seconds=240),
    )
    return _qprog_qasm(qprog), _qprog_info(qprog, "synthesize")


def transpile_qasm(qasm: str) -> tuple[str, dict]:
    """Classiq server-side transpilation of a gate-level circuit. Isolated for mocking."""
    import classiq

    qprog = classiq.quantum_program_from_qasm(qasm)
    return _qprog_qasm(qprog), _qprog_info(qprog, "quantum_program_from_qasm")


class ClassiqBackend:
    name = OptimizationBackend.classiq

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _check_available(self) -> None:
        if not self.settings.classiq_enabled:
            raise NotApplicable("Classiq backend disabled by server configuration")
        if not classiq_installed():
            raise NotApplicable("classiq SDK not installed on server")
        if not classiq_credentials_present():
            raise NotApplicable(
                "Classiq credentials not configured",
                "Set CLASSIQ_CLIENT_ID/CLASSIQ_CLIENT_SECRET on the server.",
            )

    def optimize(self, loaded: LoadedCircuit, req: OptimizationRequest) -> OptimizationOutcome:
        self._check_available()
        t0 = time.perf_counter()
        if loaded.is_qmod:
            try:
                json.loads(loaded.qmod or "")
            except json.JSONDecodeError as exc:
                raise InvalidCircuit(
                    "qmod payload must be the serialised model JSON from classiq.create_model()"
                ) from exc
            qasm, info = synthesize_model(loaded.qmod or "", req)
        else:
            assert loaded.circuit is not None
            qasm, info = transpile_qasm(qasm2.dumps(loaded.circuit))

        synthesized = _parse_qasm(qasm)
        pre_metrics = compute_metrics(synthesized, None, None, duration_defaults(self.settings))

        backend = resolve_backend(req.target_backend, self.settings)
        if synthesized.num_qubits > backend.num_qubits:
            raise NotApplicable(
                f"Classiq output needs {synthesized.num_qubits} qubits, "
                f"backend {backend.name} has {backend.num_qubits}"
            )
        pm = generate_preset_pass_manager(
            backend=backend, optimization_level=req.optimization_level, seed_transpiler=req.seed
        )
        isa = pm.run(synthesized)
        metrics = compute_metrics(
            isa, backend.target, req.constraints, duration_defaults(self.settings)
        )
        info["pre_metrics"] = pre_metrics.model_dump()
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
