"""In-memory MCP client tests for the M3-08 user-data tools (my_feed, my_job, my_live_search,
my_applications, save_job, update_application), against a mocked API via `httpx.MockTransport`
— no real `UJC_API_URL`/`UJC_TOKEN`, no network (mcp.Client connects in-process, see
mcp.shared.memory / mcp.client._memory.InMemoryTransport)."""

import asyncio
import json

import httpx
from mcp import Client
from mcp.server import MCPServer

from job_search_mcp import ujc_client
from job_search_mcp.server import register_user_data_tools
from job_search_mcp.ujc_client import UjcApiClient


def _server(handler) -> MCPServer:
    client = UjcApiClient(
        base_url="https://ujc.test",
        token="ujc_pat_test",
        transport=httpx.MockTransport(handler),
    )
    server = MCPServer("test-job-seeking")
    register_user_data_tools(server, client)
    return server


def _call(server: MCPServer, name: str, arguments: dict | None = None):
    async def run():
        async with Client(server) as client:
            return await client.call_tool(name, arguments or {})

    return asyncio.run(run())


def test_my_feed_calls_feed_endpoint_with_bearer_token():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"items": [], "nextCursor": None, "keywords": []})

    result = _call(_server(handler), "my_feed", {"q": "python"})
    assert result.is_error is False
    assert result.structured_content == {"items": [], "nextCursor": None, "keywords": []}
    assert len(requests) == 1
    req = requests[0]
    assert req.url.path == "/api/feed"
    assert req.url.params["q"] == "python"
    assert req.headers["Authorization"] == "Bearer ujc_pat_test"


def test_my_job_calls_job_detail_endpoint():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/jobs/42"
        return httpx.Response(200, json={"id": "42", "title": "Engineer"})

    result = _call(_server(handler), "my_job", {"job_id": "42"})
    assert result.structured_content["title"] == "Engineer"


def test_my_live_search_passes_query_and_cursor():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/search/live"
        assert request.url.params["q"] == "react"
        assert request.url.params["cursor"] == "abc"
        return httpx.Response(200, json={"items": [], "nextCursor": None, "sources": []})

    result = _call(_server(handler), "my_live_search", {"q": "react", "cursor": "abc"})
    assert result.structured_content["items"] == []


def test_my_applications_filters_by_status():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/applications"
        assert request.url.params["status"] == "applied"
        return httpx.Response(200, json={"items": []})

    result = _call(_server(handler), "my_applications", {"status": "applied"})
    assert result.structured_content == {"items": []}


def test_save_job_posts_jobid_status_and_note():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/applications"
        body = json.loads(request.content)
        assert body == {"jobId": "7", "status": "saved", "note": "looks good"}
        return httpx.Response(201, json={"id": "1", "jobId": "7", "status": "saved"})

    result = _call(_server(handler), "save_job", {"job_id": "7", "note": "looks good"})
    assert result.structured_content["status"] == "saved"


def test_update_application_patches_status():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PATCH"
        assert request.url.path == "/api/applications/9"
        body = json.loads(request.content)
        assert body == {"status": "applied"}
        return httpx.Response(200, json={"id": "9", "status": "applied"})

    result = _call(
        _server(handler), "update_application", {"application_id": "9", "status": "applied"}
    )
    assert result.structured_content["status"] == "applied"


def test_update_application_with_no_fields_returns_a_clear_error_without_calling_the_api():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not call the API with nothing to update")

    result = _call(_server(handler), "update_application", {"application_id": "9"})
    assert "error" in result.structured_content


def test_revoked_or_expired_token_surfaces_as_a_tool_result_not_an_mcp_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"error": {"code": "unauthorized", "message": "Sign in required"}}
        )

    result = _call(_server(handler), "my_feed", {})
    assert result.is_error is False
    assert result.structured_content["error"] == "401: Sign in required"


def test_missing_scope_also_surfaces_as_a_tool_result():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "code": "forbidden",
                    "message": "Token is missing the 'applications:write' scope",
                }
            },
        )

    result = _call(_server(handler), "my_applications", {})
    assert (
        result.structured_content["error"] == "403: Token is missing the 'applications:write' scope"
    )


def test_token_value_never_appears_in_a_tool_result():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    result = _call(_server(handler), "my_feed", {})
    assert "ujc_pat_test" not in json.dumps(result.structured_content)


def test_user_data_tools_are_disabled_without_both_env_vars(monkeypatch):
    monkeypatch.delenv("UJC_API_URL", raising=False)
    monkeypatch.delenv("UJC_TOKEN", raising=False)
    assert ujc_client.enabled() is False

    monkeypatch.setenv("UJC_API_URL", "https://ujc.test")
    monkeypatch.delenv("UJC_TOKEN", raising=False)
    assert ujc_client.enabled() is False

    monkeypatch.setenv("UJC_TOKEN", "ujc_pat_x")
    assert ujc_client.enabled() is True
