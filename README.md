# unified-job-crawler

Job aggregator: crawls jobs every day from open feeds and public company job boards, shows the source of every job, and (next milestones) matches them to each user's CVs and helps them apply.

Milestone 1 (this step) only uses sources that allow programmatic access: We Work Remotely RSS, Greenhouse / Lever / Ashby public board APIs, Himalayas, and Adzuna (optional, needs a key). LinkedIn, Seek, Glassdoor, Arc and YC Work at a Startup only appear as deep links to their own search, because their terms forbid scraping (see the research report in the Slack thread).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router) web app, deployed to Vercel |
| `apps/crawler` | Python crawler (uv, httpx, Playwright optional), run daily by GitHub Actions |
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

## Add a company board

```sql
INSERT INTO company_boards (ats, slug, company_name) VALUES ('greenhouse', '<slug>', '<Company>');
```
