"""HTTP client for the user's own unified-job-crawler API (M3-08): the `my_*`/`save_job`/
`update_application` tools in `server.py` call the signed-in user's own deployment on their
behalf, authenticated with their personal access token (`Authorization: Bearer ujc_pat_...`,
`docs/product/ARCHITECTURE.md` §10 `UJC_API_URL`/`UJC_TOKEN`). Bearer auth is exempt from CSRF
(see `apps/api/src/ujc_api/auth/csrf.py`), so no CSRF token handling is needed here.
"""

import contextlib
import os
from typing import Any

import httpx

from .sources.common import USER_AGENT


def enabled() -> bool:
    """Whether the user-data tools should be registered: both env vars must be set (server.py
    checks this once at import time; `apps/mcp`'s free-source tools work either way)."""
    return bool(os.environ.get("UJC_API_URL")) and bool(os.environ.get("UJC_TOKEN"))


class UjcApiClient:
    """Thin async wrapper around the API's `/api/feed`, `/api/jobs`, `/api/search/live` and
    `/api/applications` endpoints. Never raises for a 4xx/5xx: callers get back a plain
    `{"error": "<status>: <message>"}` dict instead, so a revoked/expired token or a missing
    scope surfaces to Claude as a normal tool result rather than an MCP-level failure. The token
    itself never appears in a returned error or is logged.
    """

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self._base_url = (base_url if base_url is not None else os.environ["UJC_API_URL"]).rstrip(
            "/"
        )
        self._token = token if token is not None else os.environ["UJC_TOKEN"]
        self._transport = transport
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "User-Agent": USER_AGENT}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=self._timeout, transport=self._transport
        ) as http_client:
            resp = await http_client.request(
                method,
                f"{self._base_url}{path}",
                params={k: v for k, v in (params or {}).items() if v is not None},
                json=json,
                headers=self._headers(),
            )
        if resp.status_code >= 400:
            message = resp.reason_phrase
            with contextlib.suppress(ValueError):
                message = resp.json().get("error", {}).get("message", message)
            return {"error": f"{resp.status_code}: {message}"}
        if resp.status_code == 204 or not resp.content:
            return {"ok": True}
        return resp.json()

    async def get_feed(self, cursor: str | None = None, q: str | None = None) -> dict[str, Any]:
        """`GET /api/feed` — jobs matching the user's saved keywords (scope `jobs:read`)."""
        return await self._request("GET", "/api/feed", params={"cursor": cursor, "q": q})

    async def get_job(self, job_id: str) -> dict[str, Any]:
        """`GET /api/jobs/{id}` — full job detail including description (scope `jobs:read`)."""
        return await self._request("GET", f"/api/jobs/{job_id}")

    async def live_search(self, q: str, cursor: str | None = None) -> dict[str, Any]:
        """`GET /api/search/live` — queries each platform's own search API now (scope
        `jobs:read`)."""
        return await self._request("GET", "/api/search/live", params={"q": q, "cursor": cursor})

    async def list_applications(self, status: str | None = None) -> dict[str, Any]:
        """`GET /api/applications` — the user's tracked applications (scope
        `applications:write`)."""
        return await self._request("GET", "/api/applications", params={"status": status})

    async def save_job(self, job_id: str, note: str | None = None) -> dict[str, Any]:
        """`POST /api/applications` — track a job as `saved` (scope `applications:write`);
        idempotent, tracking an already-tracked job just returns it."""
        body: dict[str, Any] = {"jobId": job_id, "status": "saved"}
        if note is not None:
            body["note"] = note
        return await self._request("POST", "/api/applications", json=body)

    async def update_application(
        self, application_id: str, status: str | None = None, note: str | None = None
    ) -> dict[str, Any]:
        """`PATCH /api/applications/{id}` — update status and/or note (scope
        `applications:write`)."""
        body: dict[str, Any] = {}
        if status is not None:
            body["status"] = status
        if note is not None:
            body["note"] = note
        if not body:
            return {"error": "Provide at least one of status or note to update."}
        return await self._request("PATCH", f"/api/applications/{application_id}", json=body)
