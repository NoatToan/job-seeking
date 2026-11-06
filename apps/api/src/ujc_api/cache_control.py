"""HTTP caching policy for every API response (docs/product/PERFORMANCE.md "Caching").

Two classes of response, decided by route, never by who is asking:

* **Public** (`PUBLIC_ROUTES`): data that is identical for every visitor — the job catalogue,
  a job's detail, facets, source status, the roadmap counts. A `200` gets
  `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` so Vercel's CDN serves it, plus a
  weak `ETag` (304 on a matching `If-None-Match`). The handlers behind these routes must not read
  the session: the CDN's cache key is method + URL (incl. query string) + host + deployment,
  never the `Cookie` header, so a response that varied by user would leak to the next visitor.
  Per-request inputs that change the answer (`q`, `sort`, `tz`, `based_in`, filters, cursor) are
  all in the query string and therefore part of the key.
* **Personal / everything else**: `Cache-Control: private, no-store` unless the handler set its own
  header. Signed-in lists (`/api/feed`, `/api/me/*`, applications, …) are filtered server-side by
  the user's criteria and are never cached anywhere.

A public route still falls back to `private, no-store` when: the status isn't 200 (errors and
404s are cheap and must not stick), the request carries `Authorization` (a personal access token;
Vercel never caches those requests either), or the response sets a cookie (a cacheable response
must never carry `Set-Cookie`; Vercel refuses to cache it too).

Deploy invalidation needs nothing here: Vercel's CDN cache key includes the unique deployment URL,
so a new deployment starts with an empty cache. `X-Build-Id` (the commit sha) is sent on every
response so the SPA can drop its in-memory view cache when a long-lived tab meets a new deploy.

Plain ASGI, like the other middlewares here (see `ujc_api.logging.RequestIdMiddleware`).
"""

import hashlib
import os
import re
from dataclasses import dataclass

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PRIVATE = "private, no-store"
BUILD_ID_HEADER = "X-Build-Id"


@dataclass(frozen=True, slots=True)
class PublicRoute:
    pattern: re.Pattern[str]
    s_maxage: int
    swr: int

    @property
    def header(self) -> str:
        return f"public, s-maxage={self.s_maxage}, stale-while-revalidate={self.swr}"


_MINUTE = 60
_HOUR = 60 * _MINUTE
_DAY = 24 * _HOUR

# Freshness is sized to how often the data changes: the crawl runs about daily (more often while
# sources are being added), so lists/sources are fresh for 5 min and may be served stale for a
# day while the CDN revalidates in the background; a job's detail and the facet counts barely
# move within an hour.
PUBLIC_ROUTES: tuple[PublicRoute, ...] = (
    PublicRoute(re.compile(r"/api/jobs"), 5 * _MINUTE, _DAY),
    PublicRoute(re.compile(r"/api/jobs/facets"), _HOUR, _DAY),
    PublicRoute(re.compile(r"/api/jobs/\d+"), _HOUR, _DAY),
    PublicRoute(re.compile(r"/api/sources"), 5 * _MINUTE, _HOUR),
    # Counts per public status: the same for every viewer (contributor_box `stats`). The board
    # list and item detail are NOT here: they carry the viewer's own vote/authorship when signed in.
    PublicRoute(re.compile(r"/api/feedback/stats"), 5 * _MINUTE, _HOUR),
)


def public_route(method: str, path: str) -> PublicRoute | None:
    if method not in ("GET", "HEAD"):
        return None
    for route in PUBLIC_ROUTES:
        if route.pattern.fullmatch(path):
            return route
    return None


def build_id() -> str:
    """The deployed commit (Vercel sets `VERCEL_GIT_COMMIT_SHA` at build and run time; the SPA is
    built with the same value as `NEXT_PUBLIC_BUILD_ID`). Empty when unknown (local dev)."""
    return (
        os.environ.get("VERCEL_GIT_COMMIT_SHA")
        or os.environ.get("UJC_BUILD_ID")
        or os.environ.get("VERCEL_DEPLOYMENT_ID")
        or ""
    )


def weak_etag(body: bytes) -> str:
    return f'W/"{hashlib.sha256(body).hexdigest()[:32]}"'


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    opaque = etag.removeprefix("W/")
    return any(tag.strip().removeprefix("W/") == opaque for tag in if_none_match.split(","))


class CacheControlMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_headers = Headers(scope=scope)
        route = public_route(scope["method"], scope["path"])
        if route is not None and "authorization" in request_headers:
            route = None
        build = build_id()

        if route is None:

            async def send_private(message: Message) -> None:
                if message["type"] == "http.response.start":
                    headers = MutableHeaders(scope=message)
                    if "cache-control" not in headers:
                        headers["Cache-Control"] = PRIVATE
                    if build:
                        headers[BUILD_ID_HEADER] = build
                await send(message)

            await self.app(scope, receive, send_private)
            return

        # Public route: buffer the (small, JSON) body so the ETag can be computed and a 304 sent.
        start: Message | None = None
        chunks: list[bytes] = []

        async def send_public(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                start = message
                return
            if message["type"] != "http.response.body" or start is None:
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            await _flush(start, b"".join(chunks))

        async def _flush(start_message: Message, body: bytes) -> None:
            headers = MutableHeaders(scope=start_message)
            if build:
                headers[BUILD_ID_HEADER] = build
            cacheable = start_message["status"] == 200 and "set-cookie" not in headers
            if not cacheable:
                headers["Cache-Control"] = PRIVATE
                await send(start_message)
                await send({"type": "http.response.body", "body": body})
                return
            etag = weak_etag(body)
            headers["Cache-Control"] = route.header
            headers["ETag"] = etag
            if _etag_matches(request_headers.get("if-none-match"), etag):
                not_modified = {
                    "type": "http.response.start",
                    "status": 304,
                    "headers": [
                        (k, v)
                        for k, v in start_message["headers"]
                        if k.lower() not in (b"content-length", b"content-type")
                    ],
                }
                await send(not_modified)
                await send({"type": "http.response.body", "body": b""})
                return
            await send(start_message)
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, send_public)
