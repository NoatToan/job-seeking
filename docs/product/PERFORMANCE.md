# Database performance audit

Status: 2026-11-07, branch `perf/db-audit`. Covers every SQL statement in `apps/api`,
`apps/crawler`, the vendored `contributor_box`, and the build scripts (`scripts/seo-snapshot.mjs`,
`apps/web/scripts/export-blog.mjs`), against migrations `001`–`027`.

Short version: the hot read paths (public catalogue, feed, tracker, job detail) were already well
indexed. The audit found three statements doing full scans that an index fixes (daily digest,
sources summary, worker stale-task requeue). It also found four places that ran more statements
than needed: one INSERT per scored job in the worker, a preferences re-read per digest user, six
lookups for `GET /api/me`, and two statements per session check. All of them are fixed, and
tests now check the number of queries each endpoint runs.

## How it was measured

- Local PostgreSQL 14.15 (Homebrew; 17 was not installed), every migration applied with
  `scripts/migrate.mjs`, then a deterministic seed: **80,000 jobs** (14 sources with a skewed
  spread, 45 % remote, `open_to` / `countries` / `timezones` / `tech_stack` arrays, posted dates
  over 180 days, 1/7 without `posted_at`, a third with a structured salary, descriptions of
  120–420 words that mention their own tech stack, so a keyword like `react` matches ~22 % of jobs
  and `kubernetes` ~5 %), 500 users (400 with preferences, 350 with a done CV), 6,000 tracked
  applications + 12,000 events, 7,200 match scores, 100,000 viewed rows, 50,000 done tasks,
  5,110 crawl runs, 2,000 feedback items / 25,000 votes / 4,000 notes, 3,000 blog articles /
  300 posts. Production today is ~5–10k jobs, so the seed is roughly 10x the current size.
- A harness (kept out of the repo) calls the real router/worker/digest functions through a
  recording connection to capture the exact SQL and parameters they send. It then runs
  `EXPLAIN (ANALYZE, BUFFERS)` 7 times and keeps the median (planning + execution). Cursor pages
  10 and 50 follow the real `nextCursor` chain.
- The machine was under load (load average ~7.5), so sub-millisecond differences are noise. The
  **shared-buffer count** is deterministic: when a plan and its buffer count are unchanged,
  "before" and "after" are the same work.

## Query inventory and access patterns

| Area | Statement (file) | Access pattern | Index used |
|---|---|---|---|
| Public catalogue | `GET /api/jobs` (`routers/jobs.py` → `job_sort.fetch_page`) | `source <> 'upwork'` + optional `search @@ websearch_to_tsquery`, `source =`, `remote`, `countries @>`, `tech_stack @>`, `open_to &&`, posted-within; `ORDER BY coalesce(posted_at, first_seen_at) DESC, id DESC`, keyset `(t, id) < (…)` | `jobs_feed_idx` walk; selective filters switch to a GIN `BitmapAnd` (`jobs_search_idx`, `jobs_countries_idx`, `jobs_tech_stack_idx`, `jobs_open_to_idx`) + top-N sort |
| | `sort=salary` | `ORDER BY coalesce(salary_usd_year,-1) DESC, t DESC, id DESC` | `jobs_salary_sort_idx` (migration 025) |
| | `sort=timezone` | key computed per row from `jobs.timezones` and the viewer's zone | none possible (see recommendations) |
| Job detail | `GET /api/jobs/{id}` | PK | `jobs_pkey` |
| Facets | `GET /api/jobs/facets` | `unnest(countries)` / `unnest(tech_stack)` over every job, `GROUP BY` | seq scan (inherent) |
| Sources | `GET /api/sources`, `GET /api/platforms` | `count(*)`, `max(first_seen_at)` `GROUP BY source` + latest `crawl_runs` per source | **`jobs_source_first_seen_idx`** (new, index-only) + `crawl_runs_source_started_idx` |
| Feed | `GET /api/feed` (`routers/feed.py`) | the catalogue filters + the user's keywords (`search @@ (q1 \|\| q2 …)`), eligibility, `LEFT JOIN user_matches` | `jobs_feed_idx` or `jobs_search_idx` bitmap; `user_matches_pkey` |
| | `sort=match` | `ORDER BY coalesce(um.score,-1)` | `user_matches_user_score_idx` hash + sort of the feed set |
| Session | `auth.session.lookup_user` (every signed-in request) | `token_hash =` | `sessions_token_hash_key`, `users_pkey` |
| PAT / runner auth | `auth/deps.py` | `token_hash =` | unique indexes |
| Me | `GET /api/me`, `/api/me/profile` | PK + `LEFT JOIN user_preferences` + latest `user_cvs` | `users_pkey`, `user_preferences_pkey`, `user_cvs_user_idx` |
| Tracker | `GET /api/applications[?status=]` | `user_id =` [`status =`] `ORDER BY updated_at DESC, id DESC` | `applications_user_updated_idx` / `applications_user_status_idx` |
| | events | `application_id =` `ORDER BY created_at DESC` | `application_events_application_idx` |
| Viewed | `GET/POST/DELETE /api/me/viewed` | `user_id =` `ORDER BY viewed_at DESC, job_id DESC LIMIT 5000`; upsert from `unnest` | `job_views_user_viewed_idx` (incremental sort on the tie-breaker); PK |
| Live search | `jobs_upsert.upsert_jobs_get_ids`, `routers/search.py` | `JOIN unnest(sources, external_ids)`; `id = ANY(%s)` | `jobs_source_external_id_key`, `jobs_pkey` |
| Matches quota | `POST /api/matches/refresh` | `user_id =` and `created_at >=` | `match_refreshes_user_idx` |
| OTP | `auth/otp.py` | `email =` `ORDER BY created_at DESC` | `email_otps_email_idx` |
| Worker | `CLAIM_SQL` | `status='queued' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1` | `tasks_queue_idx` (partial) |
| | `requeue_stale` (every poll) | `status='running' AND locked_at < now() - 15 min` | **`tasks_running_locked_idx`** (new, partial) |
| | `match_score` candidates | feed filters, newest 300 | `jobs_feed_idx` |
| Digest | `due_users` | `digest_enabled` | `user_preferences_digest_idx` |
| | `select_digest_jobs` (per due user) | feed filters + `first_seen_at > since`, `ORDER BY um.score DESC NULLS LAST, t DESC` | **`jobs_first_seen_at_idx`** (new) + `jobs_search_idx` |
| Maintenance | `maintenance.purge` (daily) | `expires_at <`, `created_at <` | seq scans of small tables, once a day (fine) |
| Crawler | `job_crawler.db.upsert_jobs` | `INSERT … ON CONFLICT (source, external_id)` via pipelined `executemany` | `jobs_source_external_id_key` |
| | `link_profile_jobs`, `load_boards`, `start/finish_run` | `JOIN unnest(...)`; small tables | unique index; PK |
| | `recompute_*`, `normalize_descriptions` (manual backfills) | full scans with a server-side cursor, pipelined `executemany` updates | n/a (intentional) |
| Blog | `blog/db.py` unassigned articles, related jobs | `NOT EXISTS` + recency; FTS + recency | `blog_articles_recency_idx`, `blog_post_articles_article_key`; `jobs_feed_idx` |
| SEO snapshot | `scripts/seo-snapshot.mjs` (build) | `last_seen_at > now() - 14 days`, description length, `ORDER BY t DESC LIMIT 20000` | seq scan + sort (correct: most rows qualify) |
| Blog export | `apps/web/scripts/export-blog.mjs` (build) | latest posts, cited articles `post_id IN (…)`, full articles | already batched (3 statements) |
| Feedback (contributor-box) | `PgFeedbackRepository.list_items` | `status = ANY`, `ORDER BY created_at DESC, id DESC` / `vote_count DESC`, `LIMIT/OFFSET`, per-row vote subqueries | `feedback_items_status_created_idx`, `feedback_votes_pkey` |

## EXPLAIN (ANALYZE, BUFFERS) before / after migration 027

Median of 7 runs on the 80k-job seed; "buf" = shared buffers touched (hit + read).

| Query | Before | After | Plan after |
|---|---|---|---|
| Daily digest, user with keywords | 16.8 ms, 11,059 buf | 2.8 ms, 1,237 buf | `BitmapAnd(jobs_search_idx, jobs_first_seen_at_idx)` |
| Daily digest, user without keywords | 50.8 ms, 28,858 buf (seq scan) | 6.3 ms, 4,822 buf | bitmap scan on `jobs_first_seen_at_idx` |
| Sources summary (`/api/sources`, `/api/platforms`) | 40.1 ms, 28,953 buf (seq scan) | 6.3 ms, 455 buf | index-only scan `jobs_source_first_seen_idx` + merge join |
| Worker `requeue_stale` (50k done tasks) | 2.4 ms, 770 buf (seq scan, every poll) | 0.01 ms, 1 buf | `tasks_running_locked_idx` |
| Public list p1 / p10 / p50 | 0.04 ms, 24 buf | same | `jobs_feed_idx` |
| Public `source=ashby` p1 / p50 | 0.1 ms, 583 / 330 buf | same | `jobs_feed_idx` + filter |
| Public `country=HK` (rare) | 0.4 ms, 1,468 buf | same | `jobs_feed_idx` + filter |
| Public `tech=svelte,tailwind` (rare) | 0.6 ms, 131 buf | same | GIN bitmap + top-N sort |
| Public `remote+country=US+tech=python` | 2.0 ms, 1,445 buf | same | `BitmapAnd` |
| Public `q=react&country=VN` | 1.4 ms, 604 buf | same | `BitmapAnd` |
| Public `q="site reliability"` p10 | 0.4 ms, 1,301 buf | same | `jobs_feed_idx` + filter |
| Public `sort=salary` p1 / p10 | 0.04 ms, 24 buf | same | `jobs_salary_sort_idx` |
| Public `sort=timezone` p1 / p10 | 112 / 157 ms, 28,856 buf | same | seq scan + per-row key + top-N sort |
| Feed (keywords, eligibility) p1 / p10 | 0.2–0.4 ms | same | `jobs_feed_idx` + `user_matches_pkey` |
| Feed `sort=match` | 5.2 ms, 8,612 buf | same | `jobs_search_idx` bitmap + hash join + sort |
| Feed `sort=timezone` | 20 ms, 11,059 buf | same | bitmap + sort |
| Facets | 39 ms, 28,872 buf | same | seq scan (inherent) |
| Job detail, tracker, viewed, session, task claim | ≤ 0.06 ms | same | PK / composite indexes |
| SEO snapshot (build time, 20k rows) | 219 ms | same | seq scan + sort (correct here) |

**Write cost of 027.** It adds one btree (`jobs_first_seen_at_idx`) and swaps
`jobs_source_idx (source)` for `jobs_source_first_seen_idx (source, first_seen_at)`. Crawler
updates are never HOT (`last_seen_at` is indexed and changes on every upsert), so every upsert
now writes one more index entry. On the seed, updating `last_seen_at` on 3,000 jobs took 150–234 ms
with the old indexes and 185–230 ms with the new ones (noisy machine). That is a few µs per row,
against ~2 ms per row of Python `derive()` work in `upsert_jobs`. The migration itself took
0.2 s on 80k jobs, so it adds nothing noticeable to the Vercel build at today's 5–10k.

## Indexes: migration `028_query_indexes.sql`

| Index | Why |
|---|---|
| `jobs_first_seen_at_idx (first_seen_at)` | `select_digest_jobs` filters `first_seen_at > since`. Without the index, every due user scanned the whole `jobs` table every hour (and detoasted `search` per row when they had keywords). |
| `jobs_source_first_seen_idx (source, first_seen_at)` | The sources summary (`count(*)`, `max(first_seen_at)` per source) becomes an index-only scan. Its leading column also serves `source =`. |
| `DROP INDEX jobs_source_idx` | Redundant: `UNIQUE (source, external_id)` and the new index both lead with `source`. Net index count on `jobs` grows by one, not two. |
| `tasks_running_locked_idx (locked_at) WHERE status = 'running'` | `requeue_stale` runs before every worker poll (every 3 s). `tasks` keeps every done row, so the seq scan grew forever. |

Every statement uses `IF [NOT] EXISTS` and plain `CREATE INDEX`, not `CONCURRENTLY`: both
`scripts/migrate.mjs` and `ujc_api.migrate` wrap each file in a transaction, where `CONCURRENTLY`
is not allowed. At today's table size, the write lock lasts well under a second.

Considered and not added:

- **A composite `(source, coalesce(posted_at, first_seen_at), id)` index for `source=` pages.**
  Today's plan reads 330–583 buffers in 0.1 ms. That isn't worth another index that every upsert
  has to maintain.
- **A partial feed index `WHERE remote`.** Remote is 45 % of jobs, so the feed index already
  finds 20 remote rows within ~43 buffers.
- **Trigram (`pg_trgm`) indexes.** No job query uses `LIKE`/`ILIKE`. contributor-box's
  `ILIKE` search runs on a few thousand feedback rows (see "Upstream").
- **Covering `(user_id, viewed_at DESC, job_id DESC)` for viewed.** The incremental sort on the
  tie-breaker costs 0.06 ms for 250 rows.
- **Dropping `jobs_last_seen_at_idx` / `jobs_posted_at_idx`.** Both had 0 scans in the benchmark
  (no query orders by raw `posted_at`, and the SEO snapshot's `last_seen_at` window matches most
  rows). Dropping `last_seen_at` would not make crawler upserts HOT either: the seed's pages are
  full, and HOT updates stayed at 0 when tested. So they're kept, and production
  `pg_stat_user_indexes` should decide (see "Monitoring").

## Fewer round-trips and N+1 fixes

Checked with a counting cursor in `apps/api/tests/test_query_counts_db.py`. Each endpoint runs
with 2 rows and then with 42 rows per list, and must run the same number of statements both
times, equal to the documented constant.

| Path | Before | After | Fix |
|---|---|---|---|
| `match_score` task (worker) | 5 + **one INSERT per scored job** (up to 24) | 5 | One `INSERT … SELECT FROM jsonb_to_recordset(%s)` for the whole batch (`worker.INSERT_MATCHES_SQL`) |
| Daily digest run | 1 + **3 per due user** (prefs re-read, jobs, update) | 1 + 2 per due user | `due_users` reads keywords / remote / country with the scan. `select_digest_jobs(…, prefs)` uses them and only queries when called on its own. The per-user jobs query is inherent: every user has different filters. |
| `GET /api/me` | session 2 + **6 PK lookups** (profile, role, consent, onboarding, preferences, latest CV) = 8 | 2 | One `users LEFT JOIN user_preferences LEFT JOIN LATERAL (latest CV)` statement. The admin rule is shared through `auth.admin.role_from`. |
| Session check (every signed-in request) | `SELECT` + `UPDATE` (2) | 1 | `UPDATE sessions … FROM users … RETURNING user_id, email`: same sliding expiry, one statement |
| `GET /api/jobs` signed in, `/api/feed`, `/api/applications`, `/api/me/viewed`, `/api/me/profile`, feedback board | n + 1 (the session) | n | (follows from the session fix) |

Current constants (signed in): `/api/jobs` 2, `/api/jobs/facets` 2, `/api/sources` 1,
`/api/feed` (any sort) 3, `/api/applications` 2, `/api/me/viewed` 2, `/api/me` 2,
`/api/me/profile` 2, `/api/feedback?scope=board|mine` 4. Signed out: `/api/jobs` 1, feedback
board 2.

Checked and not N+1:

- The SPA has no per-row API calls: viewed jobs are posted in batches, and application events
  load only when a card is opened.
- Crawler upserts use psycopg 3's pipelined `executemany`: one network round trip per batch,
  with no `SELECT` before each upsert, because `ON CONFLICT` does the dedupe.
  `link_profile_jobs` and the live-search id lookup join `unnest(…)` arrays.
- `blog.db.related_jobs` runs one query per topic of a roundup (at most a handful, once a day).
  Each query depends on the ids picked by the one before it. Left as is.
- `blog.db.insert_articles` inserts row by row on purpose: each row gets its own savepoint, so
  one bad article doesn't drop the batch.
- `export-blog.mjs` already batches cited articles with `post_id IN (…)`.

## Upstream (contributor-box, vendored: not edited here)

- `_ITEM_COLUMNS` computes `vote_count` and `voted` with correlated subqueries per row. On a
  page of 20 that is cheap (0.3 ms). But `sort=top` has to count votes for **every** matching item
  before it can sort (2,030 buffers for 2,000 items). At scale, either keep a `vote_count`
  column maintained by the vote/unvote statements (or a trigger) with an index
  `(status, vote_count DESC, created_at DESC, id DESC)`, or aggregate votes once in a
  `GROUP BY item_id` subquery joined to the items.
- `list_items` runs a separate `count(*)` with the same `WHERE` on every page, and pages with
  `OFFSET`. That's fine for a few thousand items. If the board grows, use a keyset cursor
  `(created_at, id)` (the `feedback_items_status_created_idx` index already matches it) and drop
  the exact total, or cap it.
- `q` uses `ILIKE '%…%'` on title and body: a seq scan. Add `pg_trgm` GIN indexes, or a
  generated `tsvector` like `jobs.search`, only once the table reaches tens of thousands of rows.
- The upstream Postgres tests (`test_cb_pg_repository.py`) skip in this repo because the
  vendored copy ships without `sql/`. The host's own `test_feedback_db.py` covers these paths
  instead.

## Recommendations for in-flight branches

- **feat/jd-sections (`jobs.sections`, `jobs.level`)**: no index for `sections` (JSONB) unless
  something filters inside it; a GIN `jsonb_path_ops` index is only for `@>` queries. If `level`
  becomes a list filter, it is low-cardinality, so a plain btree won't help: the feed index walk
  with a filter is enough. If it gets a "level + newest" landing page, add
  `(level, coalesce(posted_at, first_seen_at) DESC, id DESC)`. Keep the derived columns out of
  any index unless a query needs them. Every indexed column a crawler upsert rewrites adds write
  cost.
- **feat/feedback-comments**: give comments an `(item_id, created_at, id)` index for the
  thread. Give every FK that is `ON DELETE SET NULL / CASCADE` its own index (author → users),
  as `022_feedback.sql` does. Load comment counts for a page with one `GROUP BY item_id` over
  `item_id = ANY(page ids)`, not a subquery per row. If comments get votes, use a composite PK
  `(comment_id, user_id)` plus a `user_id` index for account deletion.
- **feat/sort (merged)**: `sort=timezone` cannot use an index, because its key depends on the
  viewer's zone. It scans every candidate row and runs a jsonb lookup per zone: 112 ms at 80k
  jobs, so ~15 ms at today's size. If it becomes a hot path: store the jobs' UTC offsets as an
  `int[]` (refreshed by the crawler; DST makes this approximate) and compute the gap in SQL
  arithmetic, or cap the candidate set (for example, the newest 2,000 rows by `jobs_feed_idx`
  before sorting). `sort=match` sorts the whole feed set (5 ms). It could instead read the
  scored rows from `user_matches_user_score_idx` and then continue with the newest-first rows,
  but that isn't needed yet.
- **feat/profile-menu (merged)**: only primary-key reads on `users`. No index needed. Its
  `GET /api/me` fields are now folded into the single `/api/me` statement.
- **Migration numbering**: this branch takes `027`. If another branch also lands a `027_*`, the
  one merged second must be renumbered before deploy, since `schema_migrations` tracks files by
  name.

## Production monitoring

- If the shared instance lets us, enable `pg_stat_statements`
  (`shared_preload_libraries = 'pg_stat_statements'` needs a restart by the instance owner; then
  `CREATE EXTENSION pg_stat_statements` in `job_unified_matching`). Check monthly:
  `SELECT calls, mean_exec_time, rows, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20`.
- Without it: `pg_stat_user_tables` (`seq_scan` vs `idx_scan` on `jobs` and `tasks`) and
  `pg_stat_user_indexes` (`idx_scan = 0` after a month means a candidate to drop, starting with
  `jobs_posted_at_idx` and `jobs_last_seen_at_idx`).
- If the role may set it, `auto_explain` with `auto_explain.log_min_duration = '200ms'` catches
  slow plans without any code change.
- Two endpoints scan the whole catalogue on every home page load: `GET /api/jobs/facets` and,
  until 027, `GET /api/sources`. Facets is ~4 ms at today's size and ~40 ms at 80k jobs. If it
  shows up in `pg_stat_statements`, cache it in-process for a few minutes, or have the crawler
  write it to a small table after each run. An index can't help a full `unnest … GROUP BY`.
- Run `VACUUM (ANALYZE) jobs` after big backfills (`--recompute-derived`). Every crawl rewrites
  each seen row, so autovacuum has to keep up for the sources index-only scan to stay index-only.


## HTTP caching (2026-11-07, branch `perf/caching`)

Goal (user request): cache public data on the CDN, never cache anything per-user, no unbounded
in-process caches, and every deploy starts clean. Code: `apps/api/src/ujc_api/cache_control.py`
(policy + middleware), `apps/web/src/lib/build-id.ts`, `apps/web/src/lib/view-cache.ts`.
Tests: `apps/api/tests/test_cache_control.py`, `apps/web/src/lib/view-cache.test.ts`.

### Endpoint classes

The policy is decided by **route**, never by who is asking: the CDN cache key is method + URL
(query string included) + host + deployment, and never the `Cookie` header, so a cached response
must be the same for everybody who sends that URL.

| Class | Routes (GET) | `Cache-Control` on 200 |
| --- | --- | --- |
| Public, same for everyone | `/api/jobs/facets`, `/api/jobs/{id}` | `public, s-maxage=3600, stale-while-revalidate=86400` + weak `ETag` |
| Public, varies by query only | `/api/jobs` (`q`, `source`, `remote`, `country`, `tech`, `days`/`hours`, `access`/`based_in`, `sort`/`tz`, `cursor`, `limit`) | `public, s-maxage=300, stale-while-revalidate=86400` + `ETag` |
| Public, crawl status | `/api/sources` | `public, s-maxage=300, stale-while-revalidate=3600` + `ETag` |
| Public roadmap counts | `/api/feedback/stats` | `public, s-maxage=300, stale-while-revalidate=3600` + `ETag` |
| Personal | `/api/me*`, `/api/feed`, `/api/applications*`, `/api/me/viewed`, matches, profile, CVs, tokens, runners, platforms, connections, `/api/search/live`, `/api/auth/*` (incl. CSRF), digest unsubscribe | `private, no-store` |
| Personal when signed in | `/api/feedback` (board list), `/api/feedback/{id}`, `/meta` — they carry the viewer's own vote / authorship / admin flag | `private, no-store` |
| Operational | `/api/health`, `/api/ready`, anything unknown | `private, no-store` |

A public route still answers `private, no-store` when the status isn't 200 (404/400/429 must not
stick), when the request has `Authorization` (a personal access token from `apps/mcp`; Vercel
never caches those requests anyway), or when the response sets a cookie. A handler that sets its
own `Cache-Control` on a non-public route keeps it (CSRF `no-store`, screenshot `private, no-store`).

Freshness: the crawl runs about daily, so lists and source status are fresh for 5 minutes and
served stale (while the CDN refetches in the background) for up to a day / an hour. A job's
detail and the facet counts barely move within an hour. Vercel strips `s-maxage` /
`stale-while-revalidate` before the browser and sends `public, max-age=0, must-revalidate`, so
browsers always revalidate; the `ETag` turns that into a body-less 304.

### Personalisation splits

- `GET /api/jobs` and `GET /api/jobs/{id}` no longer take `optional_user`: they never read the
  session (it was accepted but unused, and cost a session `UPDATE` per signed-in request:
  `test_query_counts_db.py` now pins them at 1 statement). The signed-in, criteria-filtered list
  is `GET /api/feed` (personal, never cached); read state comes from `GET /api/me/viewed` and is
  merged client-side (`lib/viewed.ts`). Anything else per user about a job (votes, saved,
  match score) must come from a personal `/api/me/...` call, not from these routes.
- `test_signed_in_request_gets_the_same_public_body` checks every public route returns the same
  bytes and ETag with and without a session cookie, against a fake connection that raises on the
  session-lookup SQL.

### In-process memory

- No response cache in the function: the CDN does it, keyed by URL, outside our memory.
- `SlidingWindowRateLimiter` (OTP per-IP, unsafe-method per-IP, live-search per-user, Upwork) was
  a `defaultdict` keyed by IP / user that never dropped a key: the one real "memory leak" here.
  It is now an `OrderedDict` ordered by last hit; keys whose hits left the window are dropped as
  they age out, with a hard cap of 10,000 keys (least recently seen evicted).
- The `lru_cache`s in `job_sort` are bounded (`maxsize` 1 and 4) and hold time-zone tables, not
  request data. Each deployment runs in fresh function instances, so they reset on deploy.

### Invalidation on deploy

- **CDN**: nothing to do. Vercel's cache key includes the unique deployment URL ("Since each
  deployment has a different cache key, you can promote a new deployment to production without
  affecting the cache of the previous deployment", vercel.com/docs/caching/cdn-cache/purge
  "Cache keys"). A new production deployment therefore starts with an empty cache for
  `/api/*`; no `?v=` parameter or purge API call is needed.
- **Browser HTTP cache**: `max-age=0, must-revalidate` (see above), so every load revalidates
  against the current deployment.
- **SPA view cache** (`lib/view-cache.ts`, used by `useApi`/`useInfinite` `cacheKey`s): in
  memory only, gone on reload. For a tab left open across a deploy, the API sends
  `X-Build-Id: <VERCEL_GIT_COMMIT_SHA>` on every response and the SPA is built with the same
  value as `NEXT_PUBLIC_BUILD_ID`. `apiFetch` passes the header to `noteServerBuild`, which clears
  the whole view cache the first time a different build answers.
- **localStorage** holds preferences and the user's own read history (`ujc:viewed`, theme,
  time zone, based-in, list mode, hero collapse), not API responses, so it deliberately survives
  deploys. There is no service worker.

### Verify on production (after deploy)

```sh
H=https://job-seeking-remote.vercel.app
# Public: first MISS, then HIT (or STALE while revalidating). GET, not -I: FastAPI GET routes
# answer HEAD with 405.
curl -s -D - -o /dev/null "$H/api/jobs/facets" | grep -iE 'x-vercel-cache|cache-control|etag|x-build-id'
curl -s -D - -o /dev/null "$H/api/jobs/facets" | grep -i x-vercel-cache      # HIT
# A session cookie doesn't change the cached answer:
curl -s -D - -o /dev/null -H 'Cookie: ujc_session=x' "$H/api/jobs/facets" | grep -i x-vercel-cache
# Personal: never cached.
curl -s -D - -o /dev/null "$H/api/me" | grep -iE 'x-vercel-cache|cache-control'   # MISS, private
# After the next deploy: the first request is a MISS again and x-build-id shows the new sha.
```

Local check (done on this branch with uvicorn + Postgres 14): the classes above produced exactly
those headers; `If-None-Match` with the returned ETag gave `304`; `/api/jobs` with and without a
session cookie returned identical bodies.
