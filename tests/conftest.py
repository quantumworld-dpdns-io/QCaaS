from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from qiskit import QuantumCircuit

from qcaas.config import Settings
from qcaas.core.backends.base import OptimizationOutcome
from qcaas.core.cost.pricing import get_pricing
from qcaas.main import create_app
from qcaas.schemas.common import OptimizationBackend
from qcaas.schemas.optimize import CircuitMetrics

TEST_KEY = "qc_test_key"
BELL_QASM2 = (
    'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n'
    "h q[0];\ncx q[0],q[1];\nmeasure q -> c;\n"
)
BELL_QASM3 = (
    'OPENQASM 3.0;\ninclude "stdgates.inc";\nbit[2] c;\nqubit[2] q;\n'
    "h q[0];\ncx q[0], q[1];\nc[0] = measure q[0];\nc[1] = measure q[1];\n"
)
GHZ_JSON = {
    "num_qubits": 3,
    "gates": [
        {"name": "h", "qubits": [0]},
        {"name": "cx", "qubits": [0, 1]},
        {"name": "cx", "qubits": [1, 2]},
    ],
    "measure_all": True,
}


@pytest.fixture(scope="session")
def settings() -> Settings:
    tmp = Path(tempfile.mkdtemp(prefix="qcaas-test-"))
    os.environ.pop("QCAAS_DATABASE_URL", None)
    return Settings(
        database_url=f"sqlite:///{(tmp / 'test.db').as_posix()}",
        dev_api_key=TEST_KEY,
        api_key_salt="test-salt",
        offline_mode=True,
        rate_limit_per_minute=1000,
        admin_token="admin-test-token",
        fallback_timeout_sec=5,
        _env_file=None,
    )


@pytest.fixture(scope="session")
def pricing(settings):
    return get_pricing(settings.pricing_path)


@pytest.fixture(scope="session")
def app(settings):
    return create_app(settings)


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def headers() -> dict[str, str]:
    return {"X-API-Key": TEST_KEY}


def bell_circuit() -> QuantumCircuit:
    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure([0, 1], [0, 1])
    return qc


class StubBackend:
    """Deterministic optimizer backend for router/API tests (no SDK calls)."""

    def __init__(
        self,
        name: OptimizationBackend,
        depth: int = 10,
        duration: float = 1e-6,
        delay: float = 0.0,
        error: Exception | None = None,
        gate_count: int = 12,
    ):
        self.name = name
        self.depth = depth
        self.duration = duration
        self.delay = delay
        self.error = error
        self.gate_count = gate_count
        self.calls = 0

    def optimize(self, loaded, req) -> OptimizationOutcome:
        import time

        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error
        qc = bell_circuit()
        from qiskit import qasm3

        return OptimizationOutcome(
            backend=self.name,
            status="success",
            circuit=qc,
            metrics=CircuitMetrics(
                depth=self.depth,
                gate_count=self.gate_count,
                two_qubit_gate_count=1,
                width=2,
                estimated_duration_sec=self.duration,
            ),
            qasm=qasm3.dumps(qc),
            duration_ms=1,
        )
