"""Upwork GraphQL client library (M3-03) — pure library, deliberately **not** registered in
`job_crawler.sources.SOURCES` (no daily crawl, no scheduler entry anywhere in this codebase).

Why: Upwork's API & MCP Terms (`docs/product/ARCHITECTURE.md` §7, the Terms PDF linked there)
forbid, among other things:

- continuous monitoring or enumeration (§4.1) — so this is only ever called from an explicit,
  user-directed search (M3-04's `POST /api/upwork/search`), never from a scheduler;
- bulk extraction or indexing (§3.5);
- caching results for more than 24h (§8.3) — the caller is responsible for deleting cached rows
  after 24h (see `upwork_search_cache` in ARCHITECTURE §4);
- using Upwork content to train, retrieval-augment, evaluate or benchmark AI (§5.3) — Upwork job
  data returned here must never be sent to an LLM or used for match scoring;
- hiding the source (§3.4, §5.12(c)) — every mapped job keeps a `url` back to upwork.com for
  attribution, and callers must show results in their own clearly-labelled panel.

Mapping targets `UpworkJob` below, deliberately **not** `job_crawler.models.JobRecord`, so this
can't accidentally be upserted into the `jobs` table by a caller that reuses the normal pipeline.

No live API key is needed for this module: `search_jobs` is tested entirely against recorded
fixture JSON (`tests/fixtures/upwork_search.json`, `upwork_errors.json`), written by hand from the
publicly documented schema shape and marked as synthetic. Field and enum names (query text in
`upwork_queries.py`) are **unverified** against the live schema — confirm them once the API key
application is approved (ARCHITECTURE §7).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, Field

from job_crawler.sources.upwork_queries import MARKETPLACE_JOB_POSTINGS_SEARCH
from job_crawler.text import clean, html_to_text, parse_datetime

log = logging.getLogger(__name__)

GRAPHQL_URL = "https://api.upwork.com/graphql"
AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize"
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"

DESCRIPTION_MAX_CHARS = 4000
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class UpworkError(Exception):
    """A GraphQL `errors` entry, or any other non-auth/rate-limit API failure."""


class UpworkAuthError(UpworkError):
    """HTTP 401: the access token is missing, expired or revoked. Caller should refresh the
    token (M3-04) or send the user back through `authorization_url`."""


class UpworkRateLimited(UpworkError):
    """HTTP 429, after the one built-in retry. `retry_after` is seconds, read from the
    `Retry-After` response header when Upwork sends one."""

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class UpworkJob(BaseModel):
    """One Upwork job posting, mapped from a `marketplaceJobPostingsSearch` edge. NOT a
    `JobRecord`: never written to the `jobs` table, never scored by an LLM, never included in a
    digest (ARCHITECTURE §7)."""

    id: str
    title: str
    description: str | None = None
    url: str
    created_at: datetime | None = None
    job_type: str | None = None
    budget_text: str | None = None
    skills: list[str] = Field(default_factory=list)
    client_country: str | None = None
    payment_verified: bool = False
    raw: dict[str, Any] = Field(default_factory=dict)


class UpworkPage(BaseModel):
    jobs: list[UpworkJob] = Field(default_factory=list)
    next_cursor: str | None = None
    has_more: bool = False
    total_count: int = 0


def _money_text(money: dict[str, Any] | None) -> str | None:
    if not money:
        return None
    value = money.get("rawValue")
    if value in (None, ""):
        return None
    currency = money.get("currency") or ""
    return f"{currency} {value}".strip()


def _budget_text(node: dict[str, Any]) -> str | None:
    fixed = _money_text(node.get("fixedPriceAmount"))
    if fixed:
        return f"{fixed} fixed"
    lo = _money_text(node.get("hourlyBudgetMin"))
    hi = _money_text(node.get("hourlyBudgetMax"))
    if lo and hi:
        return f"{lo} - {hi} / hr" if lo != hi else f"{lo} / hr"
    if lo or hi:
        return f"{lo or hi} / hr"
    return None


def _map_job(node: dict[str, Any]) -> UpworkJob:
    """Map one GraphQL edge `node` to an `UpworkJob`. Tolerant of missing budget/client
    fields: Upwork jobs may omit either depending on job type, client privacy settings, or
    GraphQL partial-error responses."""
    ciphertext = node.get("ciphertext") or node.get("id") or ""
    client = node.get("client") or {}
    skills = [s.get("name") for s in (node.get("skills") or []) if s and s.get("name")]
    description = html_to_text(node.get("description"))
    if description and len(description) > DESCRIPTION_MAX_CHARS:
        description = description[:DESCRIPTION_MAX_CHARS]
    return UpworkJob(
        id=ciphertext,
        title=clean(node.get("title")) or "",
        description=description,
        url=f"https://www.upwork.com/jobs/~{ciphertext}",
        created_at=parse_datetime(node.get("createdDateTime")),
        job_type=clean(node.get("jobType")),
        budget_text=_budget_text(node),
        skills=skills,
        client_country=clean((client.get("location") or {}).get("country")),
        payment_verified=bool(client.get("paymentVerified")),
        raw=node,
    )


class UpworkClient:
    """Thin GraphQL client for the user-directed Upwork search (M3-04 wires this up behind
    `UPWORK_ENABLED`; this module is fixture-tested only, no live key needed).

    `http` is an `httpx.Client` — inject one with `transport=httpx.MockTransport(...)` in tests,
    no real network involved. One retry with backoff on 429/5xx before giving up.
    """

    def __init__(
        self, http: httpx.Client, access_token: str, *, retries: int = 1, backoff: float = 1.0
    ) -> None:
        self._http = http
        self._token = access_token
        self._retries = retries
        self._backoff = backoff

    def search_jobs(
        self,
        expression: str,
        *,
        first: int = 20,
        after: str | None = None,
        skill_expression: str | None = None,
        category_ids: list[str] | None = None,
    ) -> UpworkPage:
        job_filter: dict[str, Any] = {
            "searchExpression_eq": expression,
            "pagination_eq": {"first": first, "after": after},
        }
        if skill_expression:
            job_filter["skillExpression_eq"] = skill_expression
        if category_ids:
            job_filter["categoryIds_any"] = category_ids
        payload = self._post(
            MARKETPLACE_JOB_POSTINGS_SEARCH,
            {"marketPlaceJobFilter": job_filter, "searchType": "JOBS"},
        )
        search = (payload.get("data") or {}).get("marketplaceJobPostingsSearch") or {}
        edges = search.get("edges") or []
        page_info = search.get("pageInfo") or {}
        return UpworkPage(
            jobs=[_map_job(edge.get("node") or {}) for edge in edges],
            next_cursor=page_info.get("endCursor"),
            has_more=bool(page_info.get("hasNextPage")),
            total_count=search.get("totalCount") or 0,
        )

    def _post(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        attempt = 0
        while True:
            response = self._http.post(
                GRAPHQL_URL,
                json={"query": query, "variables": variables},
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code == 401:
                raise UpworkAuthError("Upwork access token expired or invalid (401)")
            if response.status_code in _RETRYABLE_STATUSES and attempt < self._retries:
                wait = self._retry_after(response) or self._backoff * (attempt + 1)
                log.warning("upwork graphql -> %s, retrying in %.1fs", response.status_code, wait)
                time.sleep(wait)
                attempt += 1
                continue
            if response.status_code == 429:
                raise UpworkRateLimited(
                    "Upwork rate limit exceeded (429)", retry_after=self._retry_after(response)
                )
            response.raise_for_status()
            data = response.json()
            errors = data.get("errors")
            if errors:
                message = "; ".join(e.get("message", "unknown error") for e in errors)
                raise UpworkError(f"Upwork GraphQL error: {message}")
            return data

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if value and value.replace(".", "", 1).isdigit():
            return float(value)
        return None


# --- OAuth 2.0 (Authorization Code + PKCE) helpers -------------------------------------------
# Used by the Connections page / M3-04's connect flow. Building the authorize URL and the PKCE
# pair needs no network call, so these are fixture/vector-tested here too.


def make_verifier() -> str:
    """RFC 7636 `code_verifier`: 43-128 URL-safe characters."""
    return base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode("ascii")[:128]


def challenge(verifier: str) -> str:
    """RFC 7636 S256 `code_challenge` for a given `code_verifier`."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorization_url(client_id: str, redirect_uri: str, state: str, code_challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def _token_request(http: httpx.Client, data: dict[str, Any]) -> dict[str, Any]:
    response = http.post(TOKEN_URL, data=data, headers={"Accept": "application/json"})
    if response.status_code == 401:
        raise UpworkAuthError("Upwork OAuth token request rejected (401)")
    if response.status_code == 429:
        raise UpworkRateLimited(
            "Upwork rate limit exceeded (429)",
            retry_after=UpworkClient._retry_after(response),
        )
    if response.status_code >= 400:
        raise UpworkError(f"Upwork OAuth token request failed ({response.status_code})")
    return response.json()


def exchange_code(
    http: httpx.Client,
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
) -> dict[str, Any]:
    """Exchange an authorization `code` for access/refresh tokens (PKCE)."""
    return _token_request(
        http,
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
            "code_verifier": code_verifier,
        },
    )


def refresh(
    http: httpx.Client, *, client_id: str, client_secret: str, refresh_token: str
) -> dict[str, Any]:
    """Exchange a `refresh_token` for a new access token (and usually a new refresh token)."""
    return _token_request(
        http,
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
    )
