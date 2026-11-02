"""`POST /api/runners/pairing-code`, `GET /api/runners`, `DELETE /api/runners/{id}` (session;
docs/product/ARCHITECTURE.md D8 "Companion runner pairing", adapted to flow v2: the runner later
fetches the user's keyword preferences via `/api/runner/plan`, see routers/runner.py)."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn

router = APIRouter(prefix="/api/runners", tags=["runners"])

PAIRING_CODE_TTL = timedelta(minutes=10)
# Unambiguous alphabet: no 0/O or 1/I, so a code read aloud or typed by hand isn't misread.
PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PAIRING_CODE_LEN = 8


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def generate_pairing_code() -> str:
    return "".join(secrets.choice(PAIRING_CODE_ALPHABET) for _ in range(PAIRING_CODE_LEN))


@router.post("/pairing-code", dependencies=[Depends(require_csrf)])
def create_pairing_code(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    code = generate_pairing_code()
    expires_at = datetime.now(UTC) + PAIRING_CODE_TTL
    conn.execute(
        "INSERT INTO runner_pairing_codes (code_hash, user_id, expires_at) VALUES (%s, %s, %s)",
        (_hash_code(code), user.id, expires_at),
    )
    return {"code": code, "expiresAt": expires_at.isoformat()}


def _runner_dto(row: tuple) -> dict:
    id_, name, created_at, last_seen_at, revoked_at = row
    return {
        "id": str(id_),
        "name": name,
        "createdAt": created_at.isoformat(),
        "lastSeenAt": last_seen_at.isoformat() if last_seen_at else None,
        "revokedAt": revoked_at.isoformat() if revoked_at else None,
    }


@router.get("")
def list_runners(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    rows = conn.execute(
        "SELECT id, name, created_at, last_seen_at, revoked_at FROM runners"
        " WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()
    return {"items": [_runner_dto(r) for r in rows]}


@router.delete("/{runner_id}", status_code=204, dependencies=[Depends(require_csrf)])
def revoke_runner(
    runner_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> Response:
    row = conn.execute(
        "SELECT id FROM runners WHERE id = %s AND user_id = %s", (runner_id, user.id)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": "Runner not found"}
        )
    conn.execute(
        "UPDATE runners SET revoked_at = now() WHERE id = %s AND revoked_at IS NULL", (runner_id,)
    )
    return Response(status_code=204)
