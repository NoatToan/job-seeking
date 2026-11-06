"""Job votes (`PUT/DELETE /api/jobs/{id}/vote`, `GET /api/me/job-votes`, admin clear) and the
`community` aggregate in the public job payloads, against a real (throwaway-schema) Postgres
database. Skipped when `TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

from itertools import count

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api import job_votes
from ujc_api.main import create_app
from ujc_api.settings import Settings

ADMIN_EMAIL = "votes-admin@example.com"
_ids = count(1)


@pytest.fixture
def app(migrated_database_url: str):
    return create_app(
        Settings(
            database_url=migrated_database_url,
            ujc_env="test",
            ujc_secret_key="votes-test-secret",
            ujc_otp_review_mode=True,
            ujc_admin_emails=ADMIN_EMAIL,
        )
    )


def _client(app) -> TestClient:
    return TestClient(app, base_url="https://testserver")


def _db(url: str) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=True)


def _sign_in(client: TestClient, url: str, email: str, *, age_hours: int = 48) -> int:
    """Signs in and backdates the account by `age_hours` (new accounts' votes don't count)."""
    code = client.post("/api/auth/otp", json={"email": email}).json()["devCode"]
    assert client.post("/api/auth/verify", json={"email": email, "code": code}).status_code == 200
    with _db(url) as conn:
        return conn.execute(
            "UPDATE users SET created_at = now() - make_interval(hours => %s)"
            " WHERE email = %s RETURNING id",
            (age_hours, email),
        ).fetchone()[0]


def _csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("ujc_csrf") or ""}


def _job(url: str, *, posted_days_ago: int | None = 10) -> int:
    n = next(_ids)
    with _db(url) as conn:
        return conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, posted_at)"
            " VALUES ('votes-test', %s, %s, 'Vote Engineer', 'Acme',"
            "  CASE WHEN %s::int IS NULL THEN NULL ELSE now() - make_interval(days => %s) END)"
            " RETURNING id",
            (f"v{n}", f"https://example.test/v{n}", posted_days_ago, posted_days_ago or 0),
        ).fetchone()[0]


def _vote(client: TestClient, job_id: int, body: dict) -> dict:
    resp = client.put(f"/api/jobs/{job_id}/vote", json=body, headers=_csrf(client))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _voters(app, url: str, prefix: str, n: int) -> list[TestClient]:
    clients = []
    for i in range(n):
        c = _client(app)
        c.__enter__()
        _sign_in(c, url, f"{prefix}{i}-{next(_ids)}@example.com")
        clients.append(c)
    return clients


def test_vote_requires_session_and_csrf(app, migrated_database_url: str):
    job_id = _job(migrated_database_url)
    with _client(app) as client:
        assert client.put(f"/api/jobs/{job_id}/vote", json={"vote": "up"}).status_code in (
            401,
            403,
        )
        _sign_in(client, migrated_database_url, f"csrf-{next(_ids)}@example.com")
        resp = client.put(f"/api/jobs/{job_id}/vote", json={"vote": "up"})
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "csrf_failed"
        assert client.get(f"/api/me/job-votes?ids={job_id}").status_code == 200
        client.cookies.clear()
        assert client.get(f"/api/me/job-votes?ids={job_id}").status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"vote": "down"},  # a report needs a reason
        {"vote": "down", "reason": "nope"},
        {"vote": "down", "reason": "other"},  # 'other' needs a note
        {"vote": "down", "reason": "other", "note": "   "},
        {"vote": "down", "reason": "scam", "note": "x" * 201},
        {"vote": "up", "reason": "expired"},
        {"vote": "meh"},
    ],
)
def test_vote_validation(app, migrated_database_url: str, body: dict):
    job_id = _job(migrated_database_url)
    with _client(app) as client:
        _sign_in(client, migrated_database_url, f"valid-{next(_ids)}@example.com")
        resp = client.put(f"/api/jobs/{job_id}/vote", json=body, headers=_csrf(client))
        assert resp.status_code == 400, resp.text


def test_vote_change_remove_and_my_votes(app, migrated_database_url: str):
    job_id = _job(migrated_database_url)
    other = _job(migrated_database_url)
    with _client(app) as client:
        _sign_in(client, migrated_database_url, f"me-{next(_ids)}@example.com")
        missing = client.put("/api/jobs/999999999/vote", json={"vote": "up"}, headers=_csrf(client))
        assert missing.status_code == 404

        out = _vote(client, job_id, {"vote": "down", "reason": "other", "note": "  Role filled  "})
        assert out["vote"]["vote"] == "down"
        assert out["vote"]["reason"] == "other"
        assert out["vote"]["note"] == "Role filled"
        assert out["vote"]["counted"] is True
        assert out["community"]["reports"] == 1
        assert out["community"]["flagged"] is False  # one person alone never flags a job
        assert out["community"]["reasons"] == {"other": 1}

        # Change of mind: one row, now a confirmation.
        out = _vote(client, job_id, {"vote": "up"})
        assert out["vote"] == {**out["vote"], "vote": "up", "reason": None, "note": None}
        assert out["community"]["reports"] == 0
        assert out["community"]["confirms"] == 1

        mine = client.get(f"/api/me/job-votes?ids={job_id},{other},{job_id}").json()
        assert set(mine["votes"]) == {str(job_id)}
        assert mine["votes"][str(job_id)]["vote"] == "up"
        assert mine["community"][str(job_id)]["confirms"] == 1
        assert mine["community"][str(other)] is None

        resp = client.delete(f"/api/jobs/{job_id}/vote", headers=_csrf(client))
        assert resp.status_code == 200
        assert resp.json() == {"vote": None, "community": None}
        # Idempotent; unknown job is 404.
        assert client.delete(f"/api/jobs/{job_id}/vote", headers=_csrf(client)).status_code == 200
        assert client.delete("/api/jobs/999999999/vote", headers=_csrf(client)).status_code == 404

        assert client.get("/api/me/job-votes?ids=abc").status_code == 400
        too_many = ",".join(str(i) for i in range(1, 102))
        assert client.get(f"/api/me/job-votes?ids={too_many}").status_code == 400


def test_flag_threshold_public_payloads_and_hide_reported(app, migrated_database_url: str):
    url = migrated_database_url
    job_id = _job(url)
    voters = _voters(app, url, "flag", 3)
    try:
        out = _vote(voters[0], job_id, {"vote": "down", "reason": "expired"})
        assert out["community"]["flagged"] is False
        out = _vote(voters[1], job_id, {"vote": "down", "reason": "expired"})
        assert out["community"]["flagged"] is True
        assert out["community"]["topReason"] == "expired"
        # A confirmation doesn't outweigh two reports...
        out = _vote(voters[2], job_id, {"vote": "up"})
        assert out["community"] | {"lastReportedAt": None} == {
            "reports": 2,
            "confirms": 1,
            "flagged": True,
            "topReason": "expired",
            "reasons": {"expired": 2},
            "lastReportedAt": None,
        }
        # ...but switching one report to "still good" unflags it.
        out = _vote(voters[1], job_id, {"vote": "up"})
        assert out["community"]["flagged"] is False
        _vote(voters[1], job_id, {"vote": "down", "reason": "ghosting"})
    finally:
        for c in voters:
            c.__exit__(None, None, None)

    with _client(app) as anon:
        detail = anon.get(f"/api/jobs/{job_id}").json()
        assert detail["community"]["reports"] == 2
        assert detail["community"]["reasons"] == {"expired": 1, "ghosting": 1}
        assert detail["community"]["lastReportedAt"]
        assert "vote" not in detail  # never the viewer's own vote in the public payload

        listed = anon.get("/api/jobs?source=votes-test&limit=50").json()["items"]
        row = next(j for j in listed if j["id"] == str(job_id))
        assert row["community"]["flagged"] is True
        assert all("community" in j for j in listed)

        hidden = anon.get("/api/jobs?source=votes-test&limit=50&hide_reported=true").json()
        assert str(job_id) not in {j["id"] for j in hidden["items"]}
        for sort in ("salary", "timezone&tz=Asia/Ho_Chi_Minh"):
            page = anon.get(f"/api/jobs?source=votes-test&limit=50&hide_reported=true&sort={sort}")
            assert page.status_code == 200, page.text
            assert str(job_id) not in {j["id"] for j in page.json()["items"]}


def test_young_accounts_old_votes_reposts_and_admin_clear(app, migrated_database_url: str):
    url = migrated_database_url
    job_id = _job(url, posted_days_ago=60)
    with _client(app) as young:
        _sign_in(young, url, f"young-{next(_ids)}@example.com", age_hours=1)
        out = _vote(young, job_id, {"vote": "down", "reason": "scam"})
        assert out["vote"]["counted"] is False
        assert out["community"] is None

    voters = _voters(app, url, "decay", 3)
    try:
        for c in voters:
            _vote(c, job_id, {"vote": "down", "reason": "expired"})
    finally:
        for c in voters:
            c.__exit__(None, None, None)

    with _db(url) as conn:
        assert job_votes.refresh_stats(conn, [job_id])[job_id]["reports"] == 3
        # 20 days old: half weight (1.5 < 2 -> not flagged); 50 days: gone.
        conn.execute(
            "UPDATE job_votes SET updated_at = now() - interval '20 days'"
            " WHERE job_id = %s AND reason = 'expired'",
            (job_id,),
        )
        stats = job_votes.refresh_stats(conn, [job_id])[job_id]
        assert (stats["reports"], stats["flagged"]) == (3, False)  # 3 x 0.5 = 1.5 < 2
        conn.execute(
            "UPDATE job_votes SET updated_at = now() - interval '50 days'"
            " WHERE job_id = %s AND reason = 'expired'",
            (job_id,),
        )
        assert job_votes.refresh_stats(conn, [job_id])[job_id] is None
        # Back to fresh, then the board reposts the job: reports before the new posted_at go.
        conn.execute(
            "UPDATE job_votes SET updated_at = now() - interval '1 day' WHERE job_id = %s",
            (job_id,),
        )
        conn.execute(
            "UPDATE job_votes SET reason = 'evergreen' WHERE job_id = %s AND user_id = (SELECT"
            " min(user_id) FROM job_votes WHERE job_id = %s AND reason = 'expired')",
            (job_id, job_id),
        )
        conn.execute("UPDATE jobs SET posted_at = now() WHERE id = %s", (job_id,))
        stats = job_votes.refresh_stats(conn, [job_id])[job_id]
        assert stats["reasons"] == {"evergreen": 1}  # "reposted forever" survives a repost
        conn.execute(
            "UPDATE jobs SET posted_at = now() - interval '60 days' WHERE id = %s", (job_id,)
        )
        # The daily refresh picks up every job with a recent vote.
        assert job_votes.refresh_all(conn) >= 1
        stats = job_votes.refresh_stats(conn, [job_id])[job_id]
        assert (stats["reports"], stats["flagged"]) == (3, True)

    with _client(app) as user, _client(app) as admin:
        _sign_in(user, url, f"plain-{next(_ids)}@example.com")
        resp = user.delete(f"/api/admin/jobs/{job_id}/votes", headers=_csrf(user))
        assert resp.status_code == 403
        _sign_in(admin, url, ADMIN_EMAIL)
        missing = admin.delete("/api/admin/jobs/999999999/votes", headers=_csrf(admin))
        assert missing.status_code == 404
        resp = admin.delete(f"/api/admin/jobs/{job_id}/votes", headers=_csrf(admin))
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"community": None}
        # A new vote after the clear counts again.
        out = _vote(admin, job_id, {"vote": "down", "reason": "wrong_details"})
        assert out["community"]["reasons"] == {"wrong_details": 1}
    # The cleared voters keep their vote (it just stops counting).
    with _db(url) as conn:
        assert (
            conn.execute("SELECT count(*) FROM job_votes WHERE job_id = %s", (job_id,)).fetchone()[
                0
            ]
            == 5
        )


def test_rate_limit(app, migrated_database_url: str, monkeypatch):
    from ujc_api.routers import job_votes as router

    monkeypatch.setattr(router, "RATE_LIMIT_VOTES", 3)
    jobs = [_job(migrated_database_url) for _ in range(4)]
    with _client(app) as client:
        _sign_in(client, migrated_database_url, f"rate-{next(_ids)}@example.com")
        for job_id in jobs[:3]:
            _vote(client, job_id, {"vote": "up"})
        resp = client.put(f"/api/jobs/{jobs[3]}/vote", json={"vote": "up"}, headers=_csrf(client))
        assert resp.status_code == 429
        assert resp.json()["error"]["code"] == "rate_limited"
        assert resp.headers["Retry-After"]
