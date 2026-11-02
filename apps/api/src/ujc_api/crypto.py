"""At-rest encryption for third-party credentials (`platform_connections.credentials_encrypted`,
docs/product/ARCHITECTURE.md §9).

AES-256-GCM (via the `cryptography` package) with a key derived from `Settings.ujc_secret_key`
through HKDF-SHA256, so no separate encryption key needs to be provisioned. `encrypt_json` /
`decrypt_json` are the only entry points; the stored bytes are `nonce (12B) || ciphertext+tag`.

Rotation: this derives one key from the *current* `UJC_SECRET_KEY`. Rotating that key also
invalidates stored credentials (acceptable for connections: the user just reconnects); unlike
the multi-key design sketched in docs/product/ARCHITECTURE.md, there is no second key to decrypt
old data with. Noted as a follow-up if that turns out to matter in practice.
"""

import json
import os
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_HKDF_INFO = b"ujc_api.crypto.platform_connections.v1"
_NONCE_LEN = 12


class DecryptionError(Exception):
    """The ciphertext could not be decrypted/authenticated with the current key."""


def _derive_key(secret_key: str) -> bytes:
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO)
    return hkdf.derive(secret_key.encode("utf-8"))


def encrypt_json(secret_key: str, data: dict[str, Any]) -> bytes:
    """Encrypts a JSON-serialisable dict. Returns `nonce || ciphertext` bytes for a `BYTEA`
    column."""
    key = _derive_key(secret_key)
    nonce = os.urandom(_NONCE_LEN)
    plaintext = json.dumps(data).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return nonce + ciphertext


def decrypt_json(secret_key: str, blob: bytes) -> dict[str, Any]:
    """Inverse of `encrypt_json`. Raises `DecryptionError` if the key is wrong or the blob was
    tampered with (GCM authentication failure)."""
    if len(blob) <= _NONCE_LEN:
        raise DecryptionError("ciphertext too short")
    key = _derive_key(secret_key)
    nonce, ciphertext = blob[:_NONCE_LEN], blob[_NONCE_LEN:]
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except Exception as exc:  # cryptography raises InvalidTag
        raise DecryptionError("could not decrypt: wrong key or corrupted data") from exc
    return json.loads(plaintext)
