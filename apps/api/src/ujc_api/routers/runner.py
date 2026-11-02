"""`POST /api/runner/pair`, `GET /api/runner/plan`, `POST /api/runner/jobs`
(docs/product/ARCHITECTURE.md D8, adapted to flow v2: the plan is the user's keyword
preferences — `user_preferences` — rather than a per-profile search config)."""

import hashlib
from datetime import UTC, datetime

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from job_crawler import db as crawler_db
from pydantic import BaseModel

from ujc_api.auth.deps import AuthedRunner, current_runner
from ujc_api.auth.runner_token import generate_runner_token, hash_runner_token
from ujc_api.db import get_conn
from ujc_api.runner_validation import (
    RUNNER_SITES,
    InvalidJob,
    TooManyJobs,
    UnknownSite,
    validate_runner_jobs,
)

router = APIRouter(prefix="/api/runner", tags=["runner"])

MAX_PAYLOAD_BYTES = 2 * 1024 * 1024


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


class PairRequest(BaseModel):
    code: str
    name: str = "Companion runner"


@router.post("/pair")
def pair(body: PairRequest, conn: psycopg.Connection = Depends(get_conn)) -> dict:
    code = body.code.strip().upper()
    row = conn.execute(
        "SELECT user_id, expires_at, used_at FROM runner_pairing_codes WHERE code_hash = %s",
        (_hash_code(code),),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=400, detail={"code": "invalid_code", "message": "Invalid pairing code"}
        )
    user_id, expires_at, used_at = row
    if used_at is not None:
        raise HTTPException(
            status_code=400, detail={"code": "invalid_code", "message": "Code already used"}
        )
    if expires_at < datetime.now(UTC):
        raise HTTPException(
            status_code=410, detail={"code": "code_expired", "message": "Pairing code expired"}
        )

    token = generate_runner_token()
    name = body.name.strip() or "Companion runner"
    with conn.transaction():
        conn.execute(
            "UPDATE runner_pairing_codes SET used_at = now() WHERE code_hash = %s",
            (_hash_code(code),),
        )
        runner_row = conn.execute(
            "INSERT INTO runners (user_id, name, token_hash) VALUES (%s, %s, %s) RETURNING id",
            (user_id, name, hash_runner_token(token)),
        ).fetchone()
    assert runner_row is not None
    return {"runnerId": str(runner_row[0]), "token": token}


@router.get("/plan")
def plan(
    runner: AuthedRunner = Depends(current_runner), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    row = conn.execute(
        "SELECT keywords, remote_only FROM user_preferences WHERE user_id = %s", (runner.user_id,)
    ).fetchone()
    keywords, remote_only = (list(row[0] or []), bool(row[1])) if row else ([], False)
    return {"keywords": keywords, "remoteOnly": remote_only, "sites": sorted(RUNNER_SITES)}


class JobsUploadRequest(BaseModel):
    site: str
    jobs: list[dict]


def _check_payload_size(request: Request) -> None:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_PAYLOAD_BYTES:
        raise HTTPException(
            status_code=413, detail={"code": "payload_too_large", "message": "Payload too large"}
        )


@router.post("/jobs", dependencies=[Depends(_check_payload_size)])
def upload_jobs(
    body: JobsUploadRequest,
    runner: AuthedRunner = Depends(current_runner),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    try:
        records = validate_runner_jobs(body.site, body.jobs)
    except UnknownSite as exc:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": f"Unknown site {exc}"}
        ) from exc
    except TooManyJobs as exc:
        raise HTTPException(
            status_code=413,
            detail={"code": "payload_too_large", "message": f"At most 200 jobs per call ({exc})"},
        ) from exc
    except InvalidJob as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unprocessable",
                "message": str(exc),
                "fields": {str(exc.index): exc.reason},
            },
        ) from exc

    upserted = crawler_db.upsert_jobs(conn, records) if records else 0
    return {"received": len(body.jobs), "upserted": upserted}
