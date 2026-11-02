"""`POST /api/matches/refresh` (M4-03): enqueues a `match_score` task (see `ujc_api.worker`) for
the current user, rate-limited to `MAX_REFRESHES_PER_DAY` per user per UTC calendar day."""

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn

router = APIRouter(prefix="/api/matches", tags=["matches"])

MAX_REFRESHES_PER_DAY = 3


@router.post("/refresh", status_code=202, dependencies=[Depends(require_csrf)])
def refresh_matches(
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    (count,) = conn.execute(
        "SELECT count(*) FROM match_refreshes"
        " WHERE user_id = %s AND created_at >= date_trunc('day', now())",
        (user.id,),
    ).fetchone()
    if count >= MAX_REFRESHES_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "quota_exceeded",
                "message": f"Max {MAX_REFRESHES_PER_DAY} match refreshes per day. "
                "Try again tomorrow.",
            },
        )

    with conn.transaction():
        conn.execute("INSERT INTO match_refreshes (user_id) VALUES (%s)", (user.id,))
        row = conn.execute(
            "INSERT INTO tasks (kind, payload) VALUES ('match_score', %s) RETURNING id",
            (Jsonb({"user_id": user.id}),),
        ).fetchone()
    assert row is not None
    return {"taskId": str(row[0])}
