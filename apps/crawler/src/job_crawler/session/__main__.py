"""uv run python -m job_crawler.session {login,crawl,poc} [--engine cloak|chromium] ...

login linkedin|seek        open a visible browser; log in by hand, then close the window
crawl [--site ...] [--profile ID ...] [--pages N] [--dry-run]
                           crawl the saved search profiles with the logged-in session
poc [--keywords K] [--location L] [--headed]
                           load one search page per site with each engine and compare
"""

import argparse
import logging
import os
import random
import sys
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

from job_crawler import db
from job_crawler.cli import REPO_ROOT
from job_crawler.models import JobRecord
from job_crawler.session.engine import ENGINES, open_context, profile_dir
from job_crawler.session.sites import SITES, SearchProfile, Site, is_blocked

log = logging.getLogger("job_crawler.session")

MAX_PAGES = 5
BLOCK_WAIT_SECONDS = 300


def _launch(site: Site, engine: str, headless: bool = False):
    """Browser with this site's own persistent profile (where the user's login lives)."""
    return open_context(engine, profile_dir(engine, site.id), headless=headless)


def login(site: Site, engine: str) -> int:
    context = _launch(site, engine)
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(site.login_url)
    print(f"Log in to {site.id} in the browser window, then close the window.")
    try:
        page.wait_for_event("close", timeout=0)
    finally:
        context.close()
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


def _wait_for_results(site: Site, page, timeout_ms: int = 15_000) -> None:
    """Redirects and client rendering finish after DOMContentLoaded: wait for the result list."""
    try:
        page.wait_for_selector(site.result_selector, timeout=timeout_ms)
    except Exception:  # noqa: BLE001 - no results (or a new layout): parse what is there
        log.warning("%s: result list not found at %s", site.id, page.url.split("?")[0])


def _scroll_results(page) -> None:
    """LinkedIn renders cards lazily: scroll the result list like a reader would."""
    for _ in range(8):
        page.mouse.wheel(0, 900)
        page.wait_for_timeout(random.uniform(400, 900))


def crawl_site(
    site: Site, profiles: list[SearchProfile], pages: int, engine: str, headless: bool = False
) -> tuple[dict[int, list[JobRecord]], str | None]:
    """Jobs found per search profile id, plus an error if the run stopped early."""
    context = _launch(site, engine, headless)
    page = context.pages[0] if context.pages else context.new_page()
    jobs: dict[int, list[JobRecord]] = {}
    error = None
    try:
        for profile in profiles:
            for location in profile.locations or [None]:
                for n in range(pages):
                    url = site.search_url(profile, location, n)
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_timeout(random.uniform(2500, 4500))
                    if _blocked(site, page):
                        where = page.url.split("?")[0]
                        if headless:
                            log.warning("%s: login/security check at %s (headless)", site.id, where)
                            hint = (
                                f"run `login {site.id}` once"
                                if "login" in where or "authwall" in where
                                else "run without --headless"
                            )
                            return jobs, f"stopped at {where}: {hint}"
                        if not _wait_for_user(site, page):
                            return jobs, f"stopped at {where}: check not resolved"
                        page.goto(url, wait_until="domcontentloaded")
                        page.wait_for_timeout(3000)
                    _wait_for_results(site, page)
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
                    jobs.setdefault(profile.id, []).extend(found)
                    if not found:
                        break
                    time.sleep(random.uniform(5, 12))  # slow, human pace between pages
    except Exception as exc:  # noqa: BLE001 - keep what we already have
        error = f"{type(exc).__name__}: {exc}"
        log.error("%s: %s", site.id, error)
    finally:
        context.close()
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
            by_profile, error = crawl_site(site, profiles, args.pages, args.engine, args.headless)
            jobs = [j for found_jobs in by_profile.values() for j in found_jobs]
            found = len(db.dedupe(jobs))
            if args.dry_run:
                print(f"{site.id}: {found} jobs" + (f" ({error})" if error else ""))
                continue
            new = db.upsert_jobs(conn, jobs)
            for profile_id, found_jobs in by_profile.items():
                db.link_profile_jobs(conn, profile_id, found_jobs)
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


def poc(args: argparse.Namespace) -> int:
    """One search page per site, per engine, in a throwaway profile (logged out): blocked or not?"""
    profile = SearchProfile(
        id=0, name="poc", keywords=args.keywords, locations=[], remote_only=False, sources=[]
    )
    rows = []
    for engine in args.engines or list(ENGINES):
        for site_id in args.site or list(SITES):
            site = SITES[site_id]
            url = site.search_url(profile, args.location, 0)
            started = time.monotonic()
            row = {"engine": engine, "site": site.id, "blocked": None, "jobs": 0, "title": ""}
            with tempfile.TemporaryDirectory(prefix="ujc-poc-") as tmp:
                try:
                    context = open_context(engine, Path(tmp), headless=not args.headed)
                    try:
                        page = context.pages[0] if context.pages else context.new_page()
                        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                        # give a non-interactive challenge time to resolve by itself
                        for _ in range(6):
                            page.wait_for_timeout(2500)
                            if not _blocked(site, page):
                                break
                        row["blocked"] = _blocked(site, page)
                        if not row["blocked"]:
                            _wait_for_results(site, page)
                            _scroll_results(page)
                            row["jobs"] = len(site.parse(page.content()))
                        row["title"] = page.title()[:60]
                        row["url"] = page.url.split("?")[0]
                    finally:
                        context.close()
                except Exception as exc:  # noqa: BLE001 - report and continue
                    row["title"] = f"error: {type(exc).__name__}: {exc}"[:80]
            row["seconds"] = round(time.monotonic() - started, 1)
            rows.append(row)
            log.info("poc %s", row)
            time.sleep(random.uniform(3, 6))

    print(f"\n{'engine':<9} {'site':<9} {'blocked':<8} {'jobs':>5} {'sec':>5}  page title")
    for r in rows:
        blocked = "error" if r["blocked"] is None else ("yes" if r["blocked"] else "no")
        print(
            f"{r['engine']:<9} {r['site']:<9} {blocked:<8} {r['jobs']:>5} {r['seconds']:>5}"
            f"  {r['title']}"
        )
    return 0


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
    p_crawl.add_argument(
        "--headless",
        action="store_true",
        help="no window (unattended runs; a CAPTCHA then stops the site instead of waiting)",
    )
    p_poc = sub.add_parser("poc", help="compare engines on one search page per site")
    p_poc.add_argument("--site", action="append", choices=sorted(SITES))
    p_poc.add_argument("--engine", dest="engines", action="append", choices=ENGINES)
    p_poc.add_argument("--keywords", default="react developer")
    p_poc.add_argument("--location", default=None)
    p_poc.add_argument("--headed", action="store_true", help="show the browser windows")
    for p in (p_login, p_crawl):
        p.add_argument("--engine", choices=ENGINES, default="cloak", help="browser engine")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    if args.command == "login":
        return login(SITES[args.site], args.engine)
    if args.command == "poc":
        return poc(args)
    args.pages = max(1, min(args.pages, MAX_PAGES))
    return crawl(args)


if __name__ == "__main__":
    sys.exit(main())
