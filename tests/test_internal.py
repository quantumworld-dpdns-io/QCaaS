from .conftest import BELL_QASM2

ADMIN = {"X-Admin-Token": "admin-test-token"}


def test_internal_requires_admin_token(client):
    assert client.get("/internal/customers").status_code == 401
    assert client.get("/internal/customers", headers={"X-Admin-Token": "wrong"}).status_code == 401


def test_internal_hidden_from_openapi(client):
    assert not any(p.startswith("/internal") for p in client.get("/openapi.json").json()["paths"])


def test_provision_customer_and_use_key(client):
    r = client.post(
        "/internal/customers",
        json={"name": "Acme", "plan": "flex", "retention_days": 7, "external_id": "acct-1"},
        headers=ADMIN,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["api_key"].startswith("qc_") and body["plan"] == "flex"
    key = body["api_key"]
    # duplicate external_id -> 409
    dup = client.post(
        "/internal/customers", json={"name": "Acme2", "external_id": "acct-1"}, headers=ADMIN
    )
    assert dup.status_code == 409

    # the provisioned key works on the public API
    q = client.post(
        "/v2/quote",
        json={"circuit_format": "openqasm2", "circuit_payload": BELL_QASM2},
        headers={"X-API-Key": key},
    )
    assert q.status_code == 200

    # jobs visible cross-customer with customer_id
    jobs = client.get(f"/internal/jobs?customer_id={body['customer_id']}", headers=ADMIN).json()
    assert jobs["total"] == 1 and jobs["items"][0]["customer_id"] == body["customer_id"]

    # deactivate -> key stops working
    p = client.patch(
        f"/internal/customers/{body['customer_id']}", json={"active": False}, headers=ADMIN
    )
    assert p.status_code == 200 and p.json()["active"] is False
    assert client.get("/v2/jobs", headers={"X-API-Key": key}).status_code == 401

    lst = client.get("/internal/customers", headers=ADMIN).json()
    assert any(c["customer_id"] == body["customer_id"] for c in lst["items"])


def test_internal_stats(client):
    s = client.get("/internal/stats", headers=ADMIN)
    assert s.status_code == 200
    data = s.json()
    assert data["customers"] >= 1
    assert "by_kind" in data["jobs"] and "revenue_usd" in data
