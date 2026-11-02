"""Caps request body size (docs/product/SECURITY.md): 1 MB by default, 5 MB for the CV upload
route (`POST /api/cvs`, which already re-checks its own 5 MB limit in
`cv_upload.validate_cv` — this middleware is a cheap first line of defence that avoids reading
an oversized body into memory at all when `Content-Length` is present, and aborts a chunked
request mid-stream otherwise).
"""

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MAX_BYTES = 1 * 1024 * 1024
CV_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
_CV_UPLOAD_PATH = "/api/cvs"


class _BodyTooLarge(Exception):
    pass


def _max_bytes_for(method: str, path: str) -> int:
    if method == "POST" and path == _CV_UPLOAD_PATH:
        return CV_UPLOAD_MAX_BYTES
    return DEFAULT_MAX_BYTES


def _too_large_response() -> JSONResponse:
    body = {"error": {"code": "payload_too_large", "message": "Request body is too large"}}
    return JSONResponse(status_code=413, content=body)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = _max_bytes_for(scope.get("method", ""), scope.get("path", ""))

        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = None
            if declared is not None and declared > max_bytes:
                await _too_large_response()(scope, receive, send)
                return

        total = 0
        response_started = False

        async def receive_with_limit() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > max_bytes:
                    raise _BodyTooLarge
            return message

        async def send_tracking(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive_with_limit, send_tracking)
        except _BodyTooLarge:
            if response_started:
                raise
            await _too_large_response()(scope, receive, send)
