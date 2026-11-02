"""Baseline hardening headers on every API response (docs/product/SECURITY.md).

Mirrors the headers `deploy/Caddyfile` already sets for the Docker deploy, and the `headers`
entries in `vercel.json` for the static SPA, so both deployment paths look the same to a client.
Implemented as plain ASGI (not `BaseHTTPMiddleware`), same reasoning as
`ujc_api.logging.RequestIdMiddleware`: wrapping `send` means the headers land on the ASGI
messages that were already sent regardless of what happens afterwards (an unhandled exception
re-raised past `call_next` would otherwise skip `BaseHTTPMiddleware` entirely).
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ujc_api.auth.session import SESSION_COOKIE

# (header name, value) pairs applied to every HTTP response.
_STATIC_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("X-Frame-Options", "DENY"),
)


def _has_session_cookie(scope: Scope) -> bool:
    """Whether the incoming request carried the session cookie, i.e. the response may contain
    user-specific data and must never be cached. Checked on the *request* cookie header (not
    whether the session actually validates): a response to an invalid/expired cookie can still
    carry 401 details that shouldn't be cached either, and the real auth check happens in
    `auth.deps.current_user` regardless.
    """
    for name, value in scope.get("headers", ()):
        if name.decode("latin-1").lower() == "cookie":
            cookie_header = value.decode("latin-1")
            parts = (p.strip() for p in cookie_header.split(";"))
            if any(p.startswith(f"{SESSION_COOKIE}=") for p in parts):
                return True
    return False


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        authenticated = _has_session_cookie(scope)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _STATIC_HEADERS:
                    headers.append(name, value)
                if authenticated:
                    headers.append("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_wrapper)
