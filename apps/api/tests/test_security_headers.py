from ujc_api.auth.session import SESSION_COOKIE


def test_baseline_headers_present_on_every_response(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert resp.headers["X-Frame-Options"] == "DENY"


def test_no_cache_control_without_session_cookie(client):
    resp = client.get("/api/health")
    assert "cache-control" not in {k.lower() for k in resp.headers}


def test_cache_control_no_store_when_session_cookie_present(client):
    client.cookies.set(SESSION_COOKIE, "fake-token-value")
    resp = client.get("/api/health")
    assert resp.headers["Cache-Control"] == "no-store"


def test_headers_present_on_error_responses_too(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
