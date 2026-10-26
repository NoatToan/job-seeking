import httpx
import pytest

from job_crawler import USER_AGENT
from job_crawler.http import HttpClient


def _client(handler, retries: int = 3) -> HttpClient:
    return HttpClient(retries=retries, backoff=0, transport=httpx.MockTransport(handler))


def test_retries_on_429_then_succeeds():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 3:
            return httpx.Response(429)
        return httpx.Response(200, json={"ok": True})

    with _client(handler) as http:
        assert http.get_json("https://example.test/jobs", params={"page": 1}) == {"ok": True}
    assert len(calls) == 3
    assert calls[0].url.params["page"] == "1"
    assert calls[0].headers["User-Agent"] == USER_AGENT


def test_gives_up_after_retries():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(429)

    with _client(handler, retries=2) as http, pytest.raises(httpx.HTTPStatusError):
        http.get("https://example.test/jobs")
    assert len(calls) == 3


def test_does_not_retry_on_404():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(404)

    with _client(handler) as http, pytest.raises(httpx.HTTPStatusError):
        http.get("https://example.test/jobs")
    assert len(calls) == 1


def test_retries_on_transport_error():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, text="ok")

    with _client(handler) as http:
        assert http.get("https://example.test/").text == "ok"
    assert len(calls) == 2
