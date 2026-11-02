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

## LinkedIn / Arc / Glassdoor (personal session crawler)

These sites have no open API, so they are crawled with stock Playwright Chromium in **your own
browser profile, on your machine**. We Work Remotely is not here: its official RSS feeds are already
crawled every day by the main crawler. SEEK is not here either: its public JSON search API needs no
browser and isn't behind Cloudflare, so it is fetched directly (see "Per-profile keyword search"
below).

```bash
uv sync --extra browser && uv run playwright install chromium
uv run python -m job_crawler.session check --location "Sydney NSW"  # 1 page per site, logged out: reachable?
uv run python -m job_crawler.session login linkedin                  # log in by hand once, close the window
uv run python -m job_crawler.session crawl --pages 2                 # every search profile from the web app
uv run python -m job_crawler.session crawl --headless --site arc     # unattended: stops at any check
```

- **No CAPTCHA bypass.** CloakBrowser (a fingerprint-patched Chromium) was tried in a POC and then
  removed on purpose. Glassdoor shows a Cloudflare check: a headed run waits up to 5 minutes for you
  to pass it in the window, and a headless run stops that site and records why in `crawl_runs`.
- The login stays in a local browser profile (`~/.unified-job-crawler/<site>`, override with
  `UJC_BROWSER_PROFILES`). Cookies never go to the server or the database.
- Jobs a site's search returns are linked to the search profile (`profile_jobs`), so they show on
  the profile page even when the card has no description to full-text match.
- At most 5 result pages per search (Glassdoor 1), slow randomised pacing, no proxies.
- These sites forbid automated access in their terms: keep it personal and low-volume, and expect
  that your account could be restricted.

## Per-profile keyword search (SEEK, Himalayas, Remotive)

`uv run python -m job_crawler --profiles` asks SEEK's public JSON search API
(`job_crawler.sources.seek`, one page per profile per run), Himalayas' search API and Remotive for
each search profile's keywords, and links the results to the profile (only jobs that contain every
keyword). Remotive is capped at 4 profiles per run (they ask for few calls a day). The daily
workflow runs with `--profiles`.

`job_crawler.sources.seek` is also imported by `apps/mcp` (as a path dependency, so Claude's
`search_seek` tool reuses the same parser) and by `apps/api`'s live search.

## Who may apply (open_to)

`eligibility.py` turns location text ("USA Only", "Remote (US, CA)", "Worldwide", "APAC") and
structured country lists into `jobs.open_to`. A profile with "I'm based in: Vietnam" hides remote
jobs that clearly exclude Vietnam. After changing the rules: `uv run python -m job_crawler --recompute-open-to`.

## CV matching (Claude)

```bash
uv run python -m job_crawler.matching --profile 7 --cv ~/cv.pdf --limit 24 \
  --preferences "remote open to Vietnam, or relocation with visa"
```

Reads the CV (PDF text layer, or Claude OCR for scans/images; TXT/MD as is), extracts a profile
with Claude, prefilters the profile's jobs by keywords, and asks Claude to score the best ones
(0-100, reasons in Vietnamese). Results are stored in `cvs` / `cv_matches` and the profile page
sorts by score. The CV text is personal data: it is deleted with its search profile. Ported from
the jobflow POC (`poc_job_crawler`).

### LLM provider (`job_crawler.matching.provider`)

`UJC_LLM_PROVIDER` picks how matching calls Claude:

- `claude_cli` (default): the local `claude -p` CLI, your own Claude subscription, no API key;
  set `UJC_CLAUDE_MODEL` to change the model.
- `anthropic`: the official `anthropic` SDK directly (server-side, no Claude Code login needed).
  `uv sync --extra api` to install it. Reads `ANTHROPIC_API_KEY` from the environment (never
  logged) and `UJC_ANTHROPIC_MODEL` for the model (default `claude-sonnet-5`); structured output
  is a single forced tool call, so results come back as a validated dict with no JSON-in-text
  parsing; PDFs/images passed as `files` go as base64 `document`/`image` blocks.
- `fake`: deterministic, no network — what every test uses.

## Upwork (`job_crawler.sources.upwork`, M3-03)

A GraphQL client library against `https://api.upwork.com/graphql`, deliberately **not**
registered in `SOURCES` — Upwork's API & MCP Terms forbid continuous monitoring, so it is only
ever called from a user-directed search (M3-04), never a daily crawl. See the module docstring
and `docs/product/ARCHITECTURE.md` §7 for the Terms constraints this is built around. No API key
is needed yet: `tests/test_upwork.py` runs entirely against recorded, hand-written fixture JSON
(`tests/fixtures/upwork_search.json`, `upwork_errors.json`) — field/enum names are unverified
against the live schema until the key application is approved.
