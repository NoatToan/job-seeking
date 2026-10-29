def test_health_returns_ok_and_version(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str) and body["version"]


def test_health_never_touches_the_database(client):
    """The `client` fixture points at an unreachable DB; health must still return 200."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
