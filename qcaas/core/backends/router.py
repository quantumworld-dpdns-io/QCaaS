"""Redundancy router: single / fallback / parallel / auto across IBM and Classiq."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from ...config import Settings, get_settings
from ...schemas.common import (
    OptimizationBackend,
    RedundancyMode,
    RedundancyModeName,
    SelectionMetric,
)
from ..circuits import LoadedCircuit
from ..cost.estimator import estimate_qpu_seconds
from ..cost.pricing import Pricing, get_pricing
from ..errors import NotApplicable, QCaaSError
from ..metrics import gate_count
from .base import OptimizationOutcome, OptimizationRequest, OptimizerBackend
from .classiq import ClassiqBackend
from .ibm import IBMComposerBackend

log = logging.getLogger(__name__)

IBM = OptimizationBackend.ibm_composer
CLASSIQ = OptimizationBackend.classiq


@dataclass
class RoutedResult:
    outcomes: dict[OptimizationBackend, OptimizationOutcome]
    selected: OptimizationOutcome | None
    selection_reason: str
    mode_used: RedundancyModeName
    backends_used: list[OptimizationBackend] = field(default_factory=list)


def _other(b: OptimizationBackend) -> OptimizationBackend:
    return CLASSIQ if b == IBM else IBM


def decide_auto(
    loaded: LoadedCircuit, settings: Settings
) -> tuple[RedundancyModeName, OptimizationBackend, str]:
    """Heuristic backend selection (spec: by circuit size, input format, history)."""
    if loaded.is_qmod:
        return (
            RedundancyModeName.parallel,
            CLASSIQ,
            "qmod input: Classiq synthesis + IBM re-transpile",
        )
    qc = loaded.circuit
    assert qc is not None
    if (
        qc.num_qubits >= settings.auto_parallel_min_width
        and gate_count(qc) >= settings.auto_parallel_min_gates
    ):
        return RedundancyModeName.fallback, IBM, "large circuit: IBM primary with Classiq fallback"
    return RedundancyModeName.single, IBM, "small gate-level circuit: IBM only"


class Router:
    def __init__(
        self,
        settings: Settings | None = None,
        backends: dict[OptimizationBackend, OptimizerBackend] | None = None,
        pricing: Pricing | None = None,
    ):
        self.settings = settings or get_settings()
        self.backends = backends or {
            IBM: IBMComposerBackend(self.settings),
            CLASSIQ: ClassiqBackend(self.settings),
        }
        self.pricing = pricing or get_pricing(self.settings.pricing_path)

    # ---- single backend execution -------------------------------------------------
    async def _run_one(
        self,
        name: OptimizationBackend,
        loaded: LoadedCircuit,
        req: OptimizationRequest,
        timeout: float | None,
    ) -> OptimizationOutcome:
        t0 = time.perf_counter()
        backend = self.backends[name]
        try:
            coro = asyncio.to_thread(backend.optimize, loaded, req)
            out = await asyncio.wait_for(coro, timeout=timeout) if timeout else await coro
        except TimeoutError:
            out = OptimizationOutcome(name, "timeout", reason=f"no result within {timeout:.0f}s")
        except NotApplicable as exc:
            out = OptimizationOutcome(name, "not_applicable", reason=exc.message)
        except QCaaSError as exc:
            out = OptimizationOutcome(name, "error", reason=f"{exc.code}: {exc.message}")
        except Exception as exc:  # noqa: BLE001
            log.exception("backend %s failed", name.value)
            out = OptimizationOutcome(name, "error", reason=f"{type(exc).__name__}: {exc}")
        if out.duration_ms is None:
            out.duration_ms = int((time.perf_counter() - t0) * 1000)
        return out

    async def _run_ibm_on_classiq_output(
        self,
        classiq_out: OptimizationOutcome,
        loaded: LoadedCircuit,
        req: OptimizationRequest,
        timeout: float | None,
    ) -> OptimizationOutcome | None:
        """For Qmod input the IBM path can only run on the Classiq-synthesised circuit."""
        if not (loaded.is_qmod and classiq_out.ok and classiq_out.circuit is not None):
            return None
        derived = LoadedCircuit(loaded.format, classiq_out.circuit, source=classiq_out.qasm)
        out = await self._run_one(IBM, derived, req, timeout)
        if out.ok:
            out.reason = "re-transpiled Classiq output for target"
        return out

    # ---- selection ------------------------------------------------------------------
    def _score(self, out: OptimizationOutcome, metric: SelectionMetric, shots: int) -> float:
        m = out.metrics
        assert m is not None
        if metric == SelectionMetric.depth:
            return float(m.depth)
        if metric == SelectionMetric.gate_count:
            return float(m.gate_count)
        return estimate_qpu_seconds(m.estimated_duration_sec or 0.0, shots, self.pricing)

    def _select(
        self,
        outcomes: dict[OptimizationBackend, OptimizationOutcome],
        metric: SelectionMetric,
        shots: int,
    ) -> tuple[OptimizationOutcome | None, str]:
        ok = [o for o in outcomes.values() if o.ok]
        if not ok:
            return None, "no backend produced a result"
        if len(ok) == 1:
            return ok[0], f"only {ok[0].backend.value} succeeded"
        ranked = sorted(ok, key=lambda o: (self._score(o, metric, shots), o.metrics.depth))  # type: ignore[union-attr]
        best, second = ranked[0], ranked[1]
        label = {
            "qpu_cost": "lowest estimated QPU cost",
            "depth": "lowest depth",
            "gate_count": "lowest gate count",
        }[metric.value]
        return best, f"{label} ({best.backend.value} beat {second.backend.value})"

    # ---- public entry point -------------------------------------------------------
    async def route(
        self,
        loaded: LoadedCircuit,
        req: OptimizationRequest,
        requested: OptimizationBackend,
        mode: RedundancyMode,
        shots: int,
    ) -> RoutedResult:
        timeout = mode.timeout_sec or self.settings.fallback_timeout_sec
        mode_name, primary = mode.mode, mode.primary
        auto_reason = ""
        if requested == OptimizationBackend.auto:
            mode_name, primary, auto_reason = decide_auto(loaded, self.settings)
        elif mode_name == RedundancyModeName.single:
            primary = requested
        outcomes: dict[OptimizationBackend, OptimizationOutcome] = {}

        if mode_name == RedundancyModeName.single:
            out = await self._run_one(primary, loaded, req, self.settings.request_timeout_sec)
            outcomes[primary] = out
            if primary == CLASSIQ and out.ok and loaded.is_qmod:
                ibm_out = await self._run_ibm_on_classiq_output(out, loaded, req, timeout)
                if ibm_out:
                    outcomes[IBM] = ibm_out
            selected, reason = self._select(outcomes, mode.selection_metric, shots)
            reason = f"single mode: {reason}" + (f"; auto: {auto_reason}" if auto_reason else "")

        elif mode_name == RedundancyModeName.fallback:
            out = await self._run_one(primary, loaded, req, timeout)
            outcomes[primary] = out
            if out.ok:
                selected, reason = out, f"primary {primary.value} succeeded"
            else:
                secondary = _other(primary)
                out2 = await self._run_one(
                    secondary, loaded, req, self.settings.request_timeout_sec
                )
                outcomes[secondary] = out2
                if out2.ok:
                    selected = out2
                    why = "timeout" if out.status == "timeout" else out.status
                    reason = f"fallback due to {why} on {primary.value}: {out.reason}"
                    if secondary == CLASSIQ and loaded.is_qmod:
                        ibm_out = await self._run_ibm_on_classiq_output(out2, loaded, req, timeout)
                        if ibm_out and ibm_out.ok:
                            outcomes[IBM] = ibm_out
                            selected, sel_reason = self._select(
                                outcomes, mode.selection_metric, shots
                            )
                            reason = f"{reason}; {sel_reason}"
                else:
                    selected, reason = None, f"both backends failed: {out.reason}; {out2.reason}"
            if auto_reason:
                reason = f"{reason}; auto: {auto_reason}"

        else:  # parallel
            results = await asyncio.gather(
                self._run_one(IBM, loaded, req, timeout),
                self._run_one(CLASSIQ, loaded, req, timeout),
            )
            for o in results:
                outcomes[o.backend] = o
            if loaded.is_qmod and outcomes[CLASSIQ].ok:
                ibm_out = await self._run_ibm_on_classiq_output(
                    outcomes[CLASSIQ], loaded, req, timeout
                )
                if ibm_out:
                    outcomes[IBM] = ibm_out
            selected, reason = self._select(outcomes, mode.selection_metric, shots)
            reason = f"parallel: {reason}" + (f"; auto: {auto_reason}" if auto_reason else "")

        return RoutedResult(
            outcomes=outcomes,
            selected=selected,
            selection_reason=reason,
            mode_used=mode_name,
            backends_used=[b for b, o in outcomes.items() if o.status not in {"skipped"}],
        )
