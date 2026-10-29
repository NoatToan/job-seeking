"""6-digit email OTP: generation, HMAC hashing, DB-backed rate limits, verification.

Codes are never logged (only their HMAC-SHA256 hash is persisted) and never compared with `==`
(timing-safe `hmac.compare_digest`), matching the hashed-token conventions elsewhere in the repo.
"""

import hashlib
import hmac
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import psycopg

from ujc_api.auth.ratelimit import SlidingWindowRateLimiter
from ujc_api.settings import Settings

CODE_DIGITS = 6
OTP_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
EMAIL_COOLDOWN_SECONDS = 60
EMAIL_MAX_PER_HOUR = 5
IP_MAX_PER_HOUR = 20

# Process-wide: email_otps has no IP column (see auth/ratelimit.py for why this is in-memory).
ip_rate_limiter = SlidingWindowRateLimiter(max_count=IP_MAX_PER_HOUR, window_seconds=3600)


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limited")
        self.retry_after = retry_after


class InvalidCode(Exception):
    pass


class CodeExpired(Exception):
    pass


class TooManyAttempts(Exception):
    pass


def generate_code() -> str:
    """A 6-digit code from `secrets` (cryptographically strong), zero-padded."""
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def hash_code(secret_key: str, email: str, code: str) -> str:
    message = f"{email}|{code}".encode()
    return hmac.new(secret_key.encode(), message, hashlib.sha256).hexdigest()


def check_email_rate_limit(conn: psycopg.Connection, email: str) -> None:
    """1 per 60 s and 5 per hour per email, counted from `email_otps` rows (DB-based)."""
    row = conn.execute(
        "SELECT count(*) FILTER (WHERE created_at > now() - interval '60 seconds'),"
        "       count(*) FILTER (WHERE created_at > now() - interval '1 hour')"
        " FROM email_otps WHERE email = %s",
        (email,),
    ).fetchone()
    assert row is not None
    last_minute, last_hour = row
    if last_minute:
        raise RateLimited(retry_after=EMAIL_COOLDOWN_SECONDS)
    if last_hour >= EMAIL_MAX_PER_HOUR:
        raise RateLimited(retry_after=3600)


def check_ip_rate_limit(ip: str, limiter: SlidingWindowRateLimiter | None = None) -> None:
    """20 per hour per IP (in-memory; see auth/ratelimit.py)."""
    limiter = limiter or ip_rate_limiter
    if not limiter.allow(ip):
        raise RateLimited(retry_after=3600)


def create(conn: psycopg.Connection, settings: Settings, email: str) -> tuple[str, int]:
    """Inserts a fresh OTP row for `email`. Returns `(code, expires_in_seconds)`.

    Callers must check `check_email_rate_limit`/`check_ip_rate_limit` first.
    """
    code = generate_code()
    code_hash = hash_code(settings.ujc_secret_key, email, code)
    expires_at = datetime.now(UTC) + OTP_TTL
    conn.execute(
        "INSERT INTO email_otps (email, code_hash, expires_at) VALUES (%s, %s, %s)",
        (email, code_hash, expires_at),
    )
    return code, int(OTP_TTL.total_seconds())


def verify(
    conn: psycopg.Connection,
    settings: Settings,
    email: str,
    code: str,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    """Verifies `code` for `email`'s most recent, unconsumed OTP.

    Returns the matching `email_otps.id`. Raises `InvalidCode` (400), `CodeExpired` (410) or
    `TooManyAttempts` (429) otherwise. Locks the row (`FOR UPDATE`) so concurrent verify attempts
    for the same email serialise instead of racing the attempt counter. `now` is injectable so
    expiry can be tested without a real 10-minute sleep.
    """
    row = conn.execute(
        "SELECT id, code_hash, expires_at, attempts FROM email_otps"
        " WHERE email = %s AND consumed_at IS NULL"
        " ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        (email,),
    ).fetchone()
    if row is None:
        raise InvalidCode()
    otp_id, code_hash, expires_at, attempts = row
    if attempts >= MAX_ATTEMPTS:
        raise TooManyAttempts()
    if expires_at < now():
        raise CodeExpired()
    expected = hash_code(settings.ujc_secret_key, email, code)
    if not hmac.compare_digest(expected, code_hash):
        conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE id = %s", (otp_id,))
        if attempts + 1 >= MAX_ATTEMPTS:
            raise TooManyAttempts()
        raise InvalidCode()
    conn.execute("UPDATE email_otps SET consumed_at = now() WHERE id = %s", (otp_id,))
    return otp_id
