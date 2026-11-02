"""`PUT /api/connections/adzuna`, `DELETE /api/connections/{platform}` (M3-01).

Credentials are validated once (Adzuna: a real API call), then stored AES-GCM-encrypted
(`ujc_api.crypto`) — the column never holds plaintext. The masked key echoed back on success is
the last 4 characters only; the key itself is never returned again after this call.
"""

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from job_crawler.http import HttpClient
from job_crawler.sources import adzuna
from pydantic import BaseModel, field_validator

from ujc_api import audit
from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.crypto import encrypt_json
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.settings import Settings

router = APIRouter(prefix="/api/connections", tags=["connections"])

_PLATFORMS = frozenset({"adzuna", "upwork"})


def _mask(value: str) -> str:
    return f"****{value[-4:]}" if len(value) > 4 else "****"


class AdzunaConnectRequest(BaseModel):
    appId: str  # noqa: N815 - camelCase matches the wire contract
    appKey: str  # noqa: N815 - camelCase matches the wire contract

    @field_validator("appId", "appKey")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v.strip()


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=422,
        detail={"code": "invalid_credentials", "message": "Adzuna rejected this app id/key"},
    )


@router.put("/adzuna", dependencies=[Depends(require_csrf)])
def connect_adzuna(
    body: AdzunaConnectRequest,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> dict:
    with HttpClient(retries=0) as http:
        ok = adzuna.verify_credentials(http, body.appId, body.appKey)
    if not ok:
        raise _invalid_credentials()

    encrypted = encrypt_json(settings.ujc_secret_key, {"appId": body.appId, "appKey": body.appKey})
    with conn.transaction():
        conn.execute(
            """
            INSERT INTO platform_connections
                (user_id, platform, status, credentials_encrypted, external_account)
            VALUES (%s, 'adzuna', 'connected', %s, %s)
            ON CONFLICT (user_id, platform) DO UPDATE
                SET status = 'connected',
                    credentials_encrypted = EXCLUDED.credentials_encrypted,
                    external_account = EXCLUDED.external_account,
                    updated_at = now()
            """,
            (user.id, encrypted, body.appId),
        )
    audit.record(conn, user.id, "connection_added", {"platform": "adzuna"})
    return {
        "platform": "adzuna",
        "connected": True,
        "externalAccount": body.appId,
        "maskedAppKey": _mask(body.appKey),
    }


@router.delete("/{platform}", status_code=204, dependencies=[Depends(require_csrf)])
def disconnect_platform(
    platform: str,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> None:
    if platform not in _PLATFORMS:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": "Unknown platform"}
        )
    with conn.transaction():
        deleted = conn.execute(
            "DELETE FROM platform_connections WHERE user_id = %s AND platform = %s",
            (user.id, platform),
        )
        if deleted.rowcount == 0:
            raise HTTPException(
                status_code=404, detail={"code": "not_found", "message": "Not connected"}
            )
        if platform == "upwork":
            conn.execute("DELETE FROM upwork_search_cache WHERE user_id = %s", (user.id,))
    audit.record(conn, user.id, "connection_removed", {"platform": platform})
