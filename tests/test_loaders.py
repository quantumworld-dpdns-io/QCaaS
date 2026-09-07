import pytest

from qcaas.core.circuits import load_circuit
from qcaas.core.circuits.loader import ensure_measured
from qcaas.core.errors import InvalidCircuit, UnsupportedFormat
from qcaas.schemas.common import CircuitFormat

from .conftest import BELL_QASM2, BELL_QASM3, GHZ_JSON


def test_qasm2_loads():
    loaded = load_circuit(CircuitFormat.openqasm2, BELL_QASM2)
    assert loaded.circuit is not None and loaded.circuit.num_qubits == 2
    assert not loaded.is_qmod


def test_qasm3_loads():
    loaded = load_circuit(CircuitFormat.openqasm3, BELL_QASM3)
    assert loaded.circuit.num_qubits == 2
    assert loaded.circuit.count_ops()["measure"] == 2


def test_json_gate_list():
    loaded = load_circuit(CircuitFormat.json, GHZ_JSON)
    ops = loaded.circuit.count_ops()
    assert ops["cx"] == 2 and ops["h"] == 1 and ops["measure"] == 3


def test_json_as_string_and_errors():
    assert (
        load_circuit(CircuitFormat.json, '{"num_qubits": 1, "gates": []}').circuit.num_qubits == 1
    )
    with pytest.raises(InvalidCircuit):
        load_circuit(CircuitFormat.json, {"gates": []})
    with pytest.raises(InvalidCircuit):
        load_circuit(
            CircuitFormat.json, {"num_qubits": 2, "gates": [{"name": "evil", "qubits": [0]}]}
        )
    with pytest.raises(InvalidCircuit):
        load_circuit(
            CircuitFormat.json, {"num_qubits": 2, "gates": [{"name": "cx", "qubits": [0, 5]}]}
        )


def test_qiskit_python_rejected_with_guidance():
    with pytest.raises(UnsupportedFormat) as exc:
        load_circuit(CircuitFormat.qiskit_python, "from qiskit import *")
    assert "qasm3" in (exc.value.detail or "")


def test_invalid_qasm_is_422_error():
    with pytest.raises(InvalidCircuit):
        load_circuit(CircuitFormat.openqasm2, "OPENQASM 2.0; nonsense")


def test_qmod_passthrough():
    loaded = load_circuit(CircuitFormat.qmod, '{"functions": []}')
    assert loaded.is_qmod and loaded.circuit is None


def test_ensure_measured_adds_measurements():
    loaded = load_circuit(
        CircuitFormat.json, {"num_qubits": 2, "gates": [{"name": "h", "qubits": [0]}]}
    )
    assert "measure" not in loaded.circuit.count_ops()
    assert ensure_measured(loaded.circuit).count_ops()["measure"] == 2
