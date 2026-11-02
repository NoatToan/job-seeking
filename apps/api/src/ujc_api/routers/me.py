"""`GET /api/me`, `PUT /api/me/preferences`, `POST /api/me/consent`, `GET /api/me/export`,
`DELETE /api/me` (docs/product/FLOW_V2.md §4, M5-04 privacy & data rights)."""

import json
from datetime import datetime

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.auth.session import clear_auth_cookies
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.dto import CV_COLUMNS, cv_dto
from ujc_api.settings import Settings
from ujc_api.validation import MAX_KEYWORD_LEN, MAX_KEYWORDS

router = APIRouter(prefix="/api/me", tags=["me"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


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


def _ai_consent_at(conn: psycopg.Connection, user_id: int) -> datetime | None:
    row = conn.execute("SELECT ai_consent_at FROM users WHERE id = %s", (user_id,)).fetchone()
    return row[0] if row else None


def _onboarded_at(conn: psycopg.Connection, user_id: int) -> datetime | None:
    row = conn.execute("SELECT onboarded_at FROM users WHERE id = %s", (user_id,)).fetchone()
    return row[0] if row else None


@router.get("")
def get_me(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "aiConsentAt": _iso(_ai_consent_at(conn, user.id)),
            "onboardedAt": _iso(_onboarded_at(conn, user.id)),
        },
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


class ConsentRequest(BaseModel):
    aiProcessing: bool  # noqa: N815 - camelCase matches the wire contract

    @field_validator("aiProcessing")
    @classmethod
    def _must_be_true(cls, v: bool) -> bool:
        if not v:
            raise ValueError("aiProcessing must be true")
        return v


@router.post("/consent", dependencies=[Depends(require_csrf)])
def post_consent(
    body: ConsentRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """Records consent to send CV text to the LLM provider (Claude), gating `POST /api/cvs`."""
    conn.execute("UPDATE users SET ai_consent_at = now() WHERE id = %s", (user.id,))
    return {"aiConsentAt": _iso(_ai_consent_at(conn, user.id))}


@router.post("/onboarded", dependencies=[Depends(require_csrf)])
def post_onboarded(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    """Marks the onboarding wizard (`/onboarding/`, M4-07) as finished, so a later login goes
    straight to the feed instead of back through onboarding."""
    conn.execute("UPDATE users SET onboarded_at = now() WHERE id = %s", (user.id,))
    return {"onboardedAt": _iso(_onboarded_at(conn, user.id))}


def _export_application(row: tuple) -> dict:
    a_id, job_id, job_snapshot, status, note, next_action_at, created_at, updated_at = row
    return {
        "id": str(a_id),
        "jobId": str(job_id) if job_id is not None else None,
        "job": job_snapshot,
        "status": status,
        "note": note,
        "nextActionAt": _iso(next_action_at),
        "createdAt": _iso(created_at),
        "updatedAt": _iso(updated_at),
    }


@router.get("/export")
def get_export(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> Response:
    """A JSON download of everything the user owns: their account row, preferences, CV metadata
    (extracted profile/keywords, never the file bytes) and tracked applications."""
    user_row = conn.execute(
        "SELECT id, email, created_at, last_login_at, ai_consent_at FROM users WHERE id = %s",
        (user.id,),
    ).fetchone()
    if user_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    uid, email, created_at, last_login_at, ai_consent_at = user_row

    cv_rows = conn.execute(
        "SELECT id, filename, status, error, keywords, profile, created_at, processed_at"
        " FROM user_cvs WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()

    application_rows = conn.execute(
        "SELECT id, job_id, job_snapshot, status, note, next_action_at, created_at, updated_at"
        " FROM applications WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()

    export = {
        "user": {
            "id": str(uid),
            "email": email,
            "createdAt": _iso(created_at),
            "lastLoginAt": _iso(last_login_at),
            "aiConsentAt": _iso(ai_consent_at),
        },
        "preferences": _preferences(conn, user.id),
        "cvs": [cv_dto(r) for r in cv_rows],
        "applications": [_export_application(r) for r in application_rows],
    }
    body = json.dumps(export, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="my-data.json"'},
    )


class DeleteAccountRequest(BaseModel):
    confirm: str

    @field_validator("confirm")
    @classmethod
    def _confirm(cls, v: str) -> str:
        if v != "DELETE":
            raise ValueError('confirm must be the literal string "DELETE"')
        return v


@router.delete("", dependencies=[Depends(require_csrf)])
def delete_me(
    body: DeleteAccountRequest,
    response: Response,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> Response:
    """Hard-deletes the user; `ON DELETE CASCADE` on `sessions`, `user_cvs`, `user_preferences`
    and `applications` removes everything else they own."""
    conn.execute("DELETE FROM users WHERE id = %s", (user.id,))
    clear_auth_cookies(response, settings)
    response.status_code = 204
    return response
