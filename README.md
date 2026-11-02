# unified-job-crawler

[![CI](https://github.com/NoatToan/job-seeking/actions/workflows/ci.yml/badge.svg)](https://github.com/NoatToan/job-seeking/actions/workflows/ci.yml)

Job aggregator: crawls jobs every day from open feeds and public company job boards, shows the source of every job, and (next milestones) matches them to each user's CVs and helps them apply.

Sources:
- **Daily, server-side (GitHub Actions):** We Work Remotely RSS, Greenhouse / Lever / Ashby public board APIs, Himalayas, Adzuna (optional key).
- **Personal session crawler (user's machine):** LinkedIn, Seek, Arc and Glassdoor, in the user's own browser profile. See `apps/crawler/README.md`. These sites forbid automated access, so it stays personal and slow, has no CAPTCHA bypass, and stops for the user at any check.
- **Deep links only:** YC Work at a Startup.

**CV matching:** `python -m job_crawler.matching --profile ID --cv cv.pdf` reads a CV, and Claude (local `claude -p` CLI) scores the profile's jobs 0-100 with reasons; the profile page sorts by score. See `apps/crawler/README.md`.

**Search profiles** (`/profiles`) hold what a user is looking for (keywords in web-search syntax, locations, remote, sources). Jobs are mapped to a profile with Postgres full-text search (a weighted `tsvector` plus a GIN index), ranked by relevance, and every job shows its source badge. Elasticsearch isn't needed at this scale (thousands up to a few million jobs). Revisit it only if we need fuzzy/typo search or heavy faceting over many millions of rows.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router) web app, deployed to Vercel |
| `apps/crawler` | Python crawler (uv, httpx, Playwright optional), run daily by GitHub Actions |
| `apps/mcp` | MCP server for Claude Code: live job search on SEEK, We Work Remotely, Arc (plus `jobspy` for LinkedIn/Glassdoor via `.mcp.json`) |
| `packages/core` | Shared TypeScript types + source registry (`SOURCES`) |
| `packages/ui` | Shared React components (`JobCard`, `SourceBadge`), to be reused by the Expo app |
| `db/migrations` | SQL migrations, the single schema for web and crawler |
| `scripts/migrate.mjs` | Applies migrations (also runs in the Vercel build) |

## Database

The project uses the team's shared Postgres instance, database `job_unified_matching` (role `job_unified_matching_app`). `DATABASE_URL` is set in Vercel (production, preview, development). Locally it is in `.env.local`.

## Develop

```bash
pnpm install
cp .env.example .env.local   # or: vercel env pull .env.local
pnpm db:migrate
pnpm dev                     # http://localhost:3000

cd apps/crawler
uv sync
uv run python -m job_crawler --dry-run   # fetch only, no DB writes
uv run python -m job_crawler             # crawl all sources into Postgres
```

## Deploy

- Web: Vercel project `unified-job-crawler`. `vercel.json` points the build at `apps/web`, and the build runs the migrations first.
- Daily crawl: `.github/workflows/daily-crawl.yml` (05:00 Vietnam time). Set the repository secrets `DATABASE_URL` (and optionally `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`).

## CI

`.github/workflows/ci.yml` runs on every pull request and on push to `main`:
- `web`: install (`pnpm install --frozen-lockfile`), `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, and `pnpm --filter web build` (static export).
- `python`: for each of `apps/api`, `apps/crawler`, `apps/mcp`, `uv sync`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`.
- `api-db`: runs `apps/api`'s database-backed tests against a `postgres:17` service, then applies every migration from scratch with `node scripts/migrate.mjs` to prove they apply cleanly.

A PR must pass all three jobs before merging.

## Add a company board

```sql
INSERT INTO company_boards (ats, slug, company_name) VALUES ('greenhouse', '<slug>', '<Company>');
```
