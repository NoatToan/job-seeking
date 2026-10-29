"""CSRF double-submit cookie: `ujc_csrf` (readable) must equal the `X-CSRF-Token` header on
unsafe methods for session-authenticated routes (everywhere except `/api/auth/otp` and
`/api/auth/verify`, which are unauthenticated and set the cookie for the first time)."""

import hmac
import secrets

from fastapi import HTTPException, Request

from ujc_api.auth.session import CSRF_COOKIE

CSRF_HEADER = "X-CSRF-Token"


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def require_csrf(request: Request) -> None:
    """FastAPI dependency: 403 `csrf_failed` unless the header matches the cookie exactly."""
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(
            status_code=403,
            detail={"code": "csrf_failed", "message": "Missing or invalid X-CSRF-Token"},
        )
