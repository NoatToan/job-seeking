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

These sites have no open API, so they are crawled in **your own logged-in browser, on your machine**:

```bash
uv sync --extra browser && uv run playwright install chromium
uv run python -m job_crawler.session login linkedin    # log in by hand once, close the window
uv run python -m job_crawler.session login seek
uv run python -m job_crawler.session crawl --pages 2   # crawls every search profile from the web app
```

- The login stays in a local browser profile (`~/.unified-job-crawler/<site>`, override with
  `UJC_BROWSER_PROFILES`). Cookies never go to the server or the database.
- It reads at most 5 result pages per search, slowly. When a login wall, Cloudflare check or
  CAPTCHA appears, it pauses and waits for you to solve it in the window. It does not solve or
  bypass CAPTCHAs.
- Both sites forbid automated access in their terms: keep it personal and low-volume, and expect
  that your account could be restricted.
