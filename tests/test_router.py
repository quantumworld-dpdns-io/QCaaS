import asyncio

import pytest

from qcaas.core.backends.base import OptimizationRequest
from qcaas.core.backends.router import CLASSIQ, IBM, Router
from qcaas.core.circuits import load_circuit
from qcaas.core.errors import NotApplicable
from qcaas.schemas.common import (
    CircuitFormat,
    OptimizationBackend,
    RedundancyMode,
    RedundancyModeName,
    SelectionMetric,
)

from .conftest import BELL_QASM2, StubBackend


def _router(settings, pricing, ibm: StubBackend, cq: StubBackend) -> Router:
    return Router(settings, backends={IBM: ibm, CLASSIQ: cq}, pricing=pricing)


def _route(router, mode: RedundancyMode, requested=OptimizationBackend.ibm_composer):
    loaded = load_circuit(CircuitFormat.openqasm2, BELL_QASM2)
    return asyncio.run(
        router.route(loaded, OptimizationRequest("ibm_sherbrooke"), requested, mode, 1024)
    )


def test_single_mode_runs_only_primary(settings, pricing):
    ibm, cq = StubBackend(IBM), StubBackend(CLASSIQ)
    rr = _route(_router(settings, pricing, ibm, cq), RedundancyMode(mode=RedundancyModeName.single))
    assert rr.selected.backend == IBM
    assert ibm.calls == 1 and cq.calls == 0


def test_fallback_on_error_uses_secondary(settings, pricing):
    ibm = StubBackend(IBM, error=RuntimeError("boom"))
    cq = StubBackend(CLASSIQ)
    rr = _route(
        _router(settings, pricing, ibm, cq),
        RedundancyMode(mode=RedundancyModeName.fallback, primary=IBM),
    )
    assert rr.selected.backend == CLASSIQ
    assert "fallback due to error" in rr.selection_reason
    assert rr.outcomes[IBM].status == "error"


def test_fallback_on_timeout(settings, pricing):
    ibm = StubBackend(IBM, delay=1.0)
    cq = StubBackend(CLASSIQ)
    mode = RedundancyMode(mode=RedundancyModeName.fallback, primary=IBM, timeout_sec=0.2)
    rr = _route(_router(settings, pricing, ibm, cq), mode)
    assert rr.outcomes[IBM].status == "timeout"
    assert rr.selected.backend == CLASSIQ
    assert "fallback due to timeout" in rr.selection_reason


def test_fallback_not_applicable_reason(settings, pricing):
    cq = StubBackend(CLASSIQ, error=NotApplicable("needs qmod"))
    rr = _route(
        _router(settings, pricing, StubBackend(IBM), cq),
        RedundancyMode(mode=RedundancyModeName.fallback, primary=CLASSIQ),
    )
    assert rr.outcomes[CLASSIQ].status == "not_applicable"
    assert rr.selected.backend == IBM


def test_parallel_selects_lowest_qpu_cost(settings, pricing):
    ibm = StubBackend(IBM, depth=30, duration=5e-6)
    cq = StubBackend(CLASSIQ, depth=26, duration=4e-6)
    rr = _route(
        _router(settings, pricing, ibm, cq), RedundancyMode(mode=RedundancyModeName.parallel)
    )
    assert rr.selected.backend == CLASSIQ
    assert "lowest estimated QPU cost" in rr.selection_reason
    assert set(rr.backends_used) == {IBM, CLASSIQ}


def test_parallel_selection_metric_gate_count(settings, pricing):
    ibm = StubBackend(IBM, depth=30, duration=1e-6, gate_count=50)
    cq = StubBackend(CLASSIQ, depth=26, duration=9e-6, gate_count=80)
    mode = RedundancyMode(
        mode=RedundancyModeName.parallel, selection_metric=SelectionMetric.gate_count
    )
    rr = _route(_router(settings, pricing, ibm, cq), mode)
    assert rr.selected.backend == IBM


def test_parallel_both_fail(settings, pricing):
    rr = _route(
        _router(
            settings,
            pricing,
            StubBackend(IBM, error=RuntimeError("a")),
            StubBackend(CLASSIQ, error=RuntimeError("b")),
        ),
        RedundancyMode(mode=RedundancyModeName.parallel),
    )
    assert rr.selected is None


@pytest.mark.parametrize("fmt", [CircuitFormat.openqasm2])
def test_auto_small_circuit_is_ibm_single(settings, pricing, fmt):
    ibm, cq = StubBackend(IBM), StubBackend(CLASSIQ)
    rr = _route(
        _router(settings, pricing, ibm, cq), RedundancyMode(), requested=OptimizationBackend.auto
    )
    assert rr.mode_used == RedundancyModeName.single
    assert cq.calls == 0
    assert "auto:" in rr.selection_reason
