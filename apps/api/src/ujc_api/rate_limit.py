"""Process-wide rate limiter instances for generic API hardening (docs/product/SECURITY.md),
plus the ASGI middleware that applies the per-IP one to every unsafe-method request.

Both limiters reuse `auth.ratelimit.SlidingWindowRateLimiter`, the same in-memory limiter the
OTP flow uses — see that module's docstring for the multi-instance/cold-start caveat. These are
a generic backstop *in addition to* any endpoint-specific limit (e.g. OTP send is already far
stricter than the generic 120/min).
"""

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ujc_api.auth.ratelimit import SlidingWindowRateLimiter
from ujc_api.net import client_ip

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# 120 requests/minute per IP across every unsafe-method route.
UNSAFE_METHOD_LIMIT = 120
UNSAFE_METHOD_WINDOW_SECONDS = 60.0
unsafe_method_limiter = SlidingWindowRateLimiter(
    max_count=UNSAFE_METHOD_LIMIT, window_seconds=UNSAFE_METHOD_WINDOW_SECONDS
)

# 30 requests/minute per user for GET /api/search/live (it fans out to live, unauthenticated
# third-party sources, so it is far more expensive per-call than a normal read).
LIVE_SEARCH_LIMIT = 30
LIVE_SEARCH_WINDOW_SECONDS = 60.0
live_search_limiter = SlidingWindowRateLimiter(
    max_count=LIVE_SEARCH_LIMIT, window_seconds=LIVE_SEARCH_WINDOW_SECONDS
)


def reset_rate_limiters() -> None:
    """Test-only: both limiters are in-process singletons (by design), so without resetting them
    state leaks across tests that share the test client's fake IP/user."""
    unsafe_method_limiter.reset()
    live_search_limiter.reset()


def _rate_limited_response(retry_after: int) -> JSONResponse:
    body = {
        "error": {
            "code": "rate_limited",
            "message": "Too many requests, try again later",
        }
    }
    return JSONResponse(status_code=429, content=body, headers={"Retry-After": str(retry_after)})


class RateLimitMiddleware:
    """429s (with `Retry-After`) any POST/PUT/PATCH/DELETE once an IP exceeds
    `UNSAFE_METHOD_LIMIT` per `UNSAFE_METHOD_WINDOW_SECONDS`. Runs ahead of routing/auth/CSRF, so
    an attacker never reaches those layers once rate-limited.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return

        ip = client_ip(Request(scope, receive=receive))
        if not unsafe_method_limiter.allow(ip):
            response = _rate_limited_response(int(UNSAFE_METHOD_WINDOW_SECONDS))
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
