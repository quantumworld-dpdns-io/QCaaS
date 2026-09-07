"""Optional customer-supplied payload encryption (spec: 客戶自帶加密金鑰).

The customer sends `X-Payload-Key: <secret>`. A Fernet key is derived from it with PBKDF2 and
the server salt; the secret itself is never stored. Without the same header, stored payloads
cannot be read back through the jobs API.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def derive_key(secret: str, salt: str) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=hashlib.sha256(salt.encode()).digest(),
        iterations=200_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(secret.encode("utf-8")))


def encrypt_text(plain: str, secret: str, salt: str) -> str:
    return Fernet(derive_key(secret, salt)).encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_text(token: str, secret: str, salt: str) -> str | None:
    try:
        return Fernet(derive_key(secret, salt)).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
