"""`POST/GET /api/cvs`, `GET/DELETE /api/cvs/{id}` (docs/product/FLOW_V2.md §4)."""

import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from psycopg.types.json import Jsonb

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.cv_upload import CvTooLarge, UnsupportedCvType, validate_cv
from ujc_api.db import get_conn
from ujc_api.dto import CV_COLUMNS, cv_dto

router = APIRouter(prefix="/api/cvs", tags=["cvs"])


@router.post("", status_code=202, dependencies=[Depends(require_csrf)])
async def upload_cv(
    file: UploadFile = File(...),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    content = await file.read()
    try:
        mime = validate_cv(file.filename or "", content)
    except CvTooLarge as exc:
        raise HTTPException(
            status_code=413,
            detail={"code": "payload_too_large", "message": "CV must be 5 MB or smaller"},
        ) from exc
    except UnsupportedCvType as exc:
        raise HTTPException(
            status_code=415,
            detail={"code": "unsupported_media_type", "message": "Unsupported file type"},
        ) from exc

    with conn.transaction():
        row = conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content)"
            " VALUES (%s, %s, %s, %s) RETURNING " + CV_COLUMNS,
            (user.id, file.filename or "cv", mime, content),
        ).fetchone()
        assert row is not None
        cv_id = row[0]
        conn.execute(
            "INSERT INTO tasks (kind, payload) VALUES ('cv_extract', %s)",
            (Jsonb({"cv_id": cv_id}),),
        )
    return cv_dto(row)


@router.get("")
def list_cvs(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    rows = conn.execute(
        f"SELECT {CV_COLUMNS} FROM user_cvs WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()
    return {"items": [cv_dto(r) for r in rows]}


def _owned_cv(conn: psycopg.Connection, user_id: int, cv_id: int) -> tuple:
    row = conn.execute(
        f"SELECT {CV_COLUMNS} FROM user_cvs WHERE id = %s AND user_id = %s", (cv_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="CV not found")
    return row


@router.get("/{cv_id}")
def get_cv(
    cv_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    return cv_dto(_owned_cv(conn, user.id, cv_id))


@router.delete("/{cv_id}", status_code=204, dependencies=[Depends(require_csrf)])
def delete_cv(
    cv_id: int,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> Response:
    _owned_cv(conn, user.id, cv_id)  # 404 if missing or not owned by this user
    conn.execute("DELETE FROM user_cvs WHERE id = %s AND user_id = %s", (cv_id, user.id))
    return Response(status_code=204)
