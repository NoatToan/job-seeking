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

## LinkedIn / Seek (personal session crawler)

These sites have no open API, so they are crawled in **your own logged-in browser, on your machine**.
The default engine is [CloakBrowser](https://github.com/CloakHQ/CloakBrowser), a Chromium build with
fingerprint patches so Cloudflare and other bot checks see a normal browser. `--engine chromium` uses
stock Playwright.

```bash
uv sync --extra browser && uv run playwright install chromium   # cloak downloads its own binary on first run
uv run python -m job_crawler.session poc --location "Sydney NSW"  # compare engines, logged out, 1 page per site
uv run python -m job_crawler.session login linkedin              # log in by hand once, close the window
uv run python -m job_crawler.session login seek
uv run python -m job_crawler.session crawl --pages 2             # every search profile from the web app
uv run python -m job_crawler.session crawl --headless            # unattended: stops instead of waiting at a check
```

- The login stays in a local browser profile (`~/.unified-job-crawler/<engine>/<site>`, override with
  `UJC_BROWSER_PROFILES`). Cookies never go to the server or the database.
- Jobs a site's search returns are linked to the search profile (`profile_jobs`), so they show on
  the profile page even when the card has no description to full-text match.
- At most 5 result pages per search, slow randomised pacing, no proxies. CloakBrowser does not
  solve CAPTCHAs. If a login wall or CAPTCHA still appears, a headed run waits for you to handle it,
  and a headless run stops that site.
- Both sites forbid automated access in their terms: keep it personal and low-volume, and expect
  that your account could be restricted.
