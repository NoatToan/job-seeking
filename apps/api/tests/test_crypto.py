"""`ujc_api.crypto`: AES-GCM credential encryption, keyed off `UJC_SECRET_KEY` via HKDF
(M3-01 — `platform_connections.credentials_encrypted` must never hold plaintext)."""

import pytest

from ujc_api.crypto import DecryptionError, decrypt_json, encrypt_json


def test_round_trip():
    secret = "unit-test-secret-key"
    data = {"appId": "abc123", "appKey": "topsecretkey"}
    blob = encrypt_json(secret, data)
    assert decrypt_json(secret, blob) == data


def test_ciphertext_never_contains_the_plaintext():
    secret = "unit-test-secret-key"
    data = {"appId": "abc123", "appKey": "topsecretvalue"}
    blob = encrypt_json(secret, data)
    assert b"topsecretvalue" not in blob
    assert b"abc123" not in blob


def test_two_encryptions_of_the_same_data_differ():
    """Random nonce per call: no two ciphertexts for the same plaintext look alike."""
    secret = "unit-test-secret-key"
    data = {"appId": "abc123", "appKey": "topsecretkey"}
    assert encrypt_json(secret, data) != encrypt_json(secret, data)


def test_wrong_key_fails_to_decrypt():
    blob = encrypt_json("correct-secret", {"a": 1})
    with pytest.raises(DecryptionError):
        decrypt_json("wrong-secret", blob)


def test_tampered_ciphertext_fails_to_decrypt():
    blob = bytearray(encrypt_json("unit-test-secret-key", {"a": 1}))
    blob[-1] ^= 0xFF
    with pytest.raises(DecryptionError):
        decrypt_json("unit-test-secret-key", bytes(blob))
