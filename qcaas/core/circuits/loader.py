from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from qiskit import QuantumCircuit

from ...schemas.common import CircuitFormat
from ..errors import InvalidCircuit, UnsupportedFormat
from .json_circuit import circuit_from_json

QISKIT_PYTHON_GUIDANCE = (
    "Executing customer Python is disabled for security. Export your circuit with "
    "`qiskit.qasm3.dumps(qc)` (circuit_format='openqasm3') or "
    "`qiskit.qasm2.dumps(qc)` (circuit_format='openqasm2') and resend."
)

MAX_PAYLOAD_CHARS = 2_000_000


@dataclass
class LoadedCircuit:
    format: CircuitFormat
    circuit: QuantumCircuit | None
    qmod: str | None = None
    source: str | None = None

    @property
    def is_qmod(self) -> bool:
        return self.circuit is None and self.qmod is not None


def load_circuit(fmt: CircuitFormat, payload: str | dict[str, Any]) -> LoadedCircuit:
    if fmt == CircuitFormat.qiskit_python:
        raise UnsupportedFormat(
            "circuit_format 'qiskit_python' is not accepted", QISKIT_PYTHON_GUIDANCE
        )

    if isinstance(payload, str) and len(payload) > MAX_PAYLOAD_CHARS:
        raise InvalidCircuit("circuit_payload too large")

    if fmt == CircuitFormat.json:
        obj = payload
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except json.JSONDecodeError as exc:
                raise InvalidCircuit("circuit_payload is not valid JSON") from exc
        if not isinstance(obj, dict):
            raise InvalidCircuit("json circuit must be an object")
        return LoadedCircuit(fmt, circuit_from_json(obj), source=json.dumps(obj))

    if not isinstance(payload, str):
        raise InvalidCircuit(f"circuit_payload must be a string for format {fmt.value}")

    if fmt == CircuitFormat.openqasm2:
        from qiskit import qasm2

        try:
            qc = qasm2.loads(payload, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)
        except Exception as exc:  # noqa: BLE001
            raise InvalidCircuit("OpenQASM 2 parse error", str(exc)) from exc
        return LoadedCircuit(fmt, qc, source=payload)

    if fmt == CircuitFormat.openqasm3:
        from qiskit import qasm3

        try:
            qc = qasm3.loads(payload)
        except Exception as exc:  # noqa: BLE001
            raise InvalidCircuit("OpenQASM 3 parse error", str(exc)) from exc
        return LoadedCircuit(fmt, qc, source=payload)

    if fmt == CircuitFormat.qmod:
        text = payload.strip()
        if not text:
            raise InvalidCircuit("qmod payload is empty")
        return LoadedCircuit(fmt, None, qmod=text, source=text)

    raise UnsupportedFormat(f"unknown circuit_format {fmt}")


def ensure_measured(qc: QuantumCircuit) -> QuantumCircuit:
    """Return a circuit that has measurements (needed for sampling)."""
    if qc.num_clbits and any(inst.operation.name == "measure" for inst in qc.data):
        return qc
    qc2 = qc.copy()
    qc2.measure_all()
    return qc2
