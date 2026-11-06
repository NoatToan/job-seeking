from ujc_api.auth.session import SESSION_COOKIE


def test_baseline_headers_present_on_every_response(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert resp.headers["X-Frame-Options"] == "DENY"


def test_non_public_routes_are_never_cacheable_with_or_without_session(client):
    """Cache-Control is per route now (ujc_api.cache_control, see test_cache_control.py)."""
    assert client.get("/api/health").headers["Cache-Control"] == "private, no-store"
    client.cookies.set(SESSION_COOKIE, "fake-token-value")
    assert client.get("/api/health").headers["Cache-Control"] == "private, no-store"


def test_headers_present_on_error_responses_too(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
