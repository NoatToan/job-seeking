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

## Analytics

- Google Tag Manager container `GTM-WSR78ZW4` loads on every page (`apps/web/src/app/layout.tsx`). Set `NEXT_PUBLIC_GTM_ID` at build time to use another container, or to an empty string to turn it off (e.g. local dev).
- GA4 is configured inside GTM, not in code: add a *Google tag* with the GA4 measurement ID, triggered on *Initialization – All Pages*. The app is a SPA, so keep GA4 *Enhanced measurement → Page changes based on browser history events* on to count client-side navigation.
- A tag that loads from a host other than Google Tag Manager / Google Analytics must also be added to the CSP in `vercel.json` and `deploy/Caddyfile`.

## MCP servers (Claude Code)

`.mcp.json` registers `job-search` (this repo's `apps/mcp`), `jobspy`, `upwork`, and two Google Cloud servers:
- `gcloud` ([@google-cloud/gcloud-mcp](https://github.com/googleapis/gcloud-mcp)): runs `gcloud` commands.
- `google-analytics` ([analytics-mcp](https://github.com/googleanalytics/google-analytics-mcp)): GA4 reports and realtime data.

Both sign in with your own Google account on your machine; nothing is stored in the repo. One-time setup with the Google Cloud CLI installed:

```bash
gcloud auth login                         # the Google account that owns the GCP project / GA4 property
gcloud config set project <project-id>
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
gcloud services enable analyticsadmin.googleapis.com analyticsdata.googleapis.com
```

Then restart Claude Code and approve the servers in `/mcp`.

## URL state and SEO (web)

- Every query on a page lives in the URL via [nuqs](https://nuqs.dev) (`apps/web/src/lib/url-state.ts`): home filters `?q=&source=&country=&remote=&tech=&posted=&hours=9-17&view=all|matches`, live search `?q=&off=`, job page `?id=`, sign-in `?next=`. Links are shareable and Back restores them; updates replace the history entry instead of pushing one per keystroke.
- SEO: per-page titles (`%s · JobSeeking`), description, Open Graph/Twitter card with a build-time preview image (`opengraph-image.tsx`), `robots.txt` and `sitemap.xml` (signed-in pages are `noindex` and disallowed), schema.org `WebSite` + `SearchAction` on `/` and `JobPosting` on job pages. `NEXT_PUBLIC_SITE_URL` sets the canonical domain (default: the Vercel URL).

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
