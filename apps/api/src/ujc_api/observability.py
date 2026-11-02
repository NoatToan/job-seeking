"""Optional Sentry wiring (docs/product/SECURITY.md).

Structured JSON access/error logs with a request id (`ujc_api.logging`) are the hard requirement
and work with zero configuration. Sentry is strictly additive: when `SENTRY_DSN` is set, errors
also get the usual Sentry triage UI (grouping, stack traces across requests, alerting). It stays
off by default, and `before_send` strips request data so PII (emails, CV text, cookies, tokens)
never leaves the process even if a future handler accidentally logs it on `request.state`.
"""

import logging
from typing import Any

from ujc_api.settings import Settings

log = logging.getLogger(__name__)


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Drops request body/headers/cookies and query string before the event leaves the process.
    Stack traces, exception messages and the request method/path (no query string) still go
    through — the same "never the query string" rule `logging.JsonFormatter` follows."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("headers", None)
        request.pop("query_string", None)
    return event


def init_sentry(settings: Settings) -> None:
    """No-op unless `settings.sentry_dsn` is set. Imported lazily so environments that never set
    `SENTRY_DSN` don't pay for importing the SDK at all."""
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed; skipping Sentry init")
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.ujc_env,
        send_default_pii=False,
        before_send=_before_send,
    )
