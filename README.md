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
- Daily rebuild of the static job pages: create a Vercel Deploy Hook for `main` (Project → Settings → Git → Deploy Hooks) and save its URL as the repository secret `VERCEL_DEPLOY_HOOK_URL`; the daily crawl calls it when it finishes.
- Daily blog: `.github/workflows/daily-blog.yml` (06:30 Vietnam time). Uses `DATABASE_URL`; optionally `VERCEL_DEPLOY_HOOK_URL` (a Vercel deploy hook for production) so new posts go live right away. See "Blog" below.

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
- SEO: per-page titles (`%s · JobSeeking`), description, Open Graph/Twitter card with a build-time preview image (`opengraph-image.tsx`), `robots.txt` and `sitemap.xml` (signed-in pages are `noindex` and disallowed), schema.org `WebSite` + `SearchAction` on `/`. `NEXT_PUBLIC_SITE_URL` sets the canonical domain (default: the Vercel URL).
- Static job pages for search engines (docs/product/ARCHITECTURE.md D12, §13): `/jobs/<title>-<company>-<id>/` with `JobPosting` JSON-LD, plus listings `/jobs/`, `/jobs/tech/<id>/`, `/jobs/country/<cc>/`, `/jobs/source/<id>/` and job sitemaps `/jobs/sitemap/<n>.xml`. They are prerendered from a build-time snapshot (`scripts/seo-snapshot.mjs`, read-only, needs `DATABASE_URL`; without it the build has no job pages). `/jobs/view/?id=` stays the live, `noindex` job screen; the home detail panel links to the static page ("Open job page").

## CI

`.github/workflows/ci.yml` runs on every pull request and on push to `main`:
- `web`: install (`pnpm install --frozen-lockfile`), `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, and `pnpm --filter web build` (static export).
- `python`: for each of `apps/api`, `apps/crawler`, `apps/mcp`, `uv sync`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`.
- `api-db`: runs `apps/api`'s database-backed tests against a `postgres:17` service, then applies every migration from scratch with `node scripts/migrate.mjs` to prove they apply cleanly.

A PR must pass all three jobs before merging.

## Blog

`/blog/` publishes a daily **Hiring & career trends roundup** plus openly licensed articles in full, to bring search traffic that converts into job views. Decisions (copyright model, canonical, nofollow, freshness): [`docs/DECISIONS.md`](docs/DECISIONS.md) "Blog".

- `python -m job_crawler.blog` (`apps/crawler/src/job_crawler/blog/`) fetches the feeds below (robots.txt checked, one request per feed per day), stores articles in `blog_articles` and, when at least 8 new articles are uncited, writes a templated roundup to `blog_posts` with related jobs from our catalogue. No LLM. `--dry-run` fetches and counts without a database.
- The web build runs `apps/web/scripts/export-blog.mjs` first (reads the tables into `apps/web/.blog/snapshot.json`); the static pages are `/blog/`, `/blog/<roundup>/`, `/blog/articles/<slug>/` (full-text copies, canonical = the original), `/blog/topics/<topic>/`, `/blog/rss.xml` and `/sitemap-blog.xml`.
- Copyright: by default only title, author, date, link and an excerpt of at most 50 words from the feed. Full text only for sources whose licence allows it, shown with author, publisher, original date, licence link and the original link.

| Source | Feed | Mode | Licence |
|---|---|---|---|
| U.S. Bureau of Labor Statistics: Employment Situation | https://www.bls.gov/feed/empsit.rss | full | [Public domain](https://www.bls.gov/opub/copyright-information.htm) |
| U.S. Bureau of Labor Statistics: JOLTS | https://www.bls.gov/feed/jolts.rss | full | [Public domain](https://www.bls.gov/opub/copyright-information.htm) |
| The Conversation: Labour market, Employment, Future of work, Remote work, Careers, Layoffs | `https://theconversation.com/topics/<topic>/articles.atom` | full (max 3 per feed per day) | [CC BY-ND 4.0](https://theconversation.com/republishing-guidelines) |
| LSE Business Review (on-topic headlines only) | https://blogs.lse.ac.uk/businessreview/feed/ | full | [CC BY 4.0](https://blogs.lse.ac.uk/republishing-policy/) |
| Indeed Hiring Lab | https://www.hiringlab.org/feed/ | excerpt | all rights reserved |
| HR Dive (talent) | https://www.hrdive.com/feeds/topic/talent/ | excerpt | all rights reserved |
| ERE | https://www.ere.net/feed/ | excerpt | all rights reserved |
| The Pragmatic Engineer | https://newsletter.pragmaticengineer.com/feed | excerpt | all rights reserved |
| Stack Overflow Blog (on-topic headlines only) | https://stackoverflow.blog/feed/ | excerpt | all rights reserved |
| TechCrunch (layoffs) | https://techcrunch.com/tag/layoffs/feed/ | excerpt | all rights reserved |
| Remotive blog | https://remotive.com/blog/feed | excerpt | all rights reserved |

**Add a source:** append a `FeedSource` to `apps/crawler/src/job_crawler/blog/sources.py`. Leave `republish_mode="excerpt"` unless you have read the publisher's licence and it allows republication; then set `republish_mode="full"`, `licence_name`, `licence_url` (and `item_rights_pattern` / `pixel_pattern` if the licence has per-item rights or a required counter), and record the licence check in `docs/DECISIONS.md`. Add a trimmed fixture under `apps/crawler/tests/fixtures/blog/` with a parser test, then check it live: `cd apps/crawler && uv run python -m job_crawler.blog --dry-run --source <key>`. Topic keywords live in `topics.py` (mirrored in `apps/web/src/lib/blog/topics.ts`).

## Add a company board

```sql
INSERT INTO company_boards (ats, slug, company_name) VALUES ('greenhouse', '<slug>', '<Company>');
```
