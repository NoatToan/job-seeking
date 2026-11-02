"""End-to-end privacy flows against a real (throwaway-schema) Postgres database: AI consent gate,
`GET /api/me/export`, `DELETE /api/me`, and retention purge. Skipped with a clear message when
`TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api import maintenance
from ujc_api.main import create_app
from ujc_api.settings import Settings


def _settings(migrated_database_url: str) -> Settings:
    return Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
    )


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(_settings(migrated_database_url))
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, email: str) -> str:
    otp_resp = client.post("/api/auth/otp", json={"email": email})
    assert otp_resp.status_code == 202, otp_resp.text
    code = otp_resp.json()["devCode"]
    verify_resp = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert verify_resp.status_code == 200, verify_resp.text
    csrf = client.cookies.get("ujc_csrf")
    assert csrf
    return csrf


def test_cv_upload_requires_ai_consent_then_succeeds_after_consent(client: TestClient):
    csrf = _sign_in(client, "nocvsent@example.com")

    resp = client.post(
        "/api/cvs",
        files={"file": ("cv.txt", b"Jane Doe\nSoftware Engineer", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "consent_required"

    consented = client.post(
        "/api/me/consent", json={"aiProcessing": True}, headers={"X-CSRF-Token": csrf}
    )
    assert consented.status_code == 200, consented.text
    assert consented.json()["aiConsentAt"]

    me = client.get("/api/me").json()
    assert me["user"]["aiConsentAt"]

    resp2 = client.post(
        "/api/cvs",
        files={"file": ("cv.txt", b"Jane Doe\nSoftware Engineer", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp2.status_code == 202, resp2.text


def test_consent_rejects_false(client: TestClient):
    csrf = _sign_in(client, "falseconsent@example.com")
    resp = client.post(
        "/api/me/consent", json={"aiProcessing": False}, headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 400


def test_export_contains_only_this_users_data(client: TestClient, migrated_database_url: str):
    csrf_a = _sign_in(client, "exporter-a@example.com")
    client.post("/api/me/consent", json={"aiProcessing": True}, headers={"X-CSRF-Token": csrf_a})
    client.put(
        "/api/me/preferences",
        json={"keywords": ["python"], "remoteOnly": True, "candidateCountry": "VN"},
        headers={"X-CSRF-Token": csrf_a},
    )
    upload = client.post(
        "/api/cvs",
        files={"file": ("cv.txt", b"Jane Doe\nSoftware Engineer", "text/plain")},
        headers={"X-CSRF-Token": csrf_a},
    )
    assert upload.status_code == 202, upload.text

    # A second user, never visible in the first user's export.
    client2 = TestClient(client.app, base_url="https://testserver")
    csrf_b = _sign_in(client2, "exporter-b@example.com")
    client2.put(
        "/api/me/preferences",
        json={"keywords": ["other-user-keyword"], "remoteOnly": False, "candidateCountry": None},
        headers={"X-CSRF-Token": csrf_b},
    )

    export = client.get("/api/me/export")
    assert export.status_code == 200, export.text
    assert export.headers["content-type"].startswith("application/json")
    assert "attachment" in export.headers["content-disposition"]
    body = export.json()
    assert body["user"]["email"] == "exporter-a@example.com"
    assert body["preferences"]["keywords"] == ["python"]
    assert len(body["cvs"]) == 1
    assert "content" not in body["cvs"][0]
    assert "text" not in body["cvs"][0]
    assert "other-user-keyword" not in str(body)


def test_delete_account_requires_csrf_and_literal_confirm_then_removes_everything(
    client: TestClient, migrated_database_url: str
):
    csrf = _sign_in(client, "deleteme@example.com")
    client.post("/api/me/consent", json={"aiProcessing": True}, headers={"X-CSRF-Token": csrf})
    client.put(
        "/api/me/preferences",
        json={"keywords": ["python"], "remoteOnly": False, "candidateCountry": None},
        headers={"X-CSRF-Token": csrf},
    )

    # no CSRF
    assert client.request("DELETE", "/api/me", json={"confirm": "DELETE"}).status_code == 403
    # wrong confirm text
    wrong = client.request(
        "DELETE", "/api/me", json={"confirm": "delete"}, headers={"X-CSRF-Token": csrf}
    )
    assert wrong.status_code == 400

    deleted = client.request(
        "DELETE", "/api/me", json={"confirm": "DELETE"}, headers={"X-CSRF-Token": csrf}
    )
    assert deleted.status_code == 204
    assert "ujc_session" not in client.cookies

    # session is gone: further requests are unauthorized
    assert client.get("/api/me").status_code == 401

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        remaining = conn.execute(
            "SELECT count(*) FROM users WHERE email = %s", ("deleteme@example.com",)
        ).fetchone()
        assert remaining is not None and remaining[0] == 0


def test_purge_clears_old_cv_bytes_but_keeps_profile_and_deletes_expired_rows(
    migrated_database_url: str,
):
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        user_row = conn.execute(
            "INSERT INTO users (email) VALUES (%s) RETURNING id", ("purge-user@example.com",)
        ).fetchone()
        assert user_row is not None
        user_id = user_row[0]

        old_created_at = datetime.now(UTC) - timedelta(days=200)
        cv_row = conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, text, profile, keywords,"
            " status, created_at)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, 'done', %s) RETURNING id",
            (
                user_id,
                "old.txt",
                "text/plain",
                b"raw cv bytes",
                "raw cv text",
                psycopg.types.json.Jsonb({"headline": "Engineer"}),
                ["python"],
                old_created_at,
            ),
        ).fetchone()
        assert cv_row is not None
        cv_id = cv_row[0]

        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at)"
            " VALUES ('expired-hash', %s, now() - interval '1 day')",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO email_otps (email, code_hash, expires_at)"
            " VALUES (%s, 'hash', now() - interval '1 day')",
            ("purge-user@example.com",),
        )

        result = maintenance.purge(conn)
        assert result["cvs_content_cleared"] == 1
        assert result["sessions_deleted"] == 1
        assert result["otps_deleted"] == 1

        row = conn.execute(
            "SELECT content, text, profile, keywords FROM user_cvs WHERE id = %s", (cv_id,)
        ).fetchone()
        assert row is not None
        content, text, profile, keywords = row
        assert bytes(content) == b""
        assert text is None
        assert profile == {"headline": "Engineer"}
        assert keywords == ["python"]
