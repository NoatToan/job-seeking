"""HTTP client for the companion runner: talks only to our own API's runner endpoints
(`Authorization: Bearer <token>`), and never sends cookies, HTML or screenshots — only the
parsed `JobRecord` fields (docs/product/ARCHITECTURE.md D8)."""

import httpx

from job_crawler import USER_AGENT


class RunnerRevoked(Exception):
    """401: the runner token was revoked (or never existed)."""


class RunnerOutdated(Exception):
    """426: the server requires a newer runner version."""


class RunnerApiError(Exception):
    def __init__(self, status_code: int, body: object) -> None:
        super().__init__(f"HTTP {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class RunnerClient:
    def __init__(
        self,
        server: str,
        token: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        headers = {"User-Agent": USER_AGENT}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = httpx.Client(
            base_url=server.rstrip("/"),
            headers=headers,
            timeout=30.0,
            transport=transport,
        )

    def pair(self, code: str, name: str) -> dict:
        resp = self._client.post("/api/runner/pair", json={"code": code, "name": name})
        self._raise_for_status(resp)
        return resp.json()

    def plan(self) -> dict:
        resp = self._client.get("/api/runner/plan")
        self._raise_for_status(resp)
        return resp.json()

    def upload_jobs(self, site: str, jobs: list[dict]) -> dict:
        resp = self._client.post("/api/runner/jobs", json={"site": site, "jobs": jobs})
        self._raise_for_status(resp)
        return resp.json()

    def _raise_for_status(self, resp: httpx.Response) -> None:
        if resp.status_code == 401:
            raise RunnerRevoked()
        if resp.status_code == 426:
            raise RunnerOutdated()
        if resp.status_code >= 400:
            try:
                body = resp.json()
            except ValueError:
                body = resp.text
            raise RunnerApiError(resp.status_code, body)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "RunnerClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
