"""`GET /api/me`, `PUT /api/me/preferences` (docs/product/FLOW_V2.md §4)."""

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.dto import CV_COLUMNS, cv_dto
from ujc_api.validation import MAX_KEYWORD_LEN, MAX_KEYWORDS

router = APIRouter(prefix="/api/me", tags=["me"])


def _preferences(conn: psycopg.Connection, user_id: int) -> dict:
    row = conn.execute(
        "SELECT keywords, remote_only, candidate_country FROM user_preferences WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        return {"keywords": [], "remoteOnly": False, "candidateCountry": None}
    keywords, remote_only, candidate_country = row
    return {
        "keywords": list(keywords or []),
        "remoteOnly": bool(remote_only),
        "candidateCountry": candidate_country,
    }


def _latest_cv(conn: psycopg.Connection, user_id: int) -> dict | None:
    row = conn.execute(
        f"SELECT {CV_COLUMNS} FROM user_cvs WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    return cv_dto(row) if row else None


@router.get("")
def get_me(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    return {
        "user": {"id": str(user.id), "email": user.email},
        "preferences": _preferences(conn, user.id),
        "latestCv": _latest_cv(conn, user.id),
    }


class PreferencesRequest(BaseModel):
    keywords: list[str]
    remoteOnly: bool  # noqa: N815 - camelCase matches the wire contract
    candidateCountry: str | None  # noqa: N815 - camelCase matches the wire contract

    @field_validator("keywords")
    @classmethod
    def _keywords(cls, v: list[str]) -> list[str]:
        if len(v) > MAX_KEYWORDS:
            raise ValueError(f"at most {MAX_KEYWORDS} keywords")
        cleaned = [k.strip() for k in v]
        for k in cleaned:
            if not k or len(k) > MAX_KEYWORD_LEN:
                raise ValueError(f"each keyword must be 1-{MAX_KEYWORD_LEN} characters")
        return cleaned


@router.put("/preferences", dependencies=[Depends(require_csrf)])
def put_preferences(
    body: PreferencesRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    conn.execute(
        "INSERT INTO user_preferences"
        " (user_id, keywords, remote_only, candidate_country, updated_at)"
        " VALUES (%s, %s, %s, %s, now())"
        " ON CONFLICT (user_id) DO UPDATE SET"
        "   keywords = EXCLUDED.keywords,"
        "   remote_only = EXCLUDED.remote_only,"
        "   candidate_country = EXCLUDED.candidate_country,"
        "   updated_at = now()",
        (user.id, body.keywords, body.remoteOnly, body.candidateCountry),
    )
    return {"preferences": _preferences(conn, user.id)}
