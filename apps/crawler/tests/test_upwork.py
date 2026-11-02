import json
from pathlib import Path

import httpx
import pytest

from job_crawler.sources import upwork

FIXTURES = Path(__file__).parent / "fixtures"
SEARCH_PAYLOAD = json.loads((FIXTURES / "upwork_search.json").read_text())
ERROR_PAYLOADS = json.loads((FIXTURES / "upwork_errors.json").read_text())


def _client(handler, **kwargs) -> upwork.UpworkClient:
    transport = httpx.MockTransport(handler)
    return upwork.UpworkClient(httpx.Client(transport=transport), "tok_abc", **kwargs)


def test_search_jobs_maps_full_and_sparse_nodes():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["authorization"] == "Bearer tok_abc"
        body = json.loads(request.content)
        assert body["variables"]["marketPlaceJobFilter"]["searchExpression_eq"] == "react native"
        return httpx.Response(200, json=SEARCH_PAYLOAD)

    page = _client(handler).search_jobs("react native", first=10)
    assert len(calls) == 1
    assert page.total_count == 2
    assert page.has_more is True
    assert page.next_cursor == "cursor_abc123"

    full, sparse = page.jobs
    assert full.id == "021abcdef0123456789"
    assert full.url == "https://www.upwork.com/jobs/~021abcdef0123456789"
    assert full.title == "Senior React Native Developer"
    assert full.description == "Build a mobile app for a logistics startup."
    assert full.job_type == "HOURLY"
    assert full.budget_text == "USD 30 - USD 60 / hr"
    assert full.skills == ["React Native", "TypeScript"]
    assert full.client_country == "United States"
    assert full.payment_verified is True
    assert full.created_at is not None

    # Acceptance criterion: missing budget/client fields don't blow up the mapping.
    assert sparse.budget_text is None
    assert sparse.client_country is None
    assert sparse.payment_verified is False
    assert sparse.skills == []
    assert sparse.description is None


def test_description_truncated_to_4000_chars():
    payload = json.loads(json.dumps(SEARCH_PAYLOAD))  # deep copy
    long_desc = "x" * 5000
    payload["data"]["marketplaceJobPostingsSearch"]["edges"][0]["node"]["description"] = long_desc

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    page = _client(handler).search_jobs("react native")
    assert len(page.jobs[0].description) == upwork.DESCRIPTION_MAX_CHARS


def test_graphql_errors_raise_upwork_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=ERROR_PAYLOADS["graphql_error"])

    with pytest.raises(upwork.UpworkError, match="searchExpression_eq"):
        _client(handler).search_jobs("react native")


def test_401_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_token"})

    with pytest.raises(upwork.UpworkAuthError):
        _client(handler).search_jobs("react native")


def test_429_raises_rate_limited_with_retry_after():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "30"})

    with pytest.raises(upwork.UpworkRateLimited) as exc_info:
        _client(handler, retries=0).search_jobs("react native")
    assert exc_info.value.retry_after == 30.0


def test_429_retries_once_then_succeeds():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json=SEARCH_PAYLOAD)

    page = _client(handler, backoff=0).search_jobs("react native")
    assert len(calls) == 2
    assert page.total_count == 2


def test_5xx_retries_once_then_raises_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    with pytest.raises(httpx.HTTPStatusError):
        _client(handler, backoff=0).search_jobs("react native")


# --- PKCE / OAuth helpers --------------------------------------------------------------------


def test_pkce_challenge_matches_rfc7636_test_vector():
    # https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert upwork.challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_make_verifier_is_rfc7636_shaped():
    verifier = upwork.make_verifier()
    assert 43 <= len(verifier) <= 128
    assert all(c.isalnum() or c in "-._~" for c in verifier)


def test_authorization_url_contains_pkce_and_state():
    url = upwork.authorization_url("client123", "https://app.test/cb", "state-xyz", "chal-abc")
    assert url.startswith(upwork.AUTHORIZE_URL + "?")
    assert "client_id=client123" in url
    assert "code_challenge=chal-abc" in url
    assert "code_challenge_method=S256" in url
    assert "state=state-xyz" in url


def test_exchange_code_posts_authorization_code_grant():
    def handler(request: httpx.Request) -> httpx.Response:
        body = dict(x.split("=") for x in request.content.decode().split("&"))
        assert body["grant_type"] == "authorization_code"
        assert body["code"] == "auth-code"
        return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt"})

    tokens = upwork.exchange_code(
        httpx.Client(transport=httpx.MockTransport(handler)),
        client_id="cid",
        client_secret="secret",
        redirect_uri="https://app.test/cb",
        code="auth-code",
        code_verifier="verifier",
    )
    assert tokens == {"access_token": "at", "refresh_token": "rt"}


def test_refresh_posts_refresh_token_grant():
    def handler(request: httpx.Request) -> httpx.Response:
        body = dict(x.split("=") for x in request.content.decode().split("&"))
        assert body["grant_type"] == "refresh_token"
        return httpx.Response(200, json={"access_token": "new-at"})

    tokens = upwork.refresh(
        httpx.Client(transport=httpx.MockTransport(handler)),
        client_id="cid",
        client_secret="secret",
        refresh_token="rt",
    )
    assert tokens["access_token"] == "new-at"


def test_exchange_code_401_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_grant"})

    with pytest.raises(upwork.UpworkAuthError):
        upwork.exchange_code(
            httpx.Client(transport=httpx.MockTransport(handler)),
            client_id="cid",
            client_secret="secret",
            redirect_uri="https://app.test/cb",
            code="bad-code",
            code_verifier="verifier",
        )
