import logging
import time
from typing import Any

import httpx

from job_crawler import USER_AGENT

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}


class ResponseTooLarge(httpx.HTTPError):
    """The body exceeded `max_bytes` (read is aborted, nothing more is downloaded)."""


class HttpClient:
    """Polite HTTP client: fixed User-Agent, timeouts, retry with backoff on 429/5xx."""

    def __init__(
        self,
        *,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 2.0,
        board_delay: float = 1.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.retries = retries
        self.backoff = backoff
        self.board_delay = board_delay
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json, */*;q=0.8"},
            timeout=httpx.Timeout(timeout, connect=10.0),
            follow_redirects=True,
            transport=transport,
        )

    def get(
        self, url: str, params: dict[str, Any] | None = None, *, max_bytes: int | None = None
    ) -> httpx.Response:
        """GET with retries. `max_bytes` caps the body size (ResponseTooLarge when exceeded)."""
        attempt = 0
        while True:
            try:
                response = (
                    self._client.get(url, params=params)
                    if max_bytes is None
                    else self._get_capped(url, params, max_bytes)
                )
            except httpx.TransportError as exc:
                if attempt >= self.retries:
                    raise
                wait = self.backoff * 2**attempt
                log.warning("GET %s failed (%s), retrying in %.1fs", url, type(exc).__name__, wait)
            else:
                if response.status_code not in RETRY_STATUSES or attempt >= self.retries:
                    response.raise_for_status()
                    return response
                wait = self._retry_after(response) or self.backoff * 2**attempt
                log.warning("GET %s -> %s, retrying in %.1fs", url, response.status_code, wait)
            time.sleep(wait)
            attempt += 1

    def _get_capped(
        self, url: str, params: dict[str, Any] | None, max_bytes: int
    ) -> httpx.Response:
        with self._client.stream("GET", url, params=params) as response:
            declared = response.headers.get("Content-Length", "")
            if declared.isdigit() and int(declared) > max_bytes:
                raise ResponseTooLarge(f"{url}: {declared} bytes > {max_bytes}")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ResponseTooLarge(f"{url}: more than {max_bytes} bytes")
                chunks.append(chunk)
            # iter_bytes() already decoded gzip/br (so the cap applies to the real size); drop
            # the encoding headers so the rebuilt response isn't decoded a second time.
            headers = [
                (k, v)
                for k, v in response.headers.multi_items()
                if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")
            ]
            return httpx.Response(
                response.status_code,
                headers=headers,
                content=b"".join(chunks),
                request=response.request,
            )

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        return self.get(url, params=params).json()

    def pause(self) -> None:
        """Small delay between boards / pages so we don't hammer a host."""
        if self.board_delay > 0:
            time.sleep(self.board_delay)

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if value and value.isdigit():
            return min(float(value), 60.0)
        return None

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
