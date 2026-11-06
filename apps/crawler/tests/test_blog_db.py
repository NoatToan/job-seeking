"""Blog tables against a real Postgres (TEST_DATABASE_URL, migrated with db/migrations). Skipped
when unset. Every test runs in a transaction that is rolled back."""

import os
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from job_crawler.blog import db as blog_db
from job_crawler.blog.feeds import Article
from job_crawler.blog.roundup import build

NOW = datetime.now(UTC)


@pytest.fixture
def conn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(url) as connection:
        exists = connection.execute("SELECT to_regclass('blog_articles')").fetchone()[0]
        if exists is None:
            pytest.skip("blog tables missing: apply db/migrations first")
        with connection.transaction(force_rollback=True):
            yield connection


def article(i: int, **extra) -> Article:
    values = {
        "source": "ere",
        "source_name": "ERE",
        "external_id": f"ext-{i}",
        "url": f"https://www.ere.net/articles/{i}",
        "title": f"Recruiting article {i}",
        "excerpt": "Short.",
        "published_at": NOW - timedelta(hours=i),
        "topics": ["hiring"],
    }
    values.update(extra)
    return Article(**values)


def full_article(i: int) -> Article:
    return article(
        i,
        source="bls-jolts",
        source_name="U.S. Bureau of Labor Statistics",
        url=f"https://www.bls.gov/r/{i}.htm",
        republish_mode="full",
        slug=f"release-{i}",
        licence_name="Public domain (U.S. government work)",
        licence_url="https://www.bls.gov/opub/copyright-information.htm",
        body=[{"type": "p", "inline": [{"text": "Body."}]}],
    )


def test_insert_dedupes_by_url_and_source_id(conn):
    assert blog_db.insert_articles(conn, [article(1), article(2), full_article(3)]) == 3
    again = [
        article(1),
        article(9, url="https://www.ere.net/articles/2"),
        article(10, external_id="ext-1"),
    ]
    assert blog_db.insert_articles(conn, again) == 0
    assert conn.execute("SELECT count(*) FROM blog_articles").fetchone()[0] == 3


def test_constraints_reject_body_in_excerpt_mode_and_full_without_licence(conn):
    rejected = [
        article(1, body=[{"type": "hr"}]),
        full_article(2).model_copy(update={"licence_url": None}),
        article(3, excerpt="x" * 601),
    ]
    assert blog_db.insert_articles(conn, rejected) == 0
    assert conn.execute("SELECT count(*) FROM blog_articles").fetchone()[0] == 0


def test_one_bad_row_does_not_lose_the_batch(conn):
    bad = article(2).model_copy(update={"excerpt": "x" * 601})
    assert blog_db.insert_articles(conn, [article(1), bad, article(3)]) == 2


def test_roundup_round_trip_and_articles_cited_once(conn):
    blog_db.insert_articles(conn, [article(i) for i in range(1, 4)] + [full_article(4)])
    candidates = blog_db.unassigned_articles(conn, NOW - timedelta(days=7))
    assert len(candidates) == 4
    restored = dict((a.url, a) for _, a in candidates)["https://www.bls.gov/r/4.htm"]
    assert restored.republish_mode == "full" and restored.body and restored.slug == "release-4"

    post = build([a for _, a in candidates], now=NOW)
    post.related_jobs = blog_db.related_jobs(conn, post.topics, NOW - timedelta(days=14))
    post_id = blog_db.insert_post(conn, post, {a.url: i for i, a in candidates})
    assert post_id
    assert blog_db.slug_taken(conn, post.slug)
    assert blog_db.unassigned_articles(conn, NOW - timedelta(days=7)) == []
    cited = conn.execute("SELECT count(*) FROM blog_post_articles WHERE post_id = %s", (post_id,))
    assert cited.fetchone()[0] == 4


def test_related_jobs_excludes_upwork_and_old_jobs(conn):
    conn.execute(
        "INSERT INTO jobs (source, external_id, url, title, company, remote, posted_at) VALUES"
        " ('greenhouse', 'b1', 'https://x.test/1', 'Senior Recruiter', 'Acme', true, now()),"
        " ('upwork', 'b2', 'https://x.test/2', 'Recruiter gig', 'U', true, now()),"
        " ('lever', 'b3', 'https://x.test/3', 'Recruiter', 'Old', true, now() - interval '60 days')"
    )
    jobs = blog_db.related_jobs(conn, ["hiring"], NOW - timedelta(days=14), per_topic=5)
    assert [j["company"] for j in jobs] == ["Acme"]
    assert jobs[0]["topic"] == "hiring"
