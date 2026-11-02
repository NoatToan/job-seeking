"""`GET/POST /api/applications`, `PATCH/DELETE /api/applications/{id}`,
`GET /api/applications/{id}/events` (docs/product/ARCHITECTURE.md applications section, adapted to
the current schema — see db/migrations/008_applications.sql)."""

from datetime import datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.dto import (
    APPLICATION_COLUMNS,
    APPLICATION_EVENT_COLUMNS,
    JOB_COLUMNS,
    application_dto,
    application_event_dto,
    job_dto,
)
from ujc_api.validation import MAX_APPLICATION_NOTE_LEN

router = APIRouter(prefix="/api/applications", tags=["applications"])

ApplicationStatus = Literal["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]
_STATUSES: frozenset[str] = frozenset(
    {"saved", "applied", "interviewing", "offer", "rejected", "withdrawn"}
)


def _validate_note(v: str | None) -> str | None:
    if v is not None and len(v) > MAX_APPLICATION_NOTE_LEN:
        raise ValueError(f"note must be at most {MAX_APPLICATION_NOTE_LEN} characters")
    return v


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404, detail={"code": "not_found", "message": "Application not found"}
    )


def _owned_application(conn: psycopg.Connection, user_id: int, application_id: int) -> tuple:
    row = conn.execute(
        f"SELECT {APPLICATION_COLUMNS} FROM applications WHERE id = %s AND user_id = %s",
        (application_id, user_id),
    ).fetchone()
    if row is None:
        raise _not_found()
    return row


@router.get("")
def list_applications(
    status: str | None = Query(default=None),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    if status is not None and status not in _STATUSES:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": "Invalid status"}
        )
    clauses = ["user_id = %s"]
    params: list = [user.id]
    if status:
        clauses.append("status = %s")
        params.append(status)
    where = " AND ".join(clauses)
    rows = conn.execute(
        f"SELECT {APPLICATION_COLUMNS} FROM applications WHERE {where}"
        " ORDER BY updated_at DESC, id DESC",
        params,
    ).fetchall()
    return {"items": [application_dto(r) for r in rows]}


class CreateApplicationRequest(BaseModel):
    jobId: str  # noqa: N815 - camelCase matches the wire contract
    status: ApplicationStatus = "saved"
    note: str | None = None

    @field_validator("note")
    @classmethod
    def _note_len(cls, v: str | None) -> str | None:
        return _validate_note(v)


@router.post("", dependencies=[Depends(require_csrf)])
def create_application(
    body: CreateApplicationRequest,
    response: Response,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    try:
        job_id = int(body.jobId)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": "Invalid jobId"}
        ) from exc

    job_row = conn.execute(f"SELECT {JOB_COLUMNS} FROM jobs WHERE id = %s", (job_id,)).fetchone()
    if job_row is None:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": "Job not found"}
        )
    job = job_dto(job_row)

    existing = conn.execute(
        f"SELECT {APPLICATION_COLUMNS} FROM applications WHERE user_id = %s AND job_id = %s",
        (user.id, job_id),
    ).fetchone()
    if existing is not None:
        response.status_code = 200
        return application_dto(existing)

    snapshot = {
        "title": job["title"],
        "company": job["company"],
        "url": job["url"],
        "source": job["source"],
    }
    with conn.transaction():
        row = conn.execute(
            "INSERT INTO applications (user_id, job_id, job_snapshot, status, note)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING " + APPLICATION_COLUMNS,
            (user.id, job_id, Jsonb(snapshot), body.status, body.note),
        ).fetchone()
        assert row is not None
        conn.execute(
            "INSERT INTO application_events (application_id, from_status, to_status, note)"
            " VALUES (%s, NULL, %s, %s)",
            (row[0], body.status, body.note),
        )
    response.status_code = 201
    return application_dto(row)


class PatchApplicationRequest(BaseModel):
    status: ApplicationStatus | None = None
    note: str | None = None
    nextActionAt: datetime | None = None  # noqa: N815 - camelCase matches the wire contract

    @field_validator("note")
    @classmethod
    def _note_len(cls, v: str | None) -> str | None:
        return _validate_note(v)


@router.patch("/{application_id}", dependencies=[Depends(require_csrf)])
def patch_application(
    application_id: int,
    body: PatchApplicationRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    current = _owned_application(conn, user.id, application_id)
    current_status = current[3]

    fields_set = body.model_fields_set
    set_clauses: list[str] = []
    params: list = []

    if "status" in fields_set and body.status is not None:
        set_clauses.append("status = %s")
        params.append(body.status)
    if "note" in fields_set:
        set_clauses.append("note = %s")
        params.append(body.note)
    if "nextActionAt" in fields_set:
        set_clauses.append("next_action_at = %s")
        params.append(body.nextActionAt)

    if not set_clauses:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": "No fields to update"}
        )

    set_clauses.append("updated_at = now()")
    params.extend([application_id, user.id])

    with conn.transaction():
        row = conn.execute(
            f"UPDATE applications SET {', '.join(set_clauses)} WHERE id = %s AND user_id = %s"
            " RETURNING " + APPLICATION_COLUMNS,
            params,
        ).fetchone()
        assert row is not None
        if "status" in fields_set and body.status is not None and body.status != current_status:
            conn.execute(
                "INSERT INTO application_events (application_id, from_status, to_status, note)"
                " VALUES (%s, %s, %s, %s)",
                (application_id, current_status, body.status, body.note),
            )
    return application_dto(row)


@router.delete("/{application_id}", status_code=204, dependencies=[Depends(require_csrf)])
def delete_application(
    application_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> Response:
    _owned_application(conn, user.id, application_id)  # 404 if missing or not owned
    conn.execute(
        "DELETE FROM applications WHERE id = %s AND user_id = %s", (application_id, user.id)
    )
    return Response(status_code=204)


@router.get("/{application_id}/events")
def list_application_events(
    application_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    _owned_application(conn, user.id, application_id)  # 404 if missing or not owned
    rows = conn.execute(
        f"SELECT {APPLICATION_EVENT_COLUMNS} FROM application_events"
        " WHERE application_id = %s ORDER BY created_at DESC, id DESC",
        (application_id,),
    ).fetchall()
    return {"items": [application_event_dto(r) for r in rows]}
