"""`current_user`: the FastAPI dependency every session-authenticated route depends on."""

from dataclasses import dataclass

import psycopg
from fastapi import Depends, HTTPException, Request

from ujc_api.auth.session import SESSION_COOKIE, lookup_user
from ujc_api.db import get_conn


@dataclass(frozen=True, slots=True)
class AuthedUser:
    id: int
    email: str


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
