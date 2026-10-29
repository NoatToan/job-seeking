"""CSRF double-submit dependency, on a throwaway app (no DB / no session needed)."""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from ujc_api.auth.csrf import generate_csrf_token, require_csrf
from ujc_api.main import register_exception_handlers


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
