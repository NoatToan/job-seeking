"""Daily blog ingestion: `python -m job_crawler.blog [--dry-run]`.

1. Fetch every feed in sources.SOURCES (robots.txt checked, 1 request per feed, paced).
2. Store new articles in blog_articles: metadata + <= 50-word excerpt for every source, plus the
   sanitised full text for sources whose licence allows republication (sources.py).
3. If at least --min-items articles are not cited yet, publish one templated roundup post with
   related jobs. No LLM is involved anywhere.

Writes `new_articles=true` and/or `published=true` (+ `slug=`) to $GITHUB_OUTPUT so the workflow
triggers a rebuild of the static site only when there is something new.
"""

import argparse
import logging
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

from job_crawler.blog import db as blog_db
from job_crawler.blog.feeds import Article, Robots, fetch
from job_crawler.blog.roundup import build, select_articles
from job_crawler.blog.sources import SOURCES, SOURCES_BY_KEY
from job_crawler.http import HttpClient

log = logging.getLogger("job_crawler.blog")

REPO_ROOT = Path(__file__).resolve().parents[5]
ROUNDUP_WINDOW = timedelta(days=7)  # uncited articles older than this are never featured
RELATED_JOBS_WINDOW = timedelta(days=14)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="job_crawler.blog", description="Fetch hiring/career feeds and publish a roundup"
    )
    parser.add_argument(
        "--source", action="append", choices=sorted(SOURCES_BY_KEY), help="only these feeds"
    )
    parser.add_argument("--dry-run", action="store_true", help="fetch and count, no DB writes")
    parser.add_argument("--no-roundup", action="store_true", help="store articles only")
    parser.add_argument("--min-items", type=int, default=5, help="min articles for a roundup")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def set_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        for key, value in values.items():
            fh.write(f"{key}={value}\n")


def fetch_all(keys: list[str]) -> tuple[list[Article], int]:
    """Fetch the given feeds. Returns (articles, number of feeds that failed)."""
    articles: list[Article] = []
    failed = 0
    with HttpClient(timeout=20.0, retries=2, board_delay=1.5) as http:
        robots = Robots(http)
        for i, key in enumerate(keys):
            if i:
                http.pause()
            result = fetch(http, robots, SOURCES_BY_KEY[key])
            if result.error:
                failed += 1
                print(f"{key}: FAILED ({result.error})")
                continue
            full = sum(a.republish_mode == "full" for a in result.articles)
            print(f"{key}: {len(result.articles)} items ({full} full text)")
            articles.extend(result.articles)
    return articles, failed


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    keys = args.source or [s.key for s in SOURCES]
    now = datetime.now(UTC)

    conn = None
    if not args.dry_run:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            log.error("DATABASE_URL is not set (use --dry-run to fetch without a database)")
            return 2
        from job_crawler import db

        conn = db.connect(database_url)

    articles, failed = fetch_all(keys)
    print(f"total: {len(articles)} items from {len(keys) - failed}/{len(keys)} feeds")

    if conn is None:
        if not args.no_roundup:
            picked = select_articles(articles, min_items=args.min_items)
            if picked:
                post = build(picked, now=now)
                print(
                    f"roundup preview: {post.title!r}, {len(picked)} articles, topics {post.topics}"
                )
            else:
                print(f"roundup preview: fewer than {args.min_items} articles, no post")
        return 1 if failed == len(keys) else 0

    try:
        if not blog_db.tables_exist(conn):
            log.error("blog tables missing: apply db/migrations/021_blog.sql (pnpm db:migrate)")
            return 2
        new = blog_db.insert_articles(conn, articles)
        log.info("stored %d new articles", new)
        if new:
            set_output(new_articles="true")
        if not args.no_roundup:
            publish_roundup(conn, now, args.min_items)
    finally:
        conn.close()
    return 1 if failed == len(keys) else 0


def publish_roundup(conn, now: datetime, min_items: int) -> None:
    candidates = blog_db.unassigned_articles(conn, now - ROUNDUP_WINDOW)
    picked = select_articles([a for _, a in candidates], min_items=min_items)
    if not picked:
        log.info(
            "%d uncited articles: fewer than %d usable, no roundup today",
            len(candidates),
            min_items,
        )
        return
    ids = {a.url: article_id for article_id, a in candidates}
    post = build(picked, now=now)
    base = post.slug
    suffix = 2
    while blog_db.slug_taken(conn, post.slug):
        post.slug = f"{base}-{suffix}"
        suffix += 1
    post.related_jobs = blog_db.related_jobs(conn, post.topics, now - RELATED_JOBS_WINDOW)
    post_id = blog_db.insert_post(conn, post, ids)
    log.info("published post %d %s (%d articles)", post_id, post.slug, len(picked))
    set_output(published="true", slug=post.slug)


if __name__ == "__main__":
    sys.exit(main())
