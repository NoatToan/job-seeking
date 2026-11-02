"""`GET /api/digest/unsubscribe` (M4-08): one-click, no session required. The token is a
stateless HMAC(UJC_SECRET_KEY, user_id|"digest") (`ujc_api.digest.verify_unsubscribe_token`), so
this works even for a user who never signs back in, and there is no token table to clean up.
"""

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.digest import verify_unsubscribe_token
from ujc_api.settings import Settings

router = APIRouter(prefix="/api/digest", tags=["digest"])

_PAGE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px;
             margin: 15vh auto; padding: 0 24px; text-align: center; color: #1c1c1e;">
<h1>{title}</h1>
<p>{message}</p>
</body>
</html>
"""


def _page(title: str, message: str) -> HTMLResponse:
    return HTMLResponse(content=_PAGE.format(title=title, message=message))


@router.get("/unsubscribe")
def unsubscribe(
    u: str,
    t: str,
    settings: Settings = Depends(app_settings),
    conn: psycopg.Connection = Depends(get_conn),
) -> HTMLResponse:
    if not u.isdigit():
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_token", "message": "Invalid or expired unsubscribe link"},
        )
    user_id = int(u)
    if not verify_unsubscribe_token(settings, user_id, t):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_token", "message": "Invalid or expired unsubscribe link"},
        )

    conn.execute(
        "UPDATE user_preferences SET digest_enabled = false WHERE user_id = %s", (user_id,)
    )
    return _page(
        "You're unsubscribed",
        "You won't get the daily job digest anymore. You can turn it back on anytime from your "
        "CV page preferences.",
    )
