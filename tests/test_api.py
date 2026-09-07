import pytest

from qcaas.core.backends.router import CLASSIQ, IBM

from .conftest import BELL_QASM2, GHZ_JSON, StubBackend


def _optimize_body(**overrides):
    body = {"circuit_format": "openqasm2", "circuit_payload": BELL_QASM2, "shots": 1024}
    body.update(overrides)
    return body


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["offline_mode"] is True


def test_missing_api_key_is_401(client):
    r = client.post("/v2/quote", json=_optimize_body())
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "ApiKey"


def test_wrong_api_key_is_401(client):
    r = client.post("/v2/quote", json=_optimize_body(), headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_qiskit_python_is_422(client, headers):
    r = client.post(
        "/v2/optimize", json=_optimize_body(circuit_format="qiskit_python"), headers=headers
    )
    assert r.status_code == 422
    assert r.json()["code"] == "unsupported_format"
    assert "qasm3" in r.json()["detail"]


def test_unknown_backend_is_404(client, headers):
    r = client.post(
        "/v2/optimize", json=_optimize_body(target_backend="ibm_nowhere"), headers=headers
    )
    assert r.status_code == 404
    assert r.json()["code"] == "backend_not_found"


def test_validation_error_shape(client, headers):
    r = client.post("/v2/optimize", json={"circuit_format": "openqasm2"}, headers=headers)
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


def test_quote_returns_both_backends_and_validity(client, headers):
    r = client.post("/v2/quote", json=_optimize_body(shots=4096), headers=headers)
    assert r.status_code == 200
    q = r.json()
    assert set(q["estimates"]) == {"ibm_composer", "classiq"}
    assert q["estimates"]["ibm_composer"]["status"] == "estimated"
    assert q["estimates"]["classiq"]["status"] == "assumed"
    assert q["estimated_qpu_cost_usd"] > 0
    assert q["recommended_backend"] in {"ibm_composer", "classiq"}
    assert q["valid_until"] > q["created_at"]
    assert set(q["estimates"]["ibm_composer"]["estimated_qpu_cost_usd"]) == {
        "payg",
        "flex",
        "premium",
    }


def test_optimize_full_response_shape(client, headers):
    body = _optimize_body(target_bitstrings=["00", "11"], context={"algorithm": "QAOA"})
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 200, r.text
    o = r.json()
    for key in (
        "job_id", "status", "transpiled_circuit", "gate_count_before", "gate_count_after", "depth_before",
        "depth_after", "estimated_qpu_runtime_sec", "estimated_qpu_cost_usd", "simulation_result",
        "interpretation", "billing", "selected_result", "results", "backends_used",
    ):  # fmt: skip
        assert key in o, key
    assert o["selected_result"]["backend"] == "ibm_composer"
    assert o["transpiled_circuit"]["source"].startswith("OPENQASM 3")
    assert sum(o["simulation_result"]["counts"].values()) == 1024
    assert o["interpretation"]["success_probability"] > 0.9
    assert o["billing"]["total_usd"] == round(
        o["billing"]["qpu_cost_usd"] + o["billing"]["service_fee_usd"], 2
    )
    assert r.headers["X-RateLimit-Limit"]


def test_optimize_json_input_no_simulation(client, headers):
    body = {"circuit_format": "json", "circuit_payload": GHZ_JSON, "include_simulation": False,
            "optimization_backend": "ibm_composer", "redundancy_mode": {"mode": "single"}}  # fmt: skip
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 200
    assert r.json()["simulation_result"] is None
    assert r.json()["gate_count_before"] == 3


def test_optimize_noisy_simulation(client, headers):
    r = client.post(
        "/v2/optimize", json=_optimize_body(noisy_simulation=True, shots=512), headers=headers
    )
    assert r.status_code == 200
    sim = r.json()["simulation_result"]
    assert sim["noisy"] is True and sum(sim["counts"].values()) == 512


def test_optimize_constraint_violation_surfaces_in_recommendations(client, headers):
    r = client.post(
        "/v2/optimize", json=_optimize_body(constraints={"max_depth": 1}), headers=headers
    )
    assert r.status_code == 200
    o = r.json()
    assert o["results"]["ibm_composer"]["metrics"]["constraint_violations"]
    assert any("constraints were not met" in x for x in o["interpretation"]["recommendations"])


def test_execute_on_qpu_is_blocked_by_default(client, headers):
    r = client.post(
        "/v2/optimize",
        json=_optimize_body(execute_on_qpu=True, include_simulation=False),
        headers=headers,
    )
    assert r.status_code == 200
    q = r.json()["qpu_execution"]
    assert q["submitted"] is False and "disabled" in q["message"]


def test_classiq_not_applicable_without_credentials(client, headers):
    body = _optimize_body(optimization_backend="classiq", include_simulation=False,
                          redundancy_mode={"mode": "fallback", "primary": "classiq"})  # fmt: skip
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 200
    o = r.json()
    assert o["results"]["classiq"]["status"] == "not_applicable"
    assert o["selected_result"]["backend"] == "ibm_composer"
    assert "fallback due to not_applicable" in o["selected_result"]["reason"]


@pytest.fixture
def stubbed_router(app):
    router = app.state.router
    original = dict(router.backends)
    yield router
    router.backends = original


def test_parallel_picks_cheaper_classiq_and_bills_platform_fee(
    client, headers, stubbed_router, pricing
):
    stubbed_router.backends = {
        IBM: StubBackend(IBM, depth=30, duration=5e-3),
        CLASSIQ: StubBackend(CLASSIQ, depth=26, duration=4e-3),
    }
    body = _optimize_body(optimization_backend="ibm_composer", include_simulation=False,
                          redundancy_mode={"mode": "parallel"})  # fmt: skip
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["selected_result"]["backend"] == "classiq"
    assert o["selected_result"]["depth"] == 26
    assert set(o["backends_used"]) == {"ibm_composer", "classiq"}
    assert o["billing"]["classiq_platform_fee_usd"] == pricing.classiq_fee_per_job
    assert (
        o["results"]["ibm_composer"]["estimated_qpu_cost_usd"]
        > o["results"]["classiq"]["estimated_qpu_cost_usd"]
    )


def test_fallback_timeout_reason_in_response(client, headers, stubbed_router):
    stubbed_router.backends = {IBM: StubBackend(IBM, delay=1.0), CLASSIQ: StubBackend(CLASSIQ)}
    body = _optimize_body(optimization_backend="ibm_composer", include_simulation=False,
                          redundancy_mode={"mode": "fallback", "primary": "ibm_composer", "timeout_sec": 0.2})  # fmt: skip
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 200
    o = r.json()
    assert o["results"]["ibm_composer"]["status"] == "timeout"
    assert o["selected_result"]["backend"] == "classiq"
    assert "fallback due to timeout" in o["selected_result"]["reason"]


def test_all_backends_fail_is_503_and_recorded(client, headers, stubbed_router):
    stubbed_router.backends = {
        IBM: StubBackend(IBM, error=RuntimeError("x")),
        CLASSIQ: StubBackend(CLASSIQ, error=RuntimeError("y")),
    }
    body = _optimize_body(optimization_backend="ibm_composer", redundancy_mode={"mode": "parallel"})
    r = client.post("/v2/optimize", json=body, headers=headers)
    assert r.status_code == 503
    assert r.json()["code"] == "backend_unavailable"
    jobs = client.get("/v2/jobs?kind=optimize", headers=headers).json()
    assert any(j["status"] == "failed" for j in jobs["items"])


def test_interpret_endpoint(client, headers):
    body = {
        "result_format": "counts_dict",
        "result_payload": {"00": 480, "11": 496, "01": 24, "10": 24},
        "target_bitstrings": ["00", "11"],
        "context": {
            "algorithm": "QAOA",
            "problem_description": "portfolio optimization with 10 assets",
        },
        "target_backend": "ibm_sherbrooke",
        "physical_qubits": [0, 1],
    }
    r = client.post("/v2/interpret", json=body, headers=headers)
    assert r.status_code == 200
    o = r.json()
    assert "95%" in o["summary"]
    assert o["billing"]["qpu_cost_usd"] == 0.0 and o["billing"]["total_usd"] > 0
    assert o["key_metrics"]["success_probability"] == pytest.approx(0.9531, abs=1e-3)
    assert isinstance(o["noise_analysis"], list)


def test_interpret_csv_format(client, headers):
    body = {
        "result_format": "csv",
        "result_payload": "bitstring,count\n0,90\n1,10\n",
        "target_bitstrings": ["0"],
    }
    r = client.post("/v2/interpret", json=body, headers=headers)
    assert r.status_code == 200
    assert r.json()["interpretation"]["success_probability"] == 0.9


def test_jobs_list_and_detail(client, headers):
    r = client.post("/v2/optimize", json=_optimize_body(include_simulation=False), headers=headers)
    job_id = r.json()["job_id"]
    lst = client.get("/v2/jobs", headers=headers).json()
    assert lst["total"] >= 1 and any(j["job_id"] == job_id for j in lst["items"])
    d = client.get(f"/v2/jobs/{job_id}", headers=headers).json()
    assert d["kind"] == "optimize"
    assert d["request"]["circuit_format"] == "openqasm2"
    assert d["response"]["job_id"] == job_id
    assert d["backend_results"] and d["backend_results"][0]["selected"] is True
    assert d["expires_at"] is not None


def test_job_not_found_and_other_customer(client, headers):
    assert client.get("/v2/jobs/doesnotexist", headers=headers).status_code == 404


def test_payload_encryption_roundtrip(client, headers):
    enc = {**headers, "X-Payload-Key": "customer-secret"}
    r = client.post("/v2/quote", json=_optimize_body(), headers=enc)
    job_id = r.json()["quote_id"]
    without = client.get(f"/v2/jobs/{job_id}", headers=headers).json()
    assert without["request"] == {"encrypted": True}
    wrong = client.get(f"/v2/jobs/{job_id}", headers={**headers, "X-Payload-Key": "bad"}).json()
    assert wrong["request"]["encrypted"] is True and "error" in wrong["request"]
    right = client.get(f"/v2/jobs/{job_id}", headers=enc).json()
    assert right["request"]["circuit_format"] == "openqasm2"
    assert right["response"]["quote_id"] == job_id


def test_openapi_lists_v2_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert {
        "/v2/optimize",
        "/v2/quote",
        "/v2/interpret",
        "/v2/jobs",
        "/v2/jobs/{job_id}",
        "/healthz",
    } <= set(paths)
