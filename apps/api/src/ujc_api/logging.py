"""JSON logging and the request-id/access-log middleware."""

import json
import logging
import sys
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"

_EXTRA_FIELDS = ("request_id", "method", "path", "status", "duration_ms")

access_log = logging.getLogger("ujc_api.access")


class JsonFormatter(logging.Formatter):
    """One JSON object per log line. Never includes query strings (see RequestIdMiddleware)."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in _EXTRA_FIELDS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


class RequestIdMiddleware:
    """Accepts an incoming `X-Request-ID` or generates a uuid4; sets it on every response and logs
    one JSON access line per request. Only the path is logged, never the query string, so secrets
    or PII passed as query params never reach the logs.

    Implemented as plain ASGI (not `BaseHTTPMiddleware`): Starlette's exception-handler plumbing
    re-raises an exception after a registered `Exception` handler has already produced a
    response, for upstream observability (see `starlette._exception_handler.wrapped_app`).
    `BaseHTTPMiddleware` surfaces that re-raise through `call_next` *before* returning a
    `Response`, so code here would never run for an unhandled exception and the header would be
    missing exactly when it matters most. Wrapping `send` instead means the header is attached to
    the ASGI messages that were already sent, regardless of what happens afterwards.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope) or str(uuid.uuid4())
        # Shared with downstream code via `request.state.request_id` (see ujc_api.main), because a
        # handler registered for the bare `Exception` class is pulled out by Starlette into
        # `ServerErrorMiddleware`, which sits outside this middleware — `send_wrapper` below never
        # sees that response, so that handler attaches the header itself instead.
        scope.setdefault("state", {})["request_id"] = request_id
        start = time.perf_counter()
        status: dict[str, int | None] = {"code": None}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.append(REQUEST_ID_HEADER, request_id)
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # Not sent through `send_wrapper` (see above), but it will become a 500 one way or
            # another once it reaches `ServerErrorMiddleware`.
            status["code"] = status["code"] or 500
            raise
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            access_log.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status["code"],
                    "duration_ms": duration_ms,
                },
            )


def _incoming_request_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers", ()):
        if name.decode("latin-1").lower() == REQUEST_ID_HEADER.lower():
            return value.decode("latin-1")
    return None
