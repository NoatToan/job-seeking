"""Postgres access for the blog (tables from db/migrations/021_blog.sql)."""

from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from job_crawler.blog.feeds import Article
from job_crawler.blog.roundup import Roundup
from job_crawler.blog.topics import TOPICS_BY_SLUG

_COLUMNS = (
    "source, source_name, source_url, external_id, url, title, author, excerpt, published_at,"
    " topics, republish_mode, slug, licence_name, licence_url, body, pixel_url"
)

INSERT_ARTICLE_SQL = f"""
INSERT INTO blog_articles ({_COLUMNS})
VALUES ({", ".join(f"%({c.strip()})s" for c in _COLUMNS.split(","))})
ON CONFLICT DO NOTHING
RETURNING id
"""

# Articles not yet cited by any post, newest first. `since` bounds how stale a roundup can get.
UNASSIGNED_SQL = f"""
SELECT a.id, {", ".join("a." + c.strip() for c in _COLUMNS.split(","))}
FROM blog_articles a
WHERE NOT EXISTS (SELECT 1 FROM blog_post_articles pa WHERE pa.article_id = a.id)
  AND coalesce(a.published_at, a.first_seen_at) >= %(since)s
ORDER BY coalesce(a.published_at, a.first_seen_at) DESC
LIMIT 500
"""

RELATED_JOBS_SQL = """
SELECT id, title, company, location, remote
FROM jobs
WHERE source <> 'upwork'  -- same exclusion as the public catalogue (Upwork's API terms)
  AND coalesce(posted_at, first_seen_at) >= %(since)s
  AND (%(query)s::text IS NULL OR search @@ websearch_to_tsquery('english', %(query)s::text))
  AND (NOT %(remote_only)s OR remote)
ORDER BY coalesce(posted_at, first_seen_at) DESC, id DESC
LIMIT %(limit)s
"""


def tables_exist(conn: psycopg.Connection) -> bool:
    row = conn.execute("SELECT to_regclass('blog_post_articles') IS NOT NULL").fetchone()
    return bool(row and row[0])


def article_params(article: Article) -> dict[str, Any]:
    params = article.model_dump()
    params["body"] = Jsonb(article.body) if article.body is not None else None
    return params


def insert_articles(conn: psycopg.Connection, articles: list[Article]) -> int:
    """Insert new articles; ones already stored (same url, slug or source+id) are left as they
    are. Returns how many were new."""
    if not articles:
        return 0
    new = 0
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(INSERT_ARTICLE_SQL, [article_params(a) for a in articles], returning=True)
        while True:
            if cur.fetchone():
                new += 1
            if not cur.nextset():
                break
    return new


def unassigned_articles(conn: psycopg.Connection, since: datetime) -> list[tuple[int, Article]]:
    names = [c.strip() for c in _COLUMNS.split(",")]
    rows = conn.execute(UNASSIGNED_SQL, {"since": since}).fetchall()
    out = []
    for row in rows:
        values = dict(zip(names, row[1:], strict=True))
        values["topics"] = list(values["topics"] or [])
        out.append((row[0], Article(**values)))
    return out


def related_jobs(
    conn: psycopg.Connection,
    topics: list[str],
    since: datetime,
    *,
    per_topic: int = 2,
    total: int = 6,
) -> list[dict[str, Any]]:
    """A few recent jobs per topic of the post (deduped), as a snapshot stored on the post."""
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for slug in topics:
        topic = TOPICS_BY_SLUG.get(slug)
        if topic is None:
            continue
        rows = conn.execute(
            RELATED_JOBS_SQL,
            {
                "since": since,
                "query": topic.job_query,
                "remote_only": topic.remote_only,
                "limit": per_topic + len(seen),
            },
        ).fetchall()
        added = 0
        for job_id, title, company, location, remote in rows:
            if job_id in seen or added >= per_topic:
                continue
            seen.add(job_id)
            added += 1
            out.append(
                {
                    "id": job_id,
                    "title": title,
                    "company": company,
                    "location": location,
                    "remote": remote,
                    "topic": slug,
                }
            )
        if len(out) >= total:
            break
    return out[:total]


def slug_taken(conn: psycopg.Connection, slug: str) -> bool:
    return conn.execute("SELECT 1 FROM blog_posts WHERE slug = %s", (slug,)).fetchone() is not None


def insert_post(conn: psycopg.Connection, post: Roundup, article_ids: dict[str, int]) -> int:
    """Store a roundup and its cited articles in one transaction. `article_ids` maps article url
    -> blog_articles.id."""
    with conn.transaction():
        row = conn.execute(
            """
            INSERT INTO blog_posts (slug, kind, title, description, intro, sections, related_jobs,
                                    topics, published_at)
            VALUES (%s, 'daily-roundup', %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                post.slug,
                post.title,
                post.description,
                post.intro,
                Jsonb([{"topic": s.topic, "commentary": s.commentary} for s in post.sections]),
                Jsonb(post.related_jobs),
                post.topics,
                post.published_at,
            ),
        ).fetchone()
        assert row is not None
        post_id = row[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO blog_post_articles (post_id, article_id, topic, position)"
                " VALUES (%s, %s, %s, %s)",
                [
                    (post_id, article_ids[article.url], section.topic, position)
                    for position, (section, article) in enumerate(post.items())
                ],
            )
    return post_id
