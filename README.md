# unified-job-crawler

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
