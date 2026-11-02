# apps/api — ujc_api

FastAPI backend for the Unified Job Crawler. Plain SQL with `psycopg` (no ORM), a Postgres-backed
task queue, and no in-process dependency on `apps/web`. See `docs/product/FLOW_V2.md` for the
full contract this implements (email OTP auth, CV upload + host worker, cursor feed, live
search).

## Setup

```bash
cd apps/api
uv sync
```

This also installs `job_crawler` (from `../crawler`) and `job_search_mcp` (from `../mcp`) as
editable path dependencies, so the sources/eligibility/matching/live-search code is reused, not
duplicated.

## Run

```bash
uv run uvicorn ujc_api.main:app --reload --port 8000
```

Requires `DATABASE_URL` in the environment (or a repo-root `.env.local` in development — see
`.env.example`). `GET /api/health` is a plain liveness check; `GET /api/ready` also checks the
database and that every migration has been applied. OpenAPI docs (`/api/docs`,
`/api/openapi.json`) are served unless `UJC_ENV=production`.

## Environment variables

| Name | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (database `job_unified_matching`) |
| `UJC_ENV` | no (default `development`) | `development` \| `test` \| `production`. Governs `.env.local` loading, cookie `Secure`, and `UJC_SECRET_KEY` enforcement |
| `UJC_SECRET_KEY` | **required outside `development`/`test`** | HMAC key for OTP code hashes and the CSRF token. In `development`/`test` a fixed insecure default is used (with a logged warning) if unset; outside those, startup fails without a real value |
| `UJC_OTP_REVIEW_MODE` | no (default `false`) | `true` returns the OTP code as `devCode` in `POST /api/auth/otp`'s response instead of emailing it. Only for an access-protected preview deployment, never production |
| `UJC_OTP_REVIEW_ALLOWLIST` | no (default empty) | Comma-separated emails (case-insensitive). When review mode is on **and** this is non-empty, only these addresses get `devCode`; every other email is sent via Resend if `RESEND_API_KEY` is set, or rejected with `403 not_invited`. Leave empty only for a non-public preview — set this before exposing a review build publicly |
| `RESEND_API_KEY` | no | [Resend](https://resend.com) API key. When set, OTP and daily-digest emails are sent for real via Resend's HTTP API (takes priority over review mode, except for allowlisted addresses — see above). Without it, `ujc_api.digest` logs "would send" and never actually emails |
| `UJC_MAIL_FROM` | no (default `Job Seeking <onboarding@resend.dev>`) | `From` address for OTP and digest emails sent via Resend |
| `UJC_PUBLIC_URL` | no (default `http://localhost:3000`) | Absolute origin used in digest email links (see more / change settings / unsubscribe), since those are read outside a browser tab. No trailing slash |
| `UJC_CLAUDE_MODEL`, `UJC_CLAUDE_BIN`, `UJC_CLAUDE_TIMEOUT_S` | no | Read directly by `job_crawler.matching.claude` (the host worker's `claude -p` wrapper); see that module for defaults |

## API endpoints

All responses are JSON; errors are `{error:{code,message,fields?}}`. See
`docs/product/FLOW_V2.md` §4 for full request/response shapes.

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/auth/otp` | – | Sends (or, in review mode, returns) a 6-digit code. Rate-limited per email and IP |
| `POST /api/auth/verify` | – | `{email, code}` -> `{user}` + `Set-Cookie: ujc_session`, `ujc_csrf` |
| `POST /api/auth/logout` | session + CSRF | Clears cookies and the session row |
| `GET /api/me` | session | User, preferences, latest CV |
| `PUT /api/me/preferences` | session + CSRF | Keywords (≤30, ≤40 chars each), remote-only, candidate country, digest enabled/hour/timezone |
| `POST /api/cvs` | session + CSRF | multipart `file` (pdf/png/jpg/jpeg/webp/gif/txt/md, ≤5 MB) -> `202` queued |
| `GET /api/cvs` / `GET /api/cvs/{id}` | session | Owner-scoped (404 otherwise) |
| `DELETE /api/cvs/{id}` | session + CSRF | Owner-scoped |
| `GET /api/feed` | session | Keyset-paginated jobs matching the user's keywords (or newest, if none), filtered by remote-only/eligibility |
| `GET /api/search/live` | session | Live query across seek/himalayas/remotive/wwr/arc, merged, de-duplicated, upserted into `jobs` |
| `GET /api/digest/unsubscribe?u=&t=` | – (stateless token) | One-click digest unsubscribe; `400 invalid_token` if `t` doesn't verify |

CSRF: double-submit — send header `X-CSRF-Token` equal to the readable `ujc_csrf` cookie on
every `POST`/`PUT`/`PATCH`/`DELETE` to a session-authenticated route (the SPA's API client does
this automatically). `/api/auth/otp` and `/api/auth/verify` are exempt (no session yet).

## Migrate

```bash
uv run python -m ujc_api.migrate
```

Applies every `db/migrations/*.sql` file not yet recorded in `schema_migrations`, in name order,
one transaction each. Uses the same table as `scripts/migrate.mjs`, so either runner can be used
against a given database without repeating the other's work.

## Host worker (CV scanning)

CV uploads only get a `cv_extract` task queued; a separate, long-running **host worker** process
actually scans them, because it runs `claude -p` (the owner's Claude Code CLI login, not an API
key) — see `docs/product/FLOW_V2.md` §2 "Topology". Run it on any machine that has the `claude`
CLI installed and logged in (your Mac is fine — it does **not** need to be the machine serving
the API):

```bash
cd apps/api
uv sync                      # once
export DATABASE_URL=postgresql://...   # the same shared Postgres the API uses
uv run python -m ujc_api.worker
```

- It only needs `DATABASE_URL` (plus optionally `UJC_CLAUDE_MODEL`/`UJC_CLAUDE_BIN` to pick a
  different model or `claude` binary) — no inbound port, no tunnel, no secret beyond the DB URL.
- Polls the `tasks` table (`--poll SECONDS`, default 3) and claims one task at a time
  (`FOR UPDATE SKIP LOCKED`), so you can safely run more than one worker.
- `--once`: process at most one task then exit (useful for a cron job instead of a long-running
  process, or for manually draining the queue).
- If it's offline, uploaded CVs simply stay `queued` and the SPA shows "waiting for the scanner".
- On failure it retries with backoff (`2^attempts` minutes) and gives up after 3 attempts,
  marking both the task and the CV `error` with a short message.

### Keep it running (macOS)

To make it survive logouts, reboots and crashes, install it as a per-user launchd agent from a
stable checkout (not a temporary worktree). The repo-root `.env.local` must hold `DATABASE_URL`.

```bash
apps/api/scripts/worker-service.sh install    # starts now and at every login, restarts on exit
apps/api/scripts/worker-service.sh status     # state, pid, last log lines
apps/api/scripts/worker-service.sh uninstall
```

Logs go to `~/Library/Logs/job-seeking/worker.log`. On Linux, run the same command
(`uv run python -m ujc_api.worker`) as a systemd user service with `Restart=always`.

## Daily digest (M4-08)

`ujc_api.digest` sends each user at most one email per local day, once their `digest_hour`
(local to their `digest_tz`) has passed: new jobs since their last digest that match their feed
keywords/remote/eligibility filters (same rule as `GET /api/feed`), ranked by match score when
they have one, capped at 10, Upwork always excluded.

```bash
uv run python -m ujc_api.digest run             # send to every due user
uv run python -m ujc_api.digest run --dry-run   # log who/how many, send nothing, save nothing
uv run python -m ujc_api.digest run --user person@example.com   # only this user (still gated by their digest hour)
```

Run it **hourly** (`digest_hour` is a user-local hour, not a minute, so hourly is enough
precision) — `.github/workflows/digest.yml` does this in CI (needs the `DATABASE_URL` and
`UJC_SECRET_KEY` repo secrets, `RESEND_API_KEY` optional; the workflow skips gracefully if the
required secrets aren't set). To run it elsewhere instead: a `cron` entry
(`0 * * * * cd apps/api && uv run python -m ujc_api.digest run`) or a launchd/systemd timer next
to the host worker.

Unsubscribe is stateless — `GET /api/digest/unsubscribe?u={id}&t={token}` where `token` is
`HMAC(UJC_SECRET_KEY, "{id}|digest")` — so there's no token table, and the link in every digest
email's `List-Unsubscribe` header works without a session.

## Test

```bash
uv run pytest
```

Tests that do not need a database — settings, health, error-format, request-id/access-log
middleware, migration ordering against a fake connection, cursor encode/decode, OTP hash/verify
logic (against an in-memory fake, `tests/fakes.py`), CSRF, CV upload validation, live-search
merging (monkeypatched source adapters), and worker task processing (fake extractor + fake
repo) — always run. Tests that need a real database (otp → verify → `/api/me`, CV upload →
task, worker → `done`, feed pagination with no duplicates, owner-scoping) read
`TEST_DATABASE_URL` and are **skipped with a clear message** if it is unset:

```bash
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/ujc_test
uv run pytest
```

Each test session creates a throwaway Postgres schema, applies every migration into it, and drops
it afterwards — the real `public` schema is never touched.

## Lint

```bash
uv run ruff check .
uv run ruff format --check .
```
