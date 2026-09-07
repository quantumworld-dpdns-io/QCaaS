import pytest
from qiskit import QuantumCircuit

from qcaas.core.errors import InvalidCircuit
from qcaas.core.interpret.report import build_interpretation
from qcaas.core.interpret.rules import (
    NoiseAnalysis,
    analyze_counts,
    parse_counts,
)
from qcaas.core.metrics import DurationDefaults, compute_metrics, critical_path_duration
from qcaas.schemas.common import Constraints, ResultFormat
from qcaas.schemas.optimize import InterpretContext, NoiseConcern


def _bell():
    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure([0, 1], [0, 1])
    return qc


def test_metrics_counts_gates_not_measurements():
    m = compute_metrics(_bell())
    assert m.gate_count == 2
    assert m.two_qubit_gate_count == 1
    assert m.width == 2
    assert m.depth == 3


def test_critical_path_uses_defaults_without_target():
    d = DurationDefaults(one_qubit_sec=1.0, two_qubit_sec=10.0, measure_sec=100.0)
    # h(1) -> cx(10) -> measure(100) on the critical path
    assert critical_path_duration(_bell(), None, d) == pytest.approx(111.0)


def test_constraint_violations_reported():
    m = compute_metrics(
        _bell(), constraints=Constraints(max_depth=1, max_gate_count=1, max_width=1)
    )
    assert len(m.constraint_violations) == 3


def test_parse_counts_formats():
    assert parse_counts(ResultFormat.counts_dict, {"00": 5, "11": 5}) == {"00": 5, "11": 5}
    assert parse_counts(ResultFormat.counts_dict, {"0x3": 2}) == {"11": 2}
    assert parse_counts(ResultFormat.csv, "bitstring,count\n00,7\n11,3\n") == {"00": 7, "11": 3}
    nested = {"results": [{"data": {"meas": {"counts": {"00": 1, "11": 3}}}}]}
    assert parse_counts(ResultFormat.ibm_job_result_json, nested) == {"00": 1, "11": 3}
    with pytest.raises(InvalidCircuit):
        parse_counts(ResultFormat.counts_dict, {"00": -1})
    with pytest.raises(InvalidCircuit):
        parse_counts(ResultFormat.csv, "no rows here")


def test_analyze_counts_success_probability():
    ca = analyze_counts({"00": 480, "11": 496, "01": 24, "10": 24}, ["00", "11"])
    assert ca.shots == 1024
    assert ca.success_probability == pytest.approx(976 / 1024)
    assert ca.top_bitstring == "11"
    assert ca.concentration == "peaked"


def test_analyze_counts_flat_distribution():
    ca = analyze_counts({f"{i:03b}": 100 for i in range(8)})
    assert ca.concentration == "flat"
    assert ca.success_probability is None


def test_interpretation_recommends_mitigation_for_readout_error():
    ca = analyze_counts({"00": 300, "11": 300, "01": 200, "10": 224}, ["00", "11"])
    na = NoiseAnalysis(
        concerns=[
            NoiseConcern(
                kind="readout_error",
                location="qubit 3",
                value=0.05,
                message="readout error 5% on qubit 3",
            )
        ]
    )
    interp = build_interpretation(
        ca, na, None, InterpretContext(algorithm="QAOA", problem_description="10 assets")
    )
    assert any("measurement error mitigation" in r for r in interp.recommendations)
    assert "readout error 5% on qubit 3" in interp.noise_concerns
    assert "10 assets" in interp.business_interpretation
    assert any("Sweep p" in s for s in interp.next_steps)
    assert interp.confidence in {"low", "medium", "high"}


def test_interpretation_without_counts():
    interp = build_interpretation(None, None, None, None, "ibm_sherbrooke")
    assert interp.success_probability is None
    assert "ibm_sherbrooke" in " ".join(interp.next_steps)
