"""Generic per-IP unsafe-method rate limit (RateLimitMiddleware). A nonexistent path is used on
purpose: the middleware runs ahead of routing, so it rate-limits a request regardless of whether
a matching route exists — and this keeps the test free of any DB/auth dependency."""

from ujc_api.rate_limit import UNSAFE_METHOD_LIMIT, UNSAFE_METHOD_WINDOW_SECONDS


def test_unsafe_method_under_limit_reaches_routing(client):
    resp = client.post("/api/does-not-exist")
    assert resp.status_code == 404  # reached routing, not rate-limited


def test_safe_methods_are_never_rate_limited(client):
    for _ in range(UNSAFE_METHOD_LIMIT + 5):
        resp = client.get("/api/health")
        assert resp.status_code == 200


def test_unsafe_method_over_limit_returns_429_with_retry_after(client):
    for _ in range(UNSAFE_METHOD_LIMIT):
        resp = client.post("/api/does-not-exist")
        assert resp.status_code == 404

    resp = client.post("/api/does-not-exist")
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "rate_limited"
    assert resp.headers["Retry-After"] == str(int(UNSAFE_METHOD_WINDOW_SECONDS))


def test_rate_limited_response_still_carries_request_id_and_security_headers(client):
    for _ in range(UNSAFE_METHOD_LIMIT):
        client.post("/api/does-not-exist")

    resp = client.post("/api/does-not-exist")
    assert resp.status_code == 429
    assert resp.headers.get("X-Request-ID")
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


def test_rate_limit_is_keyed_per_ip(client):
    for _ in range(UNSAFE_METHOD_LIMIT):
        client.post("/api/does-not-exist")
    assert client.post("/api/does-not-exist").status_code == 429

    # A different client IP (X-Forwarded-For) gets its own budget.
    resp = client.post("/api/does-not-exist", headers={"x-forwarded-for": "203.0.113.5"})
    assert resp.status_code == 404
