"""Keyword search per saved search profile, on APIs that support it (Himalayas, Remotive).

The generic daily crawl only sees each source's latest jobs. This asks the APIs for the profile's
own keywords, so a niche search ("next.js") gets every matching job, and links what each search
returned to the profile (`profile_jobs`) like the session crawler does.
"""

import logging
from collections.abc import Callable

from job_crawler import db
from job_crawler.http import HttpClient
from job_crawler.models import JobRecord
from job_crawler.session.sites import SearchProfile, plain_keywords
from job_crawler.sources import himalayas, remotive

log = logging.getLogger(__name__)

HIMALAYAS_SEARCH_URL = "https://himalayas.app/jobs/api/search"
HIMALAYAS_MAX_PAGES = 5  # 20 jobs a page
REMOTIVE_MAX_PROFILES = 4  # Remotive asks for only a few calls a day


def himalayas_search(http: HttpClient, keywords: str) -> list[JobRecord]:
    jobs: list[JobRecord] = []
    for page in range(1, HIMALAYAS_MAX_PAGES + 1):
        if page > 1:
            http.pause()
        payload = http.get_json(HIMALAYAS_SEARCH_URL, params={"q": keywords, "page": page})
        found = himalayas.parse(payload)
        jobs.extend(found)
        if len(found) < himalayas.PAGE_SIZE or page * himalayas.PAGE_SIZE >= int(
            payload.get("totalCount") or 0
        ):
            break
    return jobs


SEARCHES: dict[str, Callable[[HttpClient, str], list[JobRecord]]] = {
    himalayas.SOURCE: himalayas_search,
    remotive.SOURCE: remotive.search,
}


def wanted(profile: SearchProfile, source: str) -> bool:
    return not profile.sources or source in profile.sources


def run(conn, http: HttpClient, profiles: list[SearchProfile], dry_run: bool = False) -> int:
    """Search every profile on every keyword API. Returns the number of failed searches."""
    failed = 0
    for source, search in SEARCHES.items():
        targets = [p for p in profiles if wanted(p, source)]
        if source == remotive.SOURCE:
            targets = targets[:REMOTIVE_MAX_PROFILES]
        if not targets:
            continue
        run_id = None if dry_run else db.start_run(conn, source)
        found_total, new_total, errors = 0, 0, []
        for profile in targets:
            keywords = plain_keywords(profile.keywords)
            try:
                jobs = search(http, keywords)
            except Exception as exc:  # noqa: BLE001 - one profile must not stop the others
                errors.append(f"{profile.id}: {type(exc).__name__}: {exc}")
                log.warning("%s search %r failed: %s", source, keywords, exc)
                continue
            found = len(db.dedupe(jobs))
            found_total += found
            log.info("%s search %r (profile %d): %d jobs", source, keywords, profile.id, found)
            if dry_run:
                print(f"{source} · {profile.name}: {found} jobs")
            else:
                new_total += db.upsert_jobs(conn, jobs)
                db.link_profile_jobs(conn, profile.id, jobs)
            http.pause()
        failed += len(errors)
        if run_id is not None:
            db.finish_run(
                conn,
                run_id,
                status="error" if errors and not found_total else "ok",
                jobs_found=found_total,
                jobs_new=new_total,
                error="; ".join(errors) or None,
            )
    return failed
