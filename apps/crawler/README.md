# job_crawler

Python crawler for unified-job-crawler. Fetches jobs into the `jobs` table and logs each run in `crawl_runs`.

```bash
uv sync
uv run python -m job_crawler --dry-run                 # fetch + count only
uv run python -m job_crawler                           # all API/feed sources -> Postgres
uv run python -m job_crawler --source weworkremotely   # one source
uv run pytest && uv run ruff check .
```

`DATABASE_URL` comes from the environment or the repo-root `.env.local`. Adzuna runs only when
`ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set.

## LinkedIn / Seek / Arc / Glassdoor (personal session crawler)

These sites have no open API, so they are crawled with stock Playwright Chromium in **your own
browser profile, on your machine**. We Work Remotely is not here: its official RSS feeds are already
crawled every day by the main crawler.

```bash
uv sync --extra browser && uv run playwright install chromium
uv run python -m job_crawler.session check --location "Sydney NSW"  # 1 page per site, logged out: reachable?
uv run python -m job_crawler.session login linkedin                  # log in by hand once, close the window
uv run python -m job_crawler.session crawl --pages 2                 # every search profile from the web app
uv run python -m job_crawler.session crawl --headless --site arc     # unattended: stops at any check
```

- **No CAPTCHA bypass.** CloakBrowser (a fingerprint-patched Chromium) was tried in a POC and then
  removed on purpose. Seek and Glassdoor show a Cloudflare check: a headed run waits up to 5 minutes
  for you to pass it in the window, and a headless run stops that site and records why in `crawl_runs`.
- The login stays in a local browser profile (`~/.unified-job-crawler/<site>`, override with
  `UJC_BROWSER_PROFILES`). Cookies never go to the server or the database.
- Jobs a site's search returns are linked to the search profile (`profile_jobs`), so they show on
  the profile page even when the card has no description to full-text match.
- At most 5 result pages per search (Glassdoor 1), slow randomised pacing, no proxies.
- These sites forbid automated access in their terms: keep it personal and low-volume, and expect
  that your account could be restricted.
