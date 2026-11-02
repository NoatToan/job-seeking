"""`GET/POST/DELETE /api/tokens` — personal access tokens (M3-08), so a user's own Claude
(apps/mcp) can call the API on their behalf. The raw `ujc_pat_<random>` value is shown exactly
once, in the `POST` response; only its sha256 is ever stored (`ujc_api.auth.deps.hash_pat`)."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import PAT_PREFIX, AuthedUser, current_user, hash_pat
from ujc_api.db import get_conn

router = APIRouter(prefix="/api/tokens", tags=["tokens"])

# Kept intentionally small: every scope here must be enforced by a `require_scope(...)` call
# somewhere in apps/api (see routers/feed.py, jobs.py, me.py, search.py, applications.py).
ALLOWED_SCOPES: frozenset[str] = frozenset({"jobs:read", "applications:write"})
MAX_EXPIRES_IN_DAYS = 365
MAX_NAME_LEN = 100

TOKEN_COLUMNS = "id, name, scopes, created_at, expires_at, last_used_at, revoked_at"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _token_dto(row: tuple) -> dict[str, Any]:
    id_, name, scopes, created_at, expires_at, last_used_at, revoked_at = row
    return {
        "id": str(id_),
        "name": name,
        "scopes": list(scopes or []),
        "createdAt": _iso(created_at),
        "expiresAt": _iso(expires_at),
        "lastUsedAt": _iso(last_used_at),
        "revokedAt": _iso(revoked_at),
    }


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404, detail={"code": "not_found", "message": "Token not found"}
    )


@router.get("")
def list_tokens(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    rows = conn.execute(
        f"SELECT {TOKEN_COLUMNS} FROM personal_tokens WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()
    return {"items": [_token_dto(r) for r in rows]}


class CreateTokenRequest(BaseModel):
    name: str
    scopes: list[str]
    expiresInDays: int = MAX_EXPIRES_IN_DAYS  # noqa: N815 - camelCase matches the wire contract

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > MAX_NAME_LEN:
            raise ValueError(f"name must be 1-{MAX_NAME_LEN} characters")
        return v

    @field_validator("scopes")
    @classmethod
    def _scopes(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("at least one scope is required")
        invalid = sorted(set(v) - ALLOWED_SCOPES)
        if invalid:
            raise ValueError(f"unknown scope(s): {', '.join(invalid)}")
        return sorted(set(v))

    @field_validator("expiresInDays")
    @classmethod
    def _expires_in_days(cls, v: int) -> int:
        if not (1 <= v <= MAX_EXPIRES_IN_DAYS):
            raise ValueError(f"expiresInDays must be between 1 and {MAX_EXPIRES_IN_DAYS}")
        return v


@router.post("", status_code=201, dependencies=[Depends(require_csrf)])
def create_token(
    body: CreateTokenRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    raw_token = PAT_PREFIX + secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=body.expiresInDays)
    row = conn.execute(
        "INSERT INTO personal_tokens (user_id, name, token_hash, scopes, expires_at)"
        " VALUES (%s, %s, %s, %s, %s) RETURNING " + TOKEN_COLUMNS,
        (user.id, body.name, hash_pat(raw_token), body.scopes, expires_at),
    ).fetchone()
    assert row is not None
    dto = _token_dto(row)
    # Shown exactly once: never stored (only its hash is), never returned by GET /api/tokens.
    dto["token"] = raw_token
    return dto


@router.delete("/{token_id}", status_code=204, dependencies=[Depends(require_csrf)])
def revoke_token(
    token_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> Response:
    owned = conn.execute(
        "SELECT id FROM personal_tokens WHERE id = %s AND user_id = %s AND revoked_at IS NULL",
        (token_id, user.id),
    ).fetchone()
    if owned is None:
        raise _not_found()
    conn.execute(
        "UPDATE personal_tokens SET revoked_at = now() WHERE id = %s",
        (token_id,),
    )
    return Response(status_code=204)
