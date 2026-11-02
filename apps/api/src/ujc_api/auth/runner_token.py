"""Runner bearer tokens: `ujc_run_<random>`, sha256-hashed like session tokens
(`ujc_api.auth.session`). Shown once at pairing time; only the hash is ever stored."""

import hashlib
import secrets

TOKEN_PREFIX = "ujc_run_"


def generate_runner_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_runner_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
