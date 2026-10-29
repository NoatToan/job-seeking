"""`POST /api/auth/otp`, `/verify`, `/logout` (docs/product/FLOW_V2.md §4)."""

import re

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from ujc_api.auth import otp
from ujc_api.auth.csrf import generate_csrf_token, require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.auth.session import (
    SESSION_COOKIE,
    clear_auth_cookies,
    create_session,
    revoke_session,
    set_auth_cookies,
)
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.mail import MailNotConfigured, NotInvited, deliver_otp
from ujc_api.net import client_ip
from ujc_api.settings import Settings
from ujc_api.validation import normalize_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

_CODE_RE = re.compile(r"\d{6}")


class OtpRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        try:
            return normalize_email(v)
        except ValueError as exc:
            raise ValueError("invalid email") from exc


class VerifyRequest(BaseModel):
    email: str
    code: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        try:
            return normalize_email(v)
        except ValueError as exc:
            raise ValueError("invalid email") from exc

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip()
        if not _CODE_RE.fullmatch(v):
            raise ValueError("code must be 6 digits")
        return v


def _rate_limited(exc: otp.RateLimited) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={"code": "rate_limited", "message": "Too many codes requested, try again later"},
        headers={"Retry-After": str(exc.retry_after)},
    )


@router.post("/otp", status_code=202)
def send_otp(
    body: OtpRequest,
    request: Request,
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> dict:
    ip = client_ip(request)
    try:
        otp.check_ip_rate_limit(ip)
        otp.check_email_rate_limit(conn, body.email)
    except otp.RateLimited as exc:
        raise _rate_limited(exc) from exc

    code, expires_in = otp.create(conn, settings, body.email)
    try:
        dev_code = deliver_otp(settings, body.email, code)
    except NotInvited as exc:
        raise HTTPException(
            status_code=403,
            detail={"code": "not_invited", "message": "This review build is invite-only."},
        ) from exc
    except MailNotConfigured as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "mail_not_configured",
                "message": "Email delivery is not configured",
            },
        ) from exc

    result: dict[str, object] = {"sent": True, "expiresInSec": expires_in}
    if dev_code is not None:
        result["devCode"] = dev_code
    return result


@router.post("/verify")
def verify(
    body: VerifyRequest,
    response: Response,
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> dict:
    try:
        otp.verify(conn, settings, body.email, body.code)
    except otp.TooManyAttempts as exc:
        raise HTTPException(
            status_code=429,
            detail={"code": "too_many_attempts", "message": "Too many incorrect attempts"},
        ) from exc
    except otp.CodeExpired as exc:
        raise HTTPException(
            status_code=410, detail={"code": "code_expired", "message": "Code expired"}
        ) from exc
    except otp.InvalidCode as exc:
        raise HTTPException(
            status_code=400, detail={"code": "invalid_code", "message": "Incorrect code"}
        ) from exc

    with conn.transaction():
        row = conn.execute(
            "INSERT INTO users (email, last_login_at) VALUES (%s, now())"
            " ON CONFLICT (email) DO UPDATE SET last_login_at = now()"
            " RETURNING id, email",
            (body.email,),
        ).fetchone()
        assert row is not None
        user_id, email = row
        session_token = create_session(conn, user_id)

    csrf_token = generate_csrf_token()
    set_auth_cookies(response, settings, session_token=session_token, csrf_token=csrf_token)
    return {"user": {"id": str(user_id), "email": email}}


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(
    request: Request,
    response: Response,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> Response:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        revoke_session(conn, token)
    clear_auth_cookies(response, settings)
    response.status_code = 204
    return response
