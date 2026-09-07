from __future__ import annotations

import hashlib
import hmac
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..storage.models import Customer

KEY_PREFIX = "qc_"


def generate_api_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def hash_api_key(key: str, salt: str) -> str:
    return hmac.new(salt.encode("utf-8"), key.encode("utf-8"), hashlib.sha256).hexdigest()


def create_customer(
    session: Session,
    name: str,
    salt: str,
    plan: str = "payg",
    retention_days: int = 30,
    api_key: str | None = None,
) -> tuple[Customer, str]:
    key = api_key or generate_api_key()
    customer = Customer(
        name=name,
        key_hash=hash_api_key(key, salt),
        key_prefix=key[:8],
        plan=plan,
        retention_days=retention_days,
    )
    session.add(customer)
    session.flush()
    return customer, key


def find_customer_by_key(session: Session, key: str, salt: str) -> Customer | None:
    h = hash_api_key(key, salt)
    return session.scalar(select(Customer).where(Customer.key_hash == h, Customer.active.is_(True)))


def ensure_dev_customer(session: Session, key: str, salt: str) -> Customer:
    existing = find_customer_by_key(session, key, salt)
    if existing:
        return existing
    customer, _ = create_customer(session, "dev", salt, api_key=key)
    return customer
