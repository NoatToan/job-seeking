# Developer guide

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
| `packages/contributor-box`, `apps/api/src/contributor_box` | **Vendored** from [`NoatToan/contributor-box`](https://github.com/NoatToan/contributor-box) by `pnpm contributor:sync` (see "Contributor") |

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

- Web: Vercel project `unified-job-crawler`, connected to the GitHub repo: every push to `main` deploys production (other branches get preview deployments, which skip migrations). The Vercel CLI (`vercel deploy --prod`) also works, and is what the daily rebuild uses. `vercel.json` points the build at `apps/web`, whose `build` script runs, in order: the migrations (`scripts/migrate.mjs`), the job snapshot for the static SEO pages (`scripts/seo-snapshot.mjs`), the blog snapshot (`apps/web/scripts/export-blog.mjs`), then `next build`. All three need `DATABASE_URL` in the Vercel build env; the job snapshot refuses to build on Vercel without it.
- Daily crawl: `.github/workflows/daily-crawl.yml` (05:00 Vietnam time). Set the repository secrets `DATABASE_URL` (and optionally `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`).
- Daily blog: `.github/workflows/daily-blog.yml` (06:30 Vietnam time). Uses `DATABASE_URL`. See "Blog" below.
- Daily rebuild (static job pages after the crawl, new blog posts after the blog run): both workflows call `.github/workflows/vercel-rebuild.yml` (also runnable by hand). With the repository secret `VERCEL_TOKEN` it runs `vercel deploy --prod` (a remote build, so it uses the Vercel project's build env); `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` default to this project's ids and can be overridden with repository variables. Without a token it falls back to a `VERCEL_DEPLOY_HOOK_URL` secret (a Deploy Hook, which works since the project is Git-connected), else it skips with a notice. Deploys share the concurrency group `vercel-prod-deploy`, so the two workflows never build at the same time.

## Contributor (feedback, feature ideas, admin review)

Anyone sends feedback from a floating button on any page (signed-out visitors too, under a
pseudonym; see below): pick a type, point at an element or drag over an area, optionally attach a
screenshot with that area highlighted; the page URL and element are captured automatically. Every
item except `rejected` is public as soon as it is sent. `/roadmap/` is the public kanban by status
(New, Under review, Under consideration, Planned, Done) with a kind filter, readable and
commentable signed out; `/contribute/` is the same board for signed-in users plus their own
submissions. Items and comments have Stack Overflow votes (▲ score ▼, signed-in only) and
two-level comment threads. Admins review everything at `/admin/feedback/`: edit, set status
(`rejected` takes an item off the board), reply publicly, add notes, lock comments, and work
through reported comments (hide, delete, dismiss).

- **Anonymous feedback and comments**: `routers/feedback.py` turns on contributor-box's
  `allow_anonymous` and `allow_anonymous_comments`. A signed-out visitor gets an HttpOnly
  `cb_visitor` cookie (a random id signed with `UJC_SECRET_KEY`, `Secure` outside development)
  and appears under a stable pseudonym derived from it ("Brave Otter #123" / "Rái cá dũng cảm"),
  which they can replace with a display name ("You'll appear as … · Change"). Writes stay
  CSRF-protected: the web app calls `GET /api/auth/csrf` first when the browser has no
  `ujc_csrf` cookie (`ensureCsrfCookie` in `lib/api.ts`). Limits per hour: items 5 per IP key
  (HMAC of the client IP) and 60 overall; comments 10 per visitor, 15 per IP key, 100 overall;
  plus a honeypot field. Signed-in users show their display name or their email's local part.
- **Public roadmap**: `public_board` lets signed-out visitors read the board, stats, item details
  and comments (public fields only). `/roadmap/` is in the sitemap, the TopNav, the signed-out
  phone tab bar and the signed-in account sheet. Voting needs a session: signed out, the vote
  arrows (and "Sign in to comment") open the login modal in place (`onRequireSignIn` in
  `lib/contributor.tsx`) and cast the vote after sign-in.
- **Data and privacy**: `GET /api/me/export` includes the user's comments and display name.
  Deleting an account turns their comments into "[deleted]" placeholders (text cleared) so other
  people's replies stay in their threads.
- **Admins**: `users.role = 'admin'` or an email in `UJC_ADMIN_EMAILS`. Grant from a machine with
  `DATABASE_URL`: `cd apps/api && uv run python -m ujc_api.admin grant you@example.com` (the
  account must have signed in once; `revoke` and `list` too).
- **Source of truth**: the feature lives in the private repo
  [`NoatToan/contributor-box`](https://github.com/NoatToan/contributor-box). Do not edit
  `packages/contributor-box/`, `apps/api/src/contributor_box/`, `apps/api/tests/test_cb_*.py`,
  `apps/api/tests/cb_fakes.py` or the mapped migrations (`022`, `024`, `029`) here. Change upstream, then:

  ```bash
  pnpm contributor:sync              # clone contributor-box@ref (contributor-box.config.json) and copy
  pnpm contributor:sync -- --check   # verify the vendored copy matches upstream
  pnpm contributor:sync -- --source ../contributor-box   # from a local checkout
  ```

  The sync writes `contributor-box.lock.json` (upstream commit + owned files), adds new upstream
  migrations only when they are mapped in `contributor-box.config.json`, and never overwrites an
  applied migration. Commit the result with the usual checks green. See
  `product/ARCHITECTURE.md` D14.

## AI coder (feedback -> GitHub issue -> Claude -> PR)

1. **Feedback -> issue** (`apps/api/src/ujc_api/feedback_github.py`): when an admin moves a
   feedback item to `FEEDBACK_GITHUB_STATUS` (default `planned`) at `/admin/feedback/`, the API
   opens one issue in `FEEDBACK_GITHUB_REPO` (default `NoatToan/job-seeking`), labelled
   `feedback` + `bug` + `ai:fix` for a bug, or `feedback` + `enhancement` + `ai:plan` otherwise,
   and records it in `feedback_github_issues` (later saves never open a second one). The visitor's
   text is quoted in code blocks, without their identity or screenshot. Off until
   `FEEDBACK_GITHUB_TOKEN` is set in Vercel: a fine-grained token with "Issues: read and write"
   on this repo only. A GitHub error never fails the admin's save; the next save retries.
2. **Issue -> Claude** (`.github/workflows/ai-issue.yml`, prompts in `scripts/ai-issue/`):
   - `ai:fix`: `claude -p` fixes the bug with a test and opens a PR that closes the issue.
   - `ai:plan`: `claude -p` (read-only tools) posts a plan as a comment and adds
     `ai:awaiting-approval`. A maintainer comments `/approve` (or adds `ai:approved`) and Claude
     implements it in a PR; comment corrections and `/replan` for a new plan.
   - Labels can be added by hand to any issue too. Only comments from OWNER / MEMBER /
     COLLABORATOR reach the prompt; Claude runs without GitHub credentials and with a short tool
     allowlist. PRs are never merged automatically.
   - Secrets: `ANTHROPIC_API_KEY` (already used by the release notes); optional
     `AI_GITHUB_TOKEN` (contents + pull requests: write) so CI runs on the AI's PRs (a PR opened
     with the default `GITHUB_TOKEN` starts no workflows). Variable `AI_CODER_MODEL` (default
     `claude-sonnet-5`).

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

`/blog/` publishes a daily **Hiring & career trends roundup** plus openly licensed articles in full, to bring search traffic that converts into job views. Decisions (copyright model, canonical, nofollow, freshness): [`docs/DECISIONS.md`](DECISIONS.md) "Blog".

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

## Release notes

`/release-notes/` (public, in `sitemap.xml`, Atom feed at `/release-notes/feed.xml`) shows what shipped, one entry per day, from `apps/web/src/content/release-notes.json`. Each entry: `date`, `slug`, `title` and `highlights[]` (category `new` / `improved` / `fixed` / `under-the-hood`, one line each, `en` + `vi`), optional `screenshot` (a path under `apps/web/public/`) and `commits` (`from`, `to`, `count`). The rules live in `scripts/release-notes/schema.mjs` and a web test checks the committed file against them. Decisions: [`docs/DECISIONS.md`](DECISIONS.md) "Release notes".

`.github/workflows/release-notes.yml` writes the entries on every push to `main`:

1. Skips when the push only touches the notes file or comes from `github-actions[bot]`.
2. `node scripts/release-notes/generate.mjs` reads the commits since the newest entry's `commits.to`, drops the bot's own commits and any commit whose subject (first line) contains `[skip release-notes]`, and stops if what is left is only chores / docs / tests / CI / merges.
3. Otherwise it asks Claude (Messages API, `claude-sonnet-5`, structured JSON output) with the prompt in `scripts/release-notes/prompt.md`, validates the answer, and adds today's entry, or rewrites it when today already has one (days are counted in `Asia/Ho_Chi_Minh`).
4. The workflow commits the file to `main` as `github-actions[bot]` ("Release notes for <date> [skip release-notes]"); the Git-connected Vercel project deploys it.

| Setting | Kind | Needed | What |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | repository secret | yes | Claude API key. Without it every run ends with a notice and changes nothing. |
| `RELEASE_NOTES_MODEL` | repository variable | no | Model id, default `claude-sonnet-5`. |
| `RELEASE_NOTES_TZ` | repository variable | no | Time zone that decides the entry's day, default `Asia/Ho_Chi_Minh`. |

The workflow pushes with the built-in `GITHUB_TOKEN` (`contents: write`). If `main` gets branch protection that blocks direct pushes, allow GitHub Actions to bypass it, or the runs end with a warning and nothing is lost: the anchor (`commits.to`) only moves when an entry is written, so the next push retries the same commits.

By hand: `node scripts/release-notes/generate.mjs --dry-run` prints the prompt it would send; with `ANTHROPIC_API_KEY` set it writes the file (commit it yourself). To edit or split an entry, change the JSON directly (a second entry on the same day gets the slug `<date>-2`; the generator keeps updating the newest one); put `[skip release-notes]` in a commit's subject line to leave that commit out.

## Add a company board

```sql
INSERT INTO company_boards (ats, slug, company_name) VALUES ('greenhouse', '<slug>', '<Company>');
```
