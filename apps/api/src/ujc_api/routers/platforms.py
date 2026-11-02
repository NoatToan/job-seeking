"""`GET /api/platforms` (M3-01): the connection catalogue for the signed-in user."""

import psycopg
from fastapi import APIRouter, Depends

from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.platforms import platform_catalogue
from ujc_api.settings import Settings

router = APIRouter(prefix="/api/platforms", tags=["platforms"])


@router.get("")
def get_platforms(
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> dict:
    return {"items": platform_catalogue(conn, user.id, settings)}
