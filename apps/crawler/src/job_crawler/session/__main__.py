"""uv run python -m job_crawler.session {login,crawl} ...

login linkedin|seek        open a visible browser; log in by hand, then close the window
crawl [--site ...] [--profile ID ...] [--pages N] [--dry-run]
                           crawl the saved search profiles with the logged-in session
"""

import argparse
import logging
import os
import random
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

from job_crawler import db
from job_crawler.cli import REPO_ROOT
from job_crawler.models import JobRecord
from job_crawler.session.sites import SITES, SearchProfile, Site, is_blocked

log = logging.getLogger("job_crawler.session")

PROFILE_ROOT = Path(os.environ.get("UJC_BROWSER_PROFILES", Path.home() / ".unified-job-crawler"))
MAX_PAGES = 5
BLOCK_WAIT_SECONDS = 300


def _launch(site: Site):
    """Visible Chromium with this site's own persistent profile (where the user's login lives)."""
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    user_dir = PROFILE_ROOT / site.id
    user_dir.mkdir(parents=True, exist_ok=True)
    context = pw.chromium.launch_persistent_context(
        str(user_dir), headless=False, viewport={"width": 1280, "height": 900}
    )
    return pw, context


def login(site: Site) -> int:
    pw, context = _launch(site)
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(site.login_url)
    print(f"Log in to {site.id} in the browser window, then close the window.")
    try:
        page.wait_for_event("close", timeout=0)
    finally:
        context.close()
        pw.stop()
    print(f"Saved the {site.id} session in your local browser profile.")
    return 0


def _blocked(site: Site, page) -> bool:
    try:
        title = page.title()
    except Exception:  # noqa: BLE001 - page is navigating
        title = ""
    return is_blocked(site, page.url, title)


def _wait_for_user(site: Site, page) -> bool:
    """A login wall or CAPTCHA appeared: let the user handle it in the window, never bypass it."""
    print(
        f"\n{site.id}: login/security check at {page.url.split('?')[0]}\n"
        f"Solve it in the browser window (waiting up to {BLOCK_WAIT_SECONDS // 60} min)..."
    )
    deadline = time.monotonic() + BLOCK_WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(3)
        if not _blocked(site, page):
            return True
    return False


def _scroll_results(page) -> None:
    """LinkedIn renders cards lazily: scroll the result list like a reader would."""
    for _ in range(8):
        page.mouse.wheel(0, 900)
        page.wait_for_timeout(random.uniform(400, 900))


def crawl_site(
    site: Site, profiles: list[SearchProfile], pages: int
) -> tuple[list[JobRecord], str | None]:
    pw, context = _launch(site)
    page = context.pages[0] if context.pages else context.new_page()
    jobs: list[JobRecord] = []
    error = None
    try:
        for profile in profiles:
            for location in profile.locations or [None]:
                for n in range(pages):
                    url = site.search_url(profile, location, n)
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_timeout(random.uniform(2500, 4500))
                    if _blocked(site, page):
                        if not _wait_for_user(site, page):
                            return jobs, "stopped: login/security check not resolved"
                        page.goto(url, wait_until="domcontentloaded")
                        page.wait_for_timeout(3000)
                    _scroll_results(page)
                    found = site.parse(page.content())
                    log.info(
                        "%s · %s · %s · page %d: %d jobs",
                        site.id,
                        profile.name,
                        location or "any",
                        n + 1,
                        len(found),
                    )
                    jobs.extend(found)
                    if not found:
                        break
                    time.sleep(random.uniform(5, 12))  # slow, human pace between pages
    except Exception as exc:  # noqa: BLE001 - keep what we already have
        error = f"{type(exc).__name__}: {exc}"
        log.error("%s: %s", site.id, error)
    finally:
        context.close()
        pw.stop()
    return jobs, error


def crawl(args: argparse.Namespace) -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        log.error("DATABASE_URL is not set: search profiles live in the database")
        return 2
    conn = db.connect(database_url)
    try:
        all_profiles = db.load_search_profiles(conn, args.profile)
        if not all_profiles:
            log.error("no search profiles: create one in the web app (/profiles) first")
            return 2
        failed = False
        for site_id in args.site or list(SITES):
            site = SITES[site_id]
            profiles = [p for p in all_profiles if not p.sources or site.id in p.sources]
            if not profiles:
                continue
            run_id = None if args.dry_run else db.start_run(conn, site.id)
            jobs, error = crawl_site(site, profiles, args.pages)
            found = len(db.dedupe(jobs))
            if args.dry_run:
                print(f"{site.id}: {found} jobs" + (f" ({error})" if error else ""))
                continue
            new = db.upsert_jobs(conn, jobs)
            db.finish_run(
                conn,
                run_id,
                status="error" if error and not jobs else "ok",
                jobs_found=found,
                jobs_new=new,
                error=error,
            )
            log.info("%s: %d jobs, %d new", site.id, found, new)
            failed |= bool(error and not jobs)
        return 1 if failed else 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="job_crawler.session",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p_login = sub.add_parser("login", help="log in once in a visible browser")
    p_login.add_argument("site", choices=sorted(SITES))
    p_crawl = sub.add_parser("crawl", help="crawl saved search profiles with your session")
    p_crawl.add_argument("--site", action="append", choices=sorted(SITES))
    p_crawl.add_argument("--profile", action="append", type=int, help="search profile id")
    p_crawl.add_argument(
        "--pages", type=int, default=2, help=f"result pages per search (max {MAX_PAGES})"
    )
    p_crawl.add_argument("--dry-run", action="store_true", help="crawl but do not write jobs")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    if args.command == "login":
        return login(SITES[args.site])
    args.pages = max(1, min(args.pages, MAX_PAGES))
    return crawl(args)


if __name__ == "__main__":
    sys.exit(main())
