"""Worker task processing against FakeWorkerConn + a fake extractor (no `claude` CLI, no DB)."""

from datetime import UTC, datetime

from fakes import FakeWorkerConn
from job_crawler.matching.claude import ClaudeError
from job_crawler.matching.cv import CvText
from job_crawler.matching.scorer import MatchResult

from ujc_api import worker


def _fake_text(_path) -> CvText:
    return CvText(text="Jane Doe — Senior Backend Engineer", ocr_used=False)


def _make_conn(skills=None, search_keywords=None, location="Remote"):
    conn = FakeWorkerConn()
    conn.tasks[1] = {
        "id": 1,
        "kind": "cv_extract",
        "payload": {"cv_id": 1},
        "status": "queued",
        "attempts": 0,
        "locked_by": None,
        "error": None,
    }
    conn.user_cvs[1] = {
        "id": 1,
        "user_id": 10,
        "filename": "cv.pdf",
        "content": b"%PDF-1.4 fake cv",
        "status": "queued",
    }
    profile = {
        "search_keywords": search_keywords if search_keywords is not None else ["python", "django"],
        "skills": skills
        if skills is not None
        else ["Python", "Django", "Postgres", "Docker", "AWS", "Kafka", "Redis", "gRPC", "GraphQL"],
        "location": location,
    }
    return conn, profile


def test_cv_extract_success_marks_task_and_cv_done():
    conn, profile = _make_conn()

    def fake_extract_profile(_text):
        return profile

    assert worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=fake_extract_profile
    )

    assert conn.tasks[1]["status"] == "done"
    assert conn.user_cvs[1]["status"] == "done"
    assert conn.user_cvs[1]["text"] == "Jane Doe — Senior Backend Engineer"
    assert conn.user_cvs[1]["profile"] == profile


def test_keywords_are_search_keywords_plus_first_8_skills_deduped_lowercased():
    skills = [
        "Python", "Django", "Postgres", "Docker", "AWS", "Kafka", "Redis", "gRPC", "GraphQL",
    ]  # fmt: skip
    conn, profile = _make_conn(search_keywords=["Python", "backend"], skills=skills)
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    keywords = conn.user_cvs[1]["keywords"]
    assert keywords[0] == "python"  # from search_keywords, not duplicated by the matching skill
    assert "backend" in keywords
    assert "graphql" not in keywords  # 9th skill, beyond the first 8
    assert len(keywords) <= 30
    assert len(keywords) == len(set(keywords))  # deduped


def test_keywords_are_capped_at_30():
    conn, profile = _make_conn(
        search_keywords=[f"kw{i}" for i in range(40)],
        skills=["Python"] * 8,
    )
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    assert len(conn.user_cvs[1]["keywords"]) == 30


def test_seeds_user_preferences_when_empty():
    conn, profile = _make_conn(location="Ho Chi Minh City, Vietnam")
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    prefs = conn.user_preferences[10]
    assert prefs["keywords"] == conn.user_cvs[1]["keywords"]
    assert prefs["candidate_country"] == "VN"


def test_does_not_overwrite_existing_user_keywords():
    conn, profile = _make_conn()
    conn.user_preferences[10] = {"keywords": ["already set"], "candidate_country": "AU"}
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    assert conn.user_preferences[10]["keywords"] == ["already set"]
    assert conn.user_preferences[10]["candidate_country"] == "AU"


def test_no_vietnam_mention_leaves_candidate_country_unset():
    conn, profile = _make_conn(location="Remote - Worldwide")
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    assert conn.user_preferences[10]["candidate_country"] is None


def test_failure_backs_off_then_errors_after_three_attempts():
    conn, _ = _make_conn()

    def boom(_text):
        raise RuntimeError("claude -p failed")

    for attempt in (1, 2):
        worker.run_once(conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=boom)
        assert conn.tasks[1]["status"] == "queued"
        assert conn.tasks[1]["attempts"] == attempt
        assert conn.user_cvs[1]["status"] == "queued"
        assert "claude -p failed" in conn.tasks[1]["error"]

    worker.run_once(conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=boom)
    assert conn.tasks[1]["status"] == "error"
    assert conn.tasks[1]["attempts"] == 3
    assert conn.user_cvs[1]["status"] == "error"


def test_empty_queue_returns_false():
    conn = FakeWorkerConn()
    assert worker.run_once(conn, worker="w1") is False


def test_requeues_stale_running_tasks():
    conn = FakeWorkerConn()
    conn.tasks[1] = {
        "id": 1,
        "kind": "cv_extract",
        "payload": {"cv_id": 1},
        "status": "running",
        "attempts": 1,
        "locked_by": "dead-worker",
        "error": None,
    }
    conn.user_cvs[1] = {
        "id": 1,
        "user_id": 10,
        "filename": "cv.txt",
        "content": b"hello",
        "status": "processing",
    }
    worker.run_once(
        conn,
        worker="w2",
        extract_text_fn=_fake_text,
        extract_profile_fn=lambda t: {"search_keywords": [], "skills": [], "location": ""},
    )
    assert conn.tasks[1]["status"] == "done"
    assert conn.tasks[1]["locked_by"] == "w2"


def test_cv_extract_success_enqueues_a_match_score_task():
    conn, profile = _make_conn()
    worker.run_once(
        conn, worker="w1", extract_text_fn=_fake_text, extract_profile_fn=lambda t: profile
    )
    match_tasks = [t for t in conn.tasks.values() if t["kind"] == "match_score"]
    assert len(match_tasks) == 1
    assert match_tasks[0]["payload"] == {"user_id": 10}
    assert match_tasks[0]["status"] == "queued"


def _job_row(job_id: int, **kw) -> dict:
    base = dict(
        title="Senior Backend Engineer",
        company="Acme",
        location="Worldwide",
        remote=True,
        open_to=["WORLDWIDE"],
        salary_text=None,
        employment_type="Full Time",
        tags=["Python"],
        description="Build backend services in Python.",
    )
    return {"id": job_id, **{**base, **kw}}


def _cv_profile_row(cv_id: int, user_id: int, *, status="done", profile=None) -> dict:
    return {
        "id": cv_id,
        "user_id": user_id,
        "status": status,
        "profile": profile or {"skills": ["Python"], "search_keywords": ["python"]},
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
    }


def test_match_score_scores_prefiltered_jobs_and_replaces_user_matches():
    conn = FakeWorkerConn()
    conn.tasks[1] = {
        "id": 1,
        "kind": "match_score",
        "payload": {"user_id": 10},
        "status": "queued",
        "attempts": 0,
        "locked_by": None,
        "error": None,
    }
    conn.user_cvs[1] = _cv_profile_row(1, 10)
    conn.jobs[1] = _job_row(1)
    conn.jobs[2] = _job_row(2, title="Marketing Manager", tags=["Marketing"], description="")
    conn.user_matches[(10, 99)] = {
        "cv_id": 1,
        "score": 10,
        "summary": "stale",
        "reasons": [],
        "missing_skills": [],
    }

    def fake_score_jobs(profile, preferences, jobs):
        return [
            MatchResult(
                job_id=j.id, score=90, summary="great fit", reasons=["a"], missing_skills=[]
            )
            for j in jobs
        ]

    assert worker.run_once(conn, worker="w1", score_jobs_fn=fake_score_jobs)
    assert conn.tasks[1]["status"] == "done"
    assert (10, 99) not in conn.user_matches  # stale match replaced
    assert conn.user_matches[(10, 1)]["score"] == 90
    assert (10, 2) not in conn.user_matches  # filtered out by the keyword prefilter


def test_match_score_is_a_noop_without_a_done_cv():
    conn = FakeWorkerConn()
    conn.tasks[1] = {
        "id": 1,
        "kind": "match_score",
        "payload": {"user_id": 10},
        "status": "queued",
        "attempts": 0,
        "locked_by": None,
        "error": None,
    }
    conn.user_cvs[1] = _cv_profile_row(1, 10, status="processing")
    conn.jobs[1] = _job_row(1)

    assert worker.run_once(conn, worker="w1", score_jobs_fn=lambda *a: [])
    assert conn.tasks[1]["status"] == "done"
    assert conn.user_matches == {}


def test_match_score_batch_failure_is_not_fatal():
    conn = FakeWorkerConn()
    conn.tasks[1] = {
        "id": 1,
        "kind": "match_score",
        "payload": {"user_id": 10},
        "status": "queued",
        "attempts": 0,
        "locked_by": None,
        "error": None,
    }
    conn.user_cvs[1] = _cv_profile_row(1, 10)
    conn.jobs[1] = _job_row(1)

    def boom(profile, preferences, jobs):
        raise ClaudeError("claude -p failed")

    assert worker.run_once(conn, worker="w1", score_jobs_fn=boom)
    assert conn.tasks[1]["status"] == "done"  # a failed batch doesn't fail the whole task
    assert conn.user_matches == {}
