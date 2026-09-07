"""Simple gate-list JSON circuit format.

{
  "num_qubits": 2,
  "num_clbits": 2,            # optional, defaults to num_qubits
  "gates": [
    {"name": "h",  "qubits": [0]},
    {"name": "cx", "qubits": [0, 1]},
    {"name": "rz", "qubits": [0], "params": [1.5707]},
    {"name": "measure", "qubits": [0, 1], "clbits": [0, 1]}
  ],
  "measure_all": false        # optional convenience
}
"""

from __future__ import annotations

from typing import Any

from qiskit import QuantumCircuit

from ..errors import InvalidCircuit

_ALLOWED = {
    "h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "sxdg", "id",
    "rx", "ry", "rz", "p", "u", "u1", "u2", "u3",
    "cx", "cy", "cz", "ch", "swap", "iswap", "ecr", "cp", "crx", "cry", "crz", "rzz", "rxx", "ryy",
    "ccx", "cswap", "reset", "barrier", "measure",
}  # fmt: skip


def circuit_from_json(obj: dict[str, Any]) -> QuantumCircuit:
    try:
        n = int(obj["num_qubits"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidCircuit("json circuit requires integer 'num_qubits'") from exc
    if n < 1 or n > 1000:
        raise InvalidCircuit("num_qubits must be between 1 and 1000")
    m = int(obj.get("num_clbits", n))
    qc = QuantumCircuit(n, m)
    gates = obj.get("gates", [])
    if not isinstance(gates, list):
        raise InvalidCircuit("'gates' must be a list")
    for i, g in enumerate(gates):
        name = str(g.get("name", "")).lower()
        if name not in _ALLOWED:
            raise InvalidCircuit(f"gate #{i}: unsupported gate '{name}'")
        qubits = [int(q) for q in g.get("qubits", [])]
        if any(q < 0 or q >= n for q in qubits):
            raise InvalidCircuit(f"gate #{i}: qubit index out of range")
        params = [float(p) for p in g.get("params", [])]
        try:
            if name == "measure":
                clbits = [int(c) for c in g.get("clbits", qubits)]
                qc.measure(qubits, clbits)
            elif name == "barrier":
                qc.barrier(*qubits) if qubits else qc.barrier()
            else:
                getattr(qc, name)(*params, *qubits)
        except Exception as exc:  # noqa: BLE001 - surface any construction error as 422
            raise InvalidCircuit(f"gate #{i} ({name}): {exc}") from exc
    if obj.get("measure_all"):
        qc.measure_all()
    return qc
