"""Baseline hardening headers on every API response (docs/product/SECURITY.md).

Mirrors the headers `deploy/Caddyfile` already sets for the Docker deploy, and the `headers`
entries in `vercel.json` for the static SPA, so both deployment paths look the same to a client.
Implemented as plain ASGI (not `BaseHTTPMiddleware`), same reasoning as
`ujc_api.logging.RequestIdMiddleware`: wrapping `send` means the headers land on the ASGI
messages that were already sent regardless of what happens afterwards (an unhandled exception
re-raised past `call_next` would otherwise skip `BaseHTTPMiddleware` entirely).

`Cache-Control` is not set here: `ujc_api.cache_control` decides it per route (public routes are
CDN-cacheable for everyone; everything else is `private, no-store`, signed in or not).
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# (header name, value) pairs applied to every HTTP response.
_STATIC_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("X-Frame-Options", "DENY"),
)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _STATIC_HEADERS:
                    headers.append(name, value)
            await send(message)

        await self.app(scope, receive, send_wrapper)
