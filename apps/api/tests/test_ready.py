from fastapi.testclient import TestClient

from ujc_api.main import create_app
from ujc_api.settings import Settings


def test_ready_503_when_db_unreachable():
    """No real database is ever listening here, so this needs no TEST_DATABASE_URL."""
    settings = Settings(database_url="postgresql://127.0.0.1:1/does-not-exist", ujc_env="test")
    with TestClient(create_app(settings)) as client:
        resp = client.get("/api/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "service_unavailable"


def test_ready_200_with_working_migrated_db(migrated_database_url):
    settings = Settings(database_url=migrated_database_url, ujc_env="test")
    with TestClient(create_app(settings)) as client:
        resp = client.get("/api/ready")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
