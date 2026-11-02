"""BodySizeLimitMiddleware: 1 MB default, 5 MB for `POST /api/cvs`. A nonexistent path is used
for the default-limit cases on purpose: the middleware runs ahead of routing, so an oversized
body is rejected (or an in-limit one passed through to a 404) regardless of whether a route
matches — this keeps the test free of any DB/auth dependency."""

from ujc_api.body_limit import CV_UPLOAD_MAX_BYTES, DEFAULT_MAX_BYTES


def test_body_over_default_limit_is_rejected_with_413(client):
    body = b"x" * (DEFAULT_MAX_BYTES + 1)
    resp = client.post("/api/does-not-exist", content=body)
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "payload_too_large"


def test_body_at_exactly_the_default_limit_reaches_routing(client):
    body = b"x" * DEFAULT_MAX_BYTES
    resp = client.post("/api/does-not-exist", content=body)
    assert resp.status_code == 404  # reached routing instead of being rejected


def test_cv_upload_route_is_not_rejected_below_5mb(client):
    # One byte under the CV-specific 5 MB limit: the generic 1 MB default would reject this, the
    # per-route override must not. (The request fails later for unrelated reasons — no session,
    # no real multipart body — but never with 413.)
    body = b"x" * (CV_UPLOAD_MAX_BYTES - 1)
    resp = client.post("/api/cvs", content=body)
    assert resp.status_code != 413


def test_cv_upload_route_still_rejects_over_5mb(client):
    body = b"x" * (CV_UPLOAD_MAX_BYTES + 1)
    resp = client.post("/api/cvs", content=body)
    assert resp.status_code == 413
