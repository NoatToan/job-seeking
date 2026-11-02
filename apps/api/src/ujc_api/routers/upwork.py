"""Upwork OAuth connect + user-directed live search (M3-04), behind `UPWORK_ENABLED`.

Every route here 404s `not_enabled` unless `Settings.upwork_available()` (flag on *and* client
id/secret set) — see docs/product/ARCHITECTURE.md §7. Results are cached <=24h in
`upwork_search_cache`, are never written to `jobs`, and are never sent to an LLM.

Uses `job_crawler.sources.upwork` (M3-03) for the GraphQL client and PKCE/OAuth helpers, rather
than a second implementation here.
"""

import base64
import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from job_crawler.sources import upwork
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from ujc_api import audit
from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.auth.ratelimit import SlidingWindowRateLimiter
from ujc_api.crypto import decrypt_json, encrypt_json
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.settings import Settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upwork"])

OAUTH_COOKIE = "ujc_upwork_oauth"
_OAUTH_STATE_TTL_MIN = 10
_REFRESH_MARGIN = timedelta(minutes=5)
_HTTP_TIMEOUT_S = 10.0

# 30/hour/user (docs/product/ARCHITECTURE.md §7 / the M3-04 issue body). Module-level singleton,
# like `auth.ratelimit`'s OTP limiter — fine for the single-instance MVP.
_search_rate_limiter = SlidingWindowRateLimiter(max_count=30, window_seconds=3600)


def _not_enabled() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "not_enabled", "message": "Upwork integration is not enabled"},
    )


def _require_enabled(settings: Settings) -> None:
    if not settings.upwork_available():
        raise _not_enabled()


def _state_mismatch() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={"code": "state_mismatch", "message": "Missing, invalid or expired OAuth state"},
    )


def _secure_cookie(settings: Settings) -> bool:
    return settings.ujc_env != "development"


@router.get("/connections/upwork/authorize")
def authorize_upwork(
    user: AuthedUser = Depends(current_user),
    settings: Settings = Depends(app_settings),
) -> RedirectResponse:
    _require_enabled(settings)
    verifier = upwork.make_verifier()
    code_challenge = upwork.challenge(verifier)
    state = secrets.token_urlsafe(24)
    expires_at = datetime.now(UTC) + timedelta(minutes=_OAUTH_STATE_TTL_MIN)
    blob = encrypt_json(
        settings.ujc_secret_key,
        {"state": state, "verifier": verifier, "userId": user.id, "exp": expires_at.isoformat()},
    )
    cookie_value = base64.urlsafe_b64encode(blob).decode("ascii")

    url = upwork.authorization_url(
        settings.upwork_client_id or "",
        settings.upwork_redirect_uri or "",
        state,
        code_challenge,
    )
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        OAUTH_COOKIE,
        cookie_value,
        max_age=_OAUTH_STATE_TTL_MIN * 60,
        httponly=True,
        secure=_secure_cookie(settings),
        samesite="lax",
        path="/",
    )
    return response


@router.get("/connections/upwork/callback")
def upwork_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> RedirectResponse:
    _require_enabled(settings)

    if error:
        response = RedirectResponse("/connections/?upwork=denied", status_code=302)
        response.delete_cookie(OAUTH_COOKIE, path="/")
        return response

    cookie_value = request.cookies.get(OAUTH_COOKIE)
    if not cookie_value or not state or not code:
        raise _state_mismatch()
    try:
        blob = base64.urlsafe_b64decode(cookie_value.encode("ascii"))
        payload = decrypt_json(settings.ujc_secret_key, blob)
        expires_at = datetime.fromisoformat(payload["exp"])
    except Exception as exc:
        raise _state_mismatch() from exc

    if (
        not secrets.compare_digest(payload.get("state", ""), state)
        or payload.get("userId") != user.id
        or datetime.now(UTC) > expires_at
    ):
        raise _state_mismatch()

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S) as http:
            tokens = upwork.exchange_code(
                http,
                client_id=settings.upwork_client_id or "",
                client_secret=settings.upwork_client_secret or "",
                redirect_uri=settings.upwork_redirect_uri or "",
                code=code,
                code_verifier=payload["verifier"],
            )
    except upwork.UpworkError:
        log.warning("upwork token exchange failed for user %s", user.id)
        response = RedirectResponse("/connections/?upwork=error", status_code=302)
        response.delete_cookie(OAUTH_COOKIE, path="/")
        return response

    token_expires_at = datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 86400)))
    encrypted = encrypt_json(
        settings.ujc_secret_key,
        {
            "accessToken": tokens["access_token"],
            "refreshToken": tokens.get("refresh_token"),
            "expiresAt": token_expires_at.isoformat(),
        },
    )
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO platform_connections (user_id, platform, status, credentials_encrypted)
            VALUES (%s, 'upwork', 'connected', %s)
            ON CONFLICT (user_id, platform) DO UPDATE
                SET status = 'connected',
                    credentials_encrypted = EXCLUDED.credentials_encrypted,
                    updated_at = now()
            """,
            (user.id, encrypted),
        )
    audit.record(conn, user.id, "connection_added", {"platform": "upwork"})

    response = RedirectResponse("/connections/?upwork=connected", status_code=302)
    response.delete_cookie(OAUTH_COOKIE, path="/")
    return response


def _mark_connection_error(conn: psycopg.Connection, user_id: int) -> None:
    with conn.transaction():
        conn.execute(
            "UPDATE platform_connections SET status = 'error', updated_at = now()"
            " WHERE user_id = %s AND platform = 'upwork'",
            (user_id,),
        )


def _with_cache_meta(result: dict, fetched_at: datetime, expires_at: datetime) -> dict:
    return {
        **result,
        "fetchedAt": fetched_at.isoformat(),
        "expiresAt": expires_at.isoformat(),
        "attribution": "Upwork",
    }


def _not_connected() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "not_connected", "message": "Connect Upwork before searching"},
    )


class UpworkSearchRequest(BaseModel):
    q: str
    profileId: str | None = None  # noqa: N815 - camelCase matches the wire contract
    cursor: str | None = None


def _refresh_credentials(
    conn: psycopg.Connection, settings: Settings, user: AuthedUser, credentials: dict
) -> dict:
    """Refreshes and persists a new access token, or marks the connection `error` and raises
    `_not_connected()` if that isn't possible."""
    refresh_token = credentials.get("refreshToken")
    if not refresh_token:
        _mark_connection_error(conn, user.id)
        raise _not_connected()
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S) as http:
            tokens = upwork.refresh(
                http,
                client_id=settings.upwork_client_id or "",
                client_secret=settings.upwork_client_secret or "",
                refresh_token=refresh_token,
            )
    except upwork.UpworkError:
        _mark_connection_error(conn, user.id)
        raise _not_connected() from None
    new_expires = datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 86400)))
    new_credentials = {
        "accessToken": tokens["access_token"],
        "refreshToken": tokens.get("refresh_token", refresh_token),
        "expiresAt": new_expires.isoformat(),
    }
    conn.execute(
        "UPDATE platform_connections SET credentials_encrypted = %s, updated_at = now()"
        " WHERE user_id = %s AND platform = 'upwork'",
        (encrypt_json(settings.ujc_secret_key, new_credentials), user.id),
    )
    return new_credentials


@router.post("/upwork/search", dependencies=[Depends(require_csrf)])
def search_upwork(
    body: UpworkSearchRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> dict:
    _require_enabled(settings)

    q = body.q.strip()
    if not q:
        raise HTTPException(
            status_code=400, detail={"code": "bad_request", "message": "q is required"}
        )

    row = conn.execute(
        "SELECT credentials_encrypted FROM platform_connections"
        " WHERE user_id = %s AND platform = 'upwork' AND status = 'connected'",
        (user.id,),
    ).fetchone()
    if row is None:
        raise _not_connected()

    if not _search_rate_limiter.allow(str(user.id)):
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Too many Upwork searches this hour"},
            headers={"Retry-After": "3600"},
        )

    query_hash = hashlib.sha256(f"{user.id}:{q.lower()}:{body.cursor or ''}".encode()).hexdigest()
    cached = conn.execute(
        "SELECT results, fetched_at, expires_at FROM upwork_search_cache"
        " WHERE user_id = %s AND query_hash = %s AND expires_at > now()",
        (user.id, query_hash),
    ).fetchone()
    if cached is not None:
        results, fetched_at, expires_at = cached
        return _with_cache_meta(results, fetched_at, expires_at)

    credentials = decrypt_json(settings.ujc_secret_key, row[0])
    token_expires_at = datetime.fromisoformat(credentials["expiresAt"])
    if token_expires_at < datetime.now(UTC) + _REFRESH_MARGIN:
        credentials = _refresh_credentials(conn, settings, user, credentials)
    access_token = credentials["accessToken"]

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S) as http:
            client = upwork.UpworkClient(http, access_token)
            page = client.search_jobs(q, first=20, after=body.cursor)
    except upwork.UpworkAuthError:
        # Proactive refresh above should prevent this; treat an unexpectedly-expired token the
        # same way as an expiry we saw coming.
        credentials = _refresh_credentials(conn, settings, user, credentials)
        try:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as http:
                client = upwork.UpworkClient(http, credentials["accessToken"])
                page = client.search_jobs(q, first=20, after=body.cursor)
        except upwork.UpworkError as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "service_unavailable", "message": "Upwork search failed"},
            ) from exc
    except upwork.UpworkRateLimited as exc:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Upwork rate limit exceeded"},
            headers={"Retry-After": str(int(exc.retry_after or 60))},
        ) from exc
    except upwork.UpworkError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "service_unavailable", "message": "Upwork search failed"},
        ) from exc

    result = {
        "items": [job.model_dump(mode="json") for job in page.jobs],
        "nextCursor": page.next_cursor,
    }

    fetched_at = datetime.now(UTC)
    expires_at = fetched_at + timedelta(hours=24)
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO upwork_search_cache (user_id, query_hash, results, fetched_at, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id, query_hash) DO UPDATE
                SET results = EXCLUDED.results,
                    fetched_at = EXCLUDED.fetched_at,
                    expires_at = EXCLUDED.expires_at
            """,
            (user.id, query_hash, Jsonb(result), fetched_at, expires_at),
        )
    return _with_cache_meta(result, fetched_at, expires_at)
