"""CSRF double-submit dependency, on a throwaway app (no DB / no session needed)."""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from ujc_api.auth.csrf import generate_csrf_token, require_csrf
from ujc_api.main import create_app, register_exception_handlers
from ujc_api.settings import Settings


def _app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/protected", dependencies=[Depends(require_csrf)])
    def protected() -> dict:
        return {"ok": True}

    return app


def test_missing_csrf_cookie_and_header_is_rejected():
    with TestClient(_app()) as client:
        resp = client.post("/protected")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_failed"


def test_cookie_without_header_is_rejected():
    with TestClient(_app(), cookies={"ujc_csrf": "secret-token"}) as client:
        resp = client.post("/protected")
    assert resp.status_code == 403


def test_mismatched_header_is_rejected():
    with TestClient(_app(), cookies={"ujc_csrf": "secret-token"}) as client:
        resp = client.post("/protected", headers={"X-CSRF-Token": "wrong-token"})
    assert resp.status_code == 403


def test_matching_cookie_and_header_is_accepted():
    with TestClient(_app(), cookies={"ujc_csrf": "secret-token"}) as client:
        resp = client.post("/protected", headers={"X-CSRF-Token": "secret-token"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_generate_csrf_token_is_long_and_url_safe():
    token = generate_csrf_token()
    assert len(token) >= 32
    assert all(c.isalnum() or c in "-_" for c in token)


def test_generate_csrf_token_is_unique():
    assert generate_csrf_token() != generate_csrf_token()


def test_csrf_endpoint_issues_a_cookie_to_a_visitor_without_one():
    settings = Settings(database_url="postgresql://unused/unused", ujc_env="test")
    # https: the cookie is `Secure` outside development, so plain http would never send it back.
    client = TestClient(create_app(settings), base_url="https://testserver")
    resp = client.get("/api/auth/csrf")
    assert resp.status_code == 204
    assert resp.headers["cache-control"] == "no-store"
    token = client.cookies.get("ujc_csrf")
    assert token and len(token) >= 32
    # An existing cookie is kept (a signed-in session's token must not change under it).
    again = client.get("/api/auth/csrf")
    assert again.status_code == 204
    assert "set-cookie" not in again.headers
    assert client.cookies.get("ujc_csrf") == token
