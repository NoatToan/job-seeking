import httpx
import pytest

from job_crawler.runner.client import RunnerApiError, RunnerClient, RunnerOutdated, RunnerRevoked


def _client(handler, token: str | None = None) -> RunnerClient:
    return RunnerClient("https://host.test", token, transport=httpx.MockTransport(handler))


def test_pair_sends_no_auth_header_and_returns_the_token():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["body"] = request.read()
        return httpx.Response(200, json={"runnerId": "9", "token": "ujc_run_abc"})

    with _client(handler) as client:
        result = client.pair("ABCD-EFGH", "Tony's MacBook")

    assert result == {"runnerId": "9", "token": "ujc_run_abc"}
    assert "authorization" not in captured["headers"]
    assert b"ABCD-EFGH" in captured["body"]
    assert b"Tony" in captured["body"]


def test_plan_sends_bearer_header():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(
            200, json={"keywords": ["react"], "remoteOnly": True, "sites": ["linkedin"]}
        )

    with _client(handler, token="ujc_run_xyz") as client:
        plan = client.plan()

    assert captured["authorization"] == "Bearer ujc_run_xyz"
    assert plan["keywords"] == ["react"]


def test_upload_jobs_posts_site_and_jobs():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(200, json={"received": 1, "upserted": 1})

    with _client(handler, token="t") as client:
        result = client.upload_jobs("linkedin", [{"title": "Engineer"}])

    assert result == {"received": 1, "upserted": 1}
    assert b"linkedin" in captured["body"]


def test_401_raises_runner_revoked():
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "no"}})

    with _client(handler, token="t") as client, pytest.raises(RunnerRevoked):
        client.plan()


def test_426_raises_runner_outdated():
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(426, json={"error": {"code": "runner_outdated", "message": "old"}})

    with _client(handler, token="t") as client, pytest.raises(RunnerOutdated):
        client.plan()


def test_other_error_raises_runner_api_error_with_body():
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(400, json={"error": {"code": "invalid_code", "message": "bad"}})

    with _client(handler) as client, pytest.raises(RunnerApiError) as exc_info:
        client.pair("WRONGCOD", "x")
    assert exc_info.value.status_code == 400
    assert exc_info.value.body["error"]["code"] == "invalid_code"
