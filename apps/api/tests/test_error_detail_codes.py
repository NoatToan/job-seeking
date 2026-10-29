"""`HTTPException(status, detail={"code": ...})` overrides the generic per-status-code mapping
(needed for 401 `unauthorized`, 410 `code_expired`, 403 `csrf_failed`, etc. — see
`main._http_exception_handler`)."""

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from ujc_api.main import register_exception_handlers


def _app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/plain-401")
    def plain_401() -> None:
        raise HTTPException(status_code=401, detail="nope")

    @app.get("/custom-401")
    def custom_401() -> None:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "nope"})

    @app.get("/custom-429")
    def custom_429() -> None:
        raise HTTPException(
            status_code=429,
            detail={"code": "too_many_attempts", "message": "slow down"},
            headers={"Retry-After": "42"},
        )

    return app


def test_plain_string_detail_uses_the_generic_status_code_mapping():
    with TestClient(_app()) as client:
        resp = client.get("/plain-401")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


def test_dict_detail_overrides_the_code():
    with TestClient(_app()) as client:
        resp = client.get("/custom-401")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"
    assert resp.json()["error"]["message"] == "nope"


def test_dict_detail_headers_are_propagated():
    with TestClient(_app()) as client:
        resp = client.get("/custom-429")
    assert resp.json()["error"]["code"] == "too_many_attempts"
    assert resp.headers["Retry-After"] == "42"
