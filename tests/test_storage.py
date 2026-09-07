from datetime import UTC, datetime, timedelta

from qcaas.auth.api_key import create_customer, find_customer_by_key, hash_api_key
from qcaas.storage.crypto import decrypt_text, encrypt_text
from qcaas.storage.db import session_factory
from qcaas.storage.models import Job
from qcaas.storage.retention import expiry_for, purge_expired


def test_api_key_hashing_is_salted():
    assert hash_api_key("k", "a") != hash_api_key("k", "b")
    assert hash_api_key("k", "a") == hash_api_key("k", "a")


def test_create_and_find_customer(client):
    with session_factory()() as s:
        customer, key = create_customer(s, "acme", "test-salt", plan="flex", retention_days=7)
        s.commit()
        assert key.startswith("qc_")
        found = find_customer_by_key(s, key, "test-salt")
        assert found is not None and found.id == customer.id and found.plan == "flex"
        assert find_customer_by_key(s, key, "other-salt") is None


def test_encrypt_roundtrip_and_wrong_key():
    token = encrypt_text('{"a": 1}', "secret", "salt")
    assert decrypt_text(token, "secret", "salt") == '{"a": 1}'
    assert decrypt_text(token, "wrong", "salt") is None
    assert decrypt_text(token, "secret", "other-salt") is None


def test_retention_purge(client):
    with session_factory()() as s:
        customer, _ = create_customer(s, "purge-me", "test-salt", retention_days=0)
        job = Job(
            customer_id=customer.id,
            kind="quote",
            request_json="{}",
            response_json="{}",
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        keep = Job(
            customer_id=customer.id, kind="quote", request_json="{}", expires_at=expiry_for(30)
        )
        s.add_all([job, keep])
        s.commit()
        n = purge_expired(s)
        s.commit()
        assert n >= 1
        s.refresh(job)
        s.refresh(keep)
        assert job.request_json is None and job.purged_at is not None
        assert keep.request_json == "{}"
