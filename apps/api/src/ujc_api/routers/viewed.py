"""`GET/POST/DELETE /api/me/viewed`: the jobs the user has already opened, so the feed can mark
them as read on every device (see db/migrations/020_job_views.sql)."""

import psycopg
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, StrictInt, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn

router = APIRouter(prefix="/api/me/viewed", tags=["viewed"])

MAX_VIEWED_RETURNED = 5000
MAX_VIEWED_PER_POST = 500
_MAX_BIGINT = 2**63 - 1


@router.get("")
def list_viewed(
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    rows = conn.execute(
        "SELECT job_id FROM job_views WHERE user_id = %s"
        " ORDER BY viewed_at DESC, job_id DESC LIMIT %s",
        (user.id, MAX_VIEWED_RETURNED),
    ).fetchall()
    return {"jobIds": [str(r[0]) for r in rows]}


class MarkViewedRequest(BaseModel):
    jobIds: list[StrictInt | str] = Field(  # noqa: N815 - camelCase matches the wire contract
        min_length=1, max_length=MAX_VIEWED_PER_POST
    )

    @field_validator("jobIds")
    @classmethod
    def _job_ids(cls, v: list[StrictInt | str]) -> list[StrictInt | str]:
        ids: list[int] = []
        for raw in v:
            if isinstance(raw, str):
                if not raw.isascii() or not raw.isdigit():
                    raise ValueError("each job id must be a positive integer")
                raw = int(raw)
            if not 0 < raw <= _MAX_BIGINT:
                raise ValueError("each job id must be a positive integer")
            ids.append(raw)
        return list(dict.fromkeys(ids))


@router.post("", dependencies=[Depends(require_csrf)])
def mark_viewed(
    body: MarkViewedRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """Upserts the given jobs as viewed now; ids that aren't (or are no longer) in `jobs` are
    skipped. `saved` counts the rows inserted or bumped."""
    cur = conn.execute(
        "INSERT INTO job_views (user_id, job_id, viewed_at)"
        " SELECT %s, j.id, now() FROM unnest(%s::bigint[]) AS ids (id)"
        " JOIN jobs j ON j.id = ids.id"
        " ON CONFLICT (user_id, job_id) DO UPDATE"
        " SET viewed_at = greatest(job_views.viewed_at, EXCLUDED.viewed_at)",
        (user.id, body.jobIds),
    )
    return {"saved": cur.rowcount}


@router.delete("", status_code=204, dependencies=[Depends(require_csrf)])
def clear_viewed(
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> Response:
    conn.execute("DELETE FROM job_views WHERE user_id = %s", (user.id,))
    return Response(status_code=204)
