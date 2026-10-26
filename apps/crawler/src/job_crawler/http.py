import logging
import time
from typing import Any

import httpx

from job_crawler import USER_AGENT

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}


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

    def get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        attempt = 0
        while True:
            try:
                response = self._client.get(url, params=params)
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
