"""create_app(): the FastAPI app factory. Builds a fresh app from a Settings instance so tests can
override configuration (database_url, ujc_env, ...) without touching process environment state.
"""

import logging
import uuid
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from importlib import metadata

import psycopg
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ujc_api.db import close_pool
from ujc_api.logging import REQUEST_ID_HEADER, RequestIdMiddleware, configure_logging
from ujc_api.migrate import pending_migrations
from ujc_api.settings import Settings, get_settings

log = logging.getLogger(__name__)

# Maps a response status code to the error-shape `code` (docs/product/ARCHITECTURE.md §5).
_STATUS_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "unprocessable",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def app_version() -> str:
    try:
        return metadata.version("ujc_api")
    except metadata.PackageNotFoundError:
        return "0.0.0"


def _error_body(code: str, message: str, fields: Mapping[str, str] | None = None) -> dict:
    error: dict[str, object] = {"code": code, "message": message}
    if fields:
        error["fields"] = dict(fields)
    return {"error": error}


def _request_id(request: Request) -> str:
    """The id `RequestIdMiddleware` generated for this request (docs/product/ARCHITECTURE.md: every
    response carries one). A handler for the bare `Exception` class is installed by Starlette as
    `ServerErrorMiddleware`'s handler, which sits *outside* any `add_middleware()`-registered
    middleware, so that middleware's `send` wrapping never sees this response. Handlers therefore
    set the header on the `Response` they return instead of relying on the middleware for it.
    """
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


async def _http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _STATUS_CODES.get(exc.status_code, "error")
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    response = JSONResponse(status_code=exc.status_code, content=_error_body(code, message))
    response.headers[REQUEST_ID_HEADER] = _request_id(request)
    return response


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    fields: dict[str, str] = {}
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"] if part != "body")
        fields[loc or "_"] = err["msg"]
    body = _error_body("validation_error", "The request could not be validated", fields)
    response = JSONResponse(status_code=400, content=body)
    response.headers[REQUEST_ID_HEADER] = _request_id(request)
    return response


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled exception on %s %s", request.method, request.url.path, exc_info=exc)
    body = _error_body("internal_error", "Internal server error")
    response = JSONResponse(status_code=500, content=body)
    response.headers[REQUEST_ID_HEADER] = _request_id(request)
    return response


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    close_pool()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.ujc_log_level)

    docs_enabled = settings.ujc_env != "production"
    app = FastAPI(
        title="Unified Job Crawler API",
        version=app_version(),
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url="/api/redoc" if docs_enabled else None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
        lifespan=_lifespan,
    )
    register_exception_handlers(app)
    app.add_middleware(RequestIdMiddleware)

    def _app_settings() -> Settings:
        """Bound to this app instance's `settings`, not the process-wide cached singleton, so
        `create_app(settings=...)` fully controls what each route sees (tests rely on this)."""
        return settings

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": app_version()}

    @app.get("/api/ready")
    def ready(req_settings: Settings = Depends(_app_settings)) -> JSONResponse:
        try:
            with psycopg.connect(req_settings.database_url, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
                pending = pending_migrations(conn)
        except Exception as exc:
            log.warning("readiness check failed: %s", exc)
            body = _error_body("service_unavailable", "Database unreachable")
            return JSONResponse(status_code=503, content=body)
        if pending:
            fields = {"pending": ", ".join(p.name for p in pending)}
            body = _error_body("service_unavailable", "Pending migrations", fields)
            return JSONResponse(status_code=503, content=body)
        return JSONResponse(status_code=200, content={"status": "ok"})

    return app


app = create_app()
