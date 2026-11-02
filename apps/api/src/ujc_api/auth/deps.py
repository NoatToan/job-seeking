"""`current_user`/`current_runner`: the FastAPI dependencies session- and runner-authenticated
routes depend on."""

from dataclasses import dataclass

import psycopg
from fastapi import Depends, HTTPException, Request

from ujc_api.auth.runner_token import hash_runner_token
from ujc_api.auth.session import SESSION_COOKIE, lookup_user
from ujc_api.db import get_conn


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


def current_user(request: Request, conn: psycopg.Connection = Depends(get_conn)) -> AuthedUser:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise _unauthorized()
    row = lookup_user(conn, token)
    if row is None:
        raise _unauthorized()
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
