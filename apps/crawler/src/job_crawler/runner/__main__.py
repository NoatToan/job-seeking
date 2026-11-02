"""uv run python -m job_crawler.runner {pair,run,status,forget} ...

pair --api URL --code CODE [--name NAME]   pair this machine with a one-time code from /account
run [--headed] [--site ...] [--pages N]    fetch the plan, crawl, upload results
status                                     show pairing status (never prints the token)
forget                                     delete the local runner config (asks to confirm)

No `DATABASE_URL` is needed on this machine: everything goes through the API with a bearer
token. `job_crawler.session crawl` (the operator's own search-profile crawler) keeps working
separately; this CLI is for crawling one paired user account instead (docs/product/FLOW_V2.md,
ARCHITECTURE.md D8, adapted to flow v2: the plan is the account's keyword preferences).
"""

import argparse
import logging
import sys
from collections.abc import Iterable

from job_crawler.models import JobRecord
from job_crawler.runner.client import RunnerApiError, RunnerClient, RunnerOutdated, RunnerRevoked
from job_crawler.runner.config import (
    RunnerConfig,
    config_path,
    forget_config,
    load_config,
    save_config,
)
from job_crawler.session import __main__ as session_main
from job_crawler.session.sites import SITES, SearchProfile

log = logging.getLogger("job_crawler.runner")

MAX_JOBS_PER_UPLOAD = 200
DEFAULT_PAGES = 2


def _chunks(items: list, size: int) -> Iterable[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def pair(args: argparse.Namespace) -> int:
    name = args.name or "Companion runner"
    try:
        with RunnerClient(args.api) as client:
            result = client.pair(args.code, name)
    except RunnerApiError as exc:
        print(f"Pairing failed: {exc}", file=sys.stderr)
        return 1
    config = RunnerConfig(server=args.api, runner_id=str(result["runnerId"]), token=result["token"])
    path = save_config(config)
    print(
        f"Paired as runner {config.runner_id}. Config saved to {path} (token is never shown again)."
    )
    return 0


def status(args: argparse.Namespace) -> int:  # noqa: ARG001 - argparse Namespace, unused here
    config = load_config()
    if config is None:
        print(f"Not paired yet (no config at {config_path()}).")
        return 0
    print(f"Paired with {config.server} as runner {config.runner_id}.")
    return 0


def forget(args: argparse.Namespace) -> int:
    if not args.yes:
        confirm = input(f"Delete the local config at {config_path()}? [y/N] ")
        if confirm.strip().lower() not in ("y", "yes"):
            print("Cancelled.")
            return 1
    removed = forget_config()
    print("Config removed." if removed else "Nothing to remove.")
    return 0


def _crawl_site(
    site_id: str, profile: SearchProfile, pages: int, headless: bool
) -> list[JobRecord]:
    site = SITES[site_id]
    by_profile, error = session_main.crawl_site(site, [profile], pages, headless)
    if error:
        log.warning("%s: %s", site_id, error)
    return by_profile.get(profile.id, [])


def _as_payload(records: list[JobRecord]) -> list[dict]:
    # exclude=raw: never send cookies/HTML/page screenshots back to the server, only parsed fields.
    return [r.model_dump(mode="json", exclude={"raw"}) for r in records]


def run(args: argparse.Namespace) -> int:
    config = load_config()
    if config is None:
        print(
            f"Not paired yet. Run `pair --api URL --code CODE` first ({config_path()}).",
            file=sys.stderr,
        )
        return 2

    headless = not args.headed
    with RunnerClient(config.server, config.token) as client:
        try:
            plan_resp = client.plan()
        except RunnerRevoked:
            print("This runner was revoked. Pair again to get a new token.", file=sys.stderr)
            return 1
        except RunnerOutdated:
            print("This runner is too old; please upgrade.", file=sys.stderr)
            return 1

        sites = [s for s in (args.site or plan_resp.get("sites") or []) if s in SITES]
        keywords = " OR ".join(plan_resp.get("keywords") or [])
        profile = SearchProfile(
            id=0,
            name="account",
            keywords=keywords,
            locations=[],
            remote_only=bool(plan_resp.get("remoteOnly")),
            sources=sites,
        )

        total_found = total_uploaded = 0
        for site_id in sites:
            records = _crawl_site(site_id, profile, args.pages, headless)
            total_found += len(records)
            for chunk in _chunks(_as_payload(records), MAX_JOBS_PER_UPLOAD):
                try:
                    result = client.upload_jobs(site_id, chunk)
                except RunnerRevoked:
                    print("This runner was revoked.", file=sys.stderr)
                    return 1
                except RunnerOutdated:
                    print("This runner is too old; please upgrade.", file=sys.stderr)
                    return 1
                except RunnerApiError as exc:
                    print(f"{site_id}: upload failed: {exc}", file=sys.stderr)
                    continue
                total_uploaded += int(result.get("upserted", 0))
            log.info("%s: %d jobs found", site_id, len(records))

    print(f"Done. {total_found} jobs found, {total_uploaded} new.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="job_crawler.runner",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_pair = sub.add_parser("pair", help="pair this machine with a one-time code")
    p_pair.add_argument("--api", required=True, help="API server URL, e.g. https://host")
    p_pair.add_argument("--code", required=True, help="pairing code shown on /account")
    p_pair.add_argument("--name", default=None, help="label shown in the web app")

    p_run = sub.add_parser("run", help="crawl the account's keyword preferences and upload results")
    p_run.add_argument("--headed", action="store_true", help="show the browser window")
    p_run.add_argument("--site", action="append", choices=sorted(SITES))
    p_run.add_argument("--pages", type=int, default=DEFAULT_PAGES)

    sub.add_parser("status", help="show pairing status")
    p_forget = sub.add_parser("forget", help="delete the local runner config")
    p_forget.add_argument("-y", "--yes", action="store_true", help="skip the confirmation prompt")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    if args.command == "pair":
        return pair(args)
    if args.command == "status":
        return status(args)
    if args.command == "forget":
        return forget(args)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
