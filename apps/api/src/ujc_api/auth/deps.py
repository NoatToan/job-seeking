"""`current_user`/`current_runner`: the FastAPI dependencies session- and runner-authenticated
routes depend on.

`require_scope`: like `current_user`, but also accepts `Authorization: Bearer ujc_pat_...`
(personal access tokens, M3-08) declaring the given scope — used by the endpoints `apps/mcp`
calls on the user's behalf (GET /api/feed, /api/jobs/{id}, /api/me, /api/search/live =
jobs:read; GET/POST/PATCH /api/applications = applications:write). Session-authenticated
requests are unaffected: scopes only constrain what a *token* can do, not a signed-in browser
session.
"""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from fastapi import Depends, HTTPException, Request

from ujc_api.auth.runner_token import hash_runner_token
from ujc_api.auth.session import SESSION_COOKIE, lookup_user
from ujc_api.db import get_conn

PAT_PREFIX = "ujc_pat_"


@dataclass(frozen=True, slots=True)
class AuthedUser:
    id: int
    email: str


@dataclass(frozen=True, slots=True)
class AuthedRunner:
    id: int
    user_id: int


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401, detail={"code": "unauthorized", "message": "Sign in required"}
    )


def hash_pat(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def current_user(request: Request, conn: psycopg.Connection = Depends(get_conn)) -> AuthedUser:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise _unauthorized()
    row = lookup_user(conn, token)
    if row is None:
        raise _unauthorized()
    return AuthedUser(id=row[0], email=row[1])


def optional_user(
    request: Request, conn: psycopg.Connection = Depends(get_conn)
) -> AuthedUser | None:
    """Like `current_user`, but never raises: a missing/invalid session cookie just means
    `None` (anonymous). For public routes (e.g. `GET /api/jobs`, `GET /api/jobs/{id}`) that work
    for both signed-in and anonymous visitors."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = lookup_user(conn, token)
    if row is None:
        return None
    return AuthedUser(id=row[0], email=row[1])


def current_runner(request: Request, conn: psycopg.Connection = Depends(get_conn)) -> AuthedRunner:
    """A valid, non-revoked runner bearer token (`Authorization: Bearer ujc_run_...`).

    Never accepts a session cookie: a runner token can only reach `/api/runner/*` routes, and a
    session cookie can never authenticate here, so a runner cannot call any session-auth endpoint
    and vice versa.
    """
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    row = conn.execute(
        "SELECT id, user_id FROM runners WHERE token_hash = %s AND revoked_at IS NULL",
        (hash_runner_token(token),),
    ).fetchone()
    if row is None:
        raise _unauthorized()
    conn.execute("UPDATE runners SET last_seen_at = now() WHERE id = %s", (row[0],))
    return AuthedRunner(id=row[0], user_id=row[1])


def _authenticate_pat(conn: psycopg.Connection, raw_token: str, required_scope: str) -> AuthedUser:
    if not raw_token.startswith(PAT_PREFIX):
        raise _unauthorized()
    row = conn.execute(
        "SELECT pt.id, pt.user_id, pt.scopes, u.email FROM personal_tokens pt"
        " JOIN users u ON u.id = pt.user_id"
        " WHERE pt.token_hash = %s AND pt.revoked_at IS NULL AND pt.expires_at > now()",
        (hash_pat(raw_token),),
    ).fetchone()
    if row is None:
        raise _unauthorized()
    token_id, user_id, scopes, email = row
    if required_scope not in (scopes or []):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "forbidden",
                "message": f"Token is missing the '{required_scope}' scope",
            },
        )
    conn.execute("UPDATE personal_tokens SET last_used_at = now() WHERE id = %s", (token_id,))
    return AuthedUser(id=user_id, email=email)


def require_scope(scope: str) -> Callable[..., AuthedUser]:
    """Dependency factory: `Authorization: Bearer ujc_pat_...` authenticates against `scope`
    (401 if missing/invalid/revoked/expired, 403 if the token lacks `scope`); with no bearer
    header, falls back to the ordinary session cookie (`current_user`, no scope check)."""

    def dependency(request: Request, conn: psycopg.Connection = Depends(get_conn)) -> AuthedUser:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return _authenticate_pat(conn, auth_header[len("Bearer ") :].strip(), scope)
        return current_user(request, conn)

    return dependency


# Module-level singletons (not called inline as `Depends(require_scope("..."))`) so ruff's B008
# ("no function calls in argument defaults") stays clean and every route sharing a scope shares
# one dependency, matching the suggestion in that lint's own message.
require_jobs_read = require_scope("jobs:read")
require_applications_write = require_scope("applications:write")
