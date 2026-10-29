"""Server-side sessions: `ujc_session` cookie, sha256-hashed token, 30-day sliding expiry."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import psycopg
from fastapi import Response

from ujc_api.settings import Settings

SESSION_COOKIE = "ujc_session"
CSRF_COOKIE = "ujc_csrf"
SESSION_DAYS = 30
_SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn: psycopg.Connection, user_id: int) -> str:
    """Creates a session row for `user_id`. Returns the raw (unhashed) cookie value."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=SESSION_DAYS)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (_hash_token(token), user_id, expires_at),
    )
    return token


def lookup_user(conn: psycopg.Connection, token: str) -> tuple[int, str] | None:
    """`(user_id, email)` for a valid, non-expired session, or `None`. Slides `expires_at`
    forward to `now() + 30 days` on every successful lookup (sliding expiry)."""
    token_hash = _hash_token(token)
    row = conn.execute(
        "SELECT s.user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token_hash = %s AND s.expires_at > now()",
        (token_hash,),
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "UPDATE sessions SET expires_at = now() + interval '30 days' WHERE token_hash = %s",
        (token_hash,),
    )
    return row


def revoke_session(conn: psycopg.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = %s", (_hash_token(token),))


def set_auth_cookies(
    response: Response, settings: Settings, *, session_token: str, csrf_token: str
) -> None:
    """Sets `ujc_session` (HttpOnly) and `ujc_csrf` (readable by JS) for the double-submit
    pattern. `Secure` unless `UJC_ENV=development` (plain HTTP in local dev)."""
    secure = settings.ujc_env != "development"
    response.set_cookie(
        SESSION_COOKIE,
        session_token,
        max_age=_SESSION_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=_SESSION_MAX_AGE,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    secure = settings.ujc_env != "development"
    response.delete_cookie(SESSION_COOKIE, path="/", secure=secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=secure, samesite="lax")
