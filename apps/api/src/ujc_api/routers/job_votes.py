"""Job votes ("Not worth applying?" / "Still good"), see ujc_api.job_votes and docs/DECISIONS.md
"Job downvotes".

- `PUT /api/jobs/{id}/vote` / `DELETE /api/jobs/{id}/vote`: the signed-in user's own vote
  (session + CSRF). Both answer with the user's vote and the job's fresh `community` aggregate.
- `GET /api/me/job-votes?ids=1,2`: the user's votes for those jobs plus fresh aggregates. Kept
  out of the public job payloads, which must be identical for every viewer (CDN cache).
- `DELETE /api/admin/jobs/{id}/votes`: admin "clear reports" (votes before now stop counting).
"""

from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from ujc_api.auth.admin import viewer_is_admin
from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.job_votes import (
    MIN_ACCOUNT_AGE_HOURS,
    NOTE_MAX_LENGTH,
    RATE_LIMIT_VOTES,
    RATE_LIMIT_WINDOW_SECONDS,
    community_dto,
    refresh_stats,
)

router = APIRouter(tags=["job-votes"])

MAX_IDS = 100
_MAX_BIGINT = 2**63 - 1

Reason = Literal["expired", "not_remote", "scam", "wrong_details", "ghosting", "evergreen", "other"]

# The caller's vote with whether it counts in the public aggregate right now (old enough account,
# not cleared by an admin since). Same columns for the upsert's RETURNING and the batch read.
_MINE_COLUMNS = (
    "v.job_id, v.vote, v.reason, v.note, v.updated_at,"
    " (u.created_at <= now() - make_interval(hours => %(min_age)s)"
    "  AND (s.cleared_at IS NULL OR v.updated_at > s.cleared_at)) AS counted"
)


class VoteRequest(BaseModel):
    vote: Literal["up", "down"]
    reason: Reason | None = None
    note: str | None = Field(default=None, max_length=NOTE_MAX_LENGTH)

    @model_validator(mode="after")
    def _check(self) -> "VoteRequest":
        note = (self.note or "").strip() or None
        if self.vote == "down":
            if self.reason is None:
                raise ValueError("a report needs a reason")
            if self.reason == "other" and note is None:
                raise ValueError("reason 'other' needs a short note")
        elif self.reason is not None or note is not None:
            raise ValueError("'up' takes no reason or note")
        self.note = note
        return self


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found", "message": "Job not found"})


def _mine_dto(row: tuple | None) -> dict | None:
    if row is None:
        return None
    _job_id, vote, reason, note, updated_at, counted = row
    return {
        "vote": "down" if vote == -1 else "up",
        "reason": reason,
        "note": note,
        "updatedAt": updated_at.isoformat(),
        "counted": bool(counted),
    }


def _parse_ids(raw: str) -> list[int]:
    ids: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isascii() or not part.isdigit() or not 0 < int(part) <= _MAX_BIGINT:
            raise HTTPException(
                status_code=400,
                detail={"code": "validation_error", "message": "ids must be positive integers"},
            )
        ids.append(int(part))
    ids = list(dict.fromkeys(ids))
    if not ids or len(ids) > MAX_IDS:
        raise HTTPException(
            status_code=400,
            detail={"code": "validation_error", "message": f"Pass 1 to {MAX_IDS} job ids"},
        )
    return ids


@router.put("/api/jobs/{job_id}/vote", dependencies=[Depends(require_csrf)])
def put_vote(
    job_id: int,
    body: VoteRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """Create or change the caller's vote. 404 if the job doesn't exist, 429 past
    `RATE_LIMIT_VOTES` writes per hour."""
    recent = conn.execute(
        "SELECT count(*) FROM job_votes WHERE user_id = %s"
        " AND updated_at > now() - make_interval(secs => %s)",
        (user.id, RATE_LIMIT_WINDOW_SECONDS),
    ).fetchone()[0]
    if recent >= RATE_LIMIT_VOTES:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Too many votes, try again later"},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    row = conn.execute(
        "WITH v AS ("
        "  INSERT INTO job_votes (job_id, user_id, vote, reason, note)"
        "  SELECT j.id, %(user_id)s, %(vote)s, %(reason)s, %(note)s FROM jobs j"
        "  WHERE j.id = %(job_id)s"
        "  ON CONFLICT (job_id, user_id) DO UPDATE SET vote = EXCLUDED.vote,"
        "   reason = EXCLUDED.reason, note = EXCLUDED.note, updated_at = now()"
        "  RETURNING job_id, user_id, vote, reason, note, updated_at"
        f") SELECT {_MINE_COLUMNS} FROM v"
        " JOIN users u ON u.id = v.user_id"
        " LEFT JOIN job_vote_stats s ON s.job_id = v.job_id",
        {
            "user_id": user.id,
            "job_id": job_id,
            "vote": -1 if body.vote == "down" else 1,
            "reason": body.reason,
            "note": body.note,
            "min_age": MIN_ACCOUNT_AGE_HOURS,
        },
    ).fetchone()
    if row is None:
        raise _not_found()
    return {"vote": _mine_dto(row), "community": refresh_stats(conn, [job_id]).get(job_id)}


@router.delete("/api/jobs/{job_id}/vote", dependencies=[Depends(require_csrf)])
def delete_vote(
    job_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """Remove the caller's vote (idempotent). 404 only if the job doesn't exist."""
    conn.execute("DELETE FROM job_votes WHERE job_id = %s AND user_id = %s", (job_id, user.id))
    stats = refresh_stats(conn, [job_id])
    if job_id not in stats:
        raise _not_found()
    return {"vote": None, "community": stats[job_id]}


@router.get("/api/me/job-votes")
def my_job_votes(
    ids: str = Query(..., description="Comma-separated job ids (at most 100)"),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """The caller's votes for `ids` and those jobs' current aggregates (not cached, so a voter
    sees their own vote counted at once even while the public payload lags behind the CDN)."""
    job_ids = _parse_ids(ids)
    rows = conn.execute(
        "SELECT t.id, mine.*, vs.down_count, vs.up_count, vs.flagged, vs.top_reason,"
        "  vs.reasons, vs.last_down_at"
        " FROM unnest(%(ids)s::bigint[]) AS t (id)"
        " LEFT JOIN job_vote_stats vs ON vs.job_id = t.id"
        f" LEFT JOIN LATERAL (SELECT {_MINE_COLUMNS} FROM job_votes v"
        "   JOIN users u ON u.id = v.user_id"
        "   LEFT JOIN job_vote_stats s ON s.job_id = v.job_id"
        "   WHERE v.job_id = t.id AND v.user_id = %(user_id)s) AS mine ON TRUE",
        {"ids": job_ids, "user_id": user.id, "min_age": MIN_ACCOUNT_AGE_HOURS},
    ).fetchall()
    votes: dict[str, dict] = {}
    community: dict[str, dict | None] = {}
    for row in rows:
        job_id = row[0]
        mine = row[1:7]
        if mine[0] is not None:
            votes[str(job_id)] = _mine_dto(tuple(mine))
        community[str(job_id)] = community_dto(tuple(row[7:]))
    return {"votes": votes, "community": community}


@router.delete("/api/admin/jobs/{job_id}/votes", dependencies=[Depends(require_csrf)])
def clear_job_votes(
    job_id: int,
    is_admin: bool = Depends(viewer_is_admin),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """Admin: "this job is fine". Every vote written before now stops counting (votes are kept,
    so voters still see their choice; a new or changed vote counts again)."""
    if not is_admin:
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Admins only"})
    conn.execute(
        "INSERT INTO job_vote_stats (job_id, cleared_at, cleared_by)"
        " SELECT id, now(), %(user_id)s FROM jobs WHERE id = %(job_id)s"
        " ON CONFLICT (job_id) DO UPDATE SET cleared_at = now(), cleared_by = %(user_id)s",
        {"job_id": job_id, "user_id": user.id},
    )
    stats = refresh_stats(conn, [job_id])
    if job_id not in stats:
        raise _not_found()
    return {"community": stats[job_id]}
