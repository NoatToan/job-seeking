from fastapi import FastAPI
from fastapi.testclient import TestClient

from ujc_api.logging import RequestIdMiddleware
from ujc_api.main import register_exception_handlers


def test_unknown_route_returns_404_in_standard_shape(client):
    resp = client.get("/api/this-route-does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert isinstance(body["error"]["message"], str)
    assert "X-Request-ID" in resp.headers


def test_unhandled_exception_returns_500_without_a_stack_trace():
    """Exercises the real middleware + handlers on a throwaway app (the real app has no route
    that raises, by design), so this test never changes the production router's surface.
    """
    boom_app = FastAPI()
    register_exception_handlers(boom_app)
    boom_app.add_middleware(RequestIdMiddleware)

    @boom_app.get("/boom")
    def boom() -> None:
        raise ValueError("some internal detail that must never reach the client")

    # raise_server_exceptions=False: we are intentionally triggering an unhandled exception and
    # want to inspect the HTTP response it produces, not have the test client re-raise it (its
    # default behaviour, meant to surface bugs in a route under test).
    with TestClient(boom_app, raise_server_exceptions=False) as client:
        resp = client.get("/boom")

    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "internal_error"
    assert "some internal detail" not in resp.text
    assert "Traceback" not in resp.text
    assert "X-Request-ID" in resp.headers


def test_validation_error_returns_400_with_fields():
    boom_app = FastAPI()
    register_exception_handlers(boom_app)
    boom_app.add_middleware(RequestIdMiddleware)

    @boom_app.get("/items/{item_id}")
    def item(item_id: int) -> dict:
        return {"item_id": item_id}

    with TestClient(boom_app) as client:
        resp = client.get("/items/not-a-number")

    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert "fields" in body["error"]
    assert body["error"]["fields"]
