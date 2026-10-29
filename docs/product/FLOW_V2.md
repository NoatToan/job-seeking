# Flow v2: email OTP → CV scan → personalised feed + live search

Product owner's direction (2026-10-29). This narrows the MVP from `E2E_FLOW.md` to one fast path, and is the
contract between `apps/api` and `apps/web`.

## 1. User flow

```mermaid
flowchart LR
  A[Open web] --> B[Enter email] --> C[Enter 6-digit code] --> D{Has a CV?}
  D -- no --> E[Upload CV] --> F[Scanning… (host worker runs claude -p)] --> G[Review keywords]
  D -- yes --> H
  G --> H[Feed: jobs from our DB matching my keywords\ninfinite scroll]
  H <--> I[Live search: query job platforms in real time\ninfinite scroll]
```

1. **Sign in**: email → 6-digit one-time code (valid 10 min, 5 tries) → session cookie. Sign-in and sign-up are the same step: an unknown email gets an account on first successful code.
2. **Upload CV**: PDF, PNG/JPG/WEBP (scans), TXT or MD, ≤ 5 MB. The API stores it and queues a `cv_extract` task, then answers immediately with `status: queued`.
3. **Scan**: the **host worker** (a machine with the Claude Code CLI, e.g. the owner's Mac) picks the task from Postgres. It runs `claude -p` through `job_crawler.matching` (text layer or OCR → structured profile) and saves text, profile and keywords. The SPA polls until `done`.
4. **Keywords**: the user sees the extracted keywords as chips. They can remove or add some, and set remote-only and "I'm based in" (eligibility). These are saved as the user's search preferences.
5. **Feed**: jobs already in our DB (daily crawl + earlier live searches), filtered by the keywords (full-text, any keyword), remote-only and eligibility, newest first. Infinite scroll uses a keyset cursor.
6. **Live search**: a query box hits the platforms' own search APIs right now (SEEK JSON API, Himalayas search, Remotive, We Work Remotely RSS, Arc). Results are merged with source badges, and scrolling loads the next page from each source. Results are also upserted into `jobs`, so the feed grows over time. Upwork is excluded under its terms.

## 2. Topology

- **Vercel** (one project): the static SPA plus FastAPI as a Python function at `/api/*`, so everything is same-origin and cookies just work.
- **Postgres**: the shared instance, database `job_unified_matching`.
- **Host worker**: `uv run python -m ujc_api.worker` on a machine with the `claude` CLI logged in.
  - It only needs `DATABASE_URL` and polls the `tasks` table, so no inbound port or tunnel is needed.
  - If it's offline, CVs stay `queued` and the UI says "waiting for the scanner".
- **Email**:
  - **Resend** when `RESEND_API_KEY` is set.
  - Otherwise, **review mode** (`UJC_OTP_REVIEW_MODE=true`) returns the code in the API response and the UI shows it. This is only for the access-protected preview deployment, never production.

## 3. Database (migration `007_auth_cv_tasks.sql`)

```sql
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,            -- stored lower-cased
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE email_otps (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                     -- HMAC-SHA256(secret, email|code)
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,        -- max 5
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_email_idx ON email_otps (email, created_at DESC);
CREATE TABLE sessions (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,              -- sha256 of the cookie value
  user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,              -- 30 days, sliding
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE user_cvs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  content      BYTEA NOT NULL,                   -- ≤ 5 MB; deleted with the CV
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','error')),
  error        TEXT,
  text         TEXT,
  profile      JSONB,                            -- skills, target_titles, seniority, summary…
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX user_cvs_user_idx ON user_cvs (user_id, created_at DESC);
CREATE TABLE user_preferences (
  user_id           BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  keywords          TEXT[] NOT NULL DEFAULT '{}',
  remote_only       BOOLEAN NOT NULL DEFAULT FALSE,
  candidate_country TEXT,                        -- ISO code, see eligibility
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                      -- 'cv_extract'
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  run_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by  TEXT,
  locked_at  TIMESTAMPTZ,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_queue_idx ON tasks (status, run_after) WHERE status = 'queued';
-- keyset pagination for the feed: newest first, id as tie-breaker
CREATE INDEX jobs_feed_idx ON jobs ((coalesce(posted_at, first_seen_at)) DESC, id DESC);
```

**Worker claim**:
```sql
UPDATE tasks SET status='running', locked_by=$me, locked_at=now(), attempts=attempts+1
WHERE id = (SELECT id FROM tasks WHERE status='queued' AND run_after<=now()
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *
```
- On failure: back off (`run_after = now() + 2^attempts min`). After 3 attempts the task becomes `error` and the CV becomes `error`.
- Tasks stuck `running` for more than 15 minutes are re-queued.

### Cursor pagination (feed)
- Order is `(coalesce(posted_at, first_seen_at) DESC, id DESC)`, backed by `jobs_feed_idx`.
- The cursor is opaque base64url JSON `{"t": "<iso timestamp>", "i": <id>}`. The next page is `WHERE (coalesce(posted_at, first_seen_at), id) < ($t, $i)`.
- This keeps every page O(page size) at any depth: no OFFSET, and no duplicates or gaps when new jobs arrive.
- Filters:
  - `search @@ to_tsquery('english', k1 | k2 | …)`: any keyword, via `websearch_to_tsquery` per keyword OR-ed together
  - `remote` when remote-only
  - eligibility `(NOT remote OR open_to IS NULL OR open_to && $accepted)`
  - optional `q` (an extra AND term)
  - optional `source`

### Cursor (live search)
- The cursor is opaque base64url JSON holding per-source state, e.g. `{"seek":2,"himalayas":2,"remotive":null,"wwr":null,"arc":null}`. `null` means that source is exhausted (single-page sources: Remotive, WWR, Arc).
- Each call fetches the next page of every non-exhausted source in parallel. Each source has an 8 s timeout; a failure is reported in `sources[].error` rather than failing the request.
- Results are de-duplicated by `(source, external_id)` and upserted into `jobs`.

## 4. API contract (all JSON, errors `{error:{code,message,fields?}}`)

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/auth/otp` | – | `{email}` | `202 {sent:true, expiresInSec:600, devCode?}` (`devCode` only in review mode). Rate limit: 1 per 60 s per email, 5 per hour per email, 20 per hour per IP → `429`. |
| `POST /api/auth/verify` | – | `{email, code}` | `200 {user}` + `Set-Cookie: ujc_session` (HttpOnly, Secure, SameSite=Lax, 30 d) + `ujc_csrf` (readable). Errors: `400 invalid_code` / `410 code_expired` / `429 too_many_attempts`. |
| `POST /api/auth/logout` | session | – | `204`, cookies cleared |
| `GET /api/me` | session | – | `{user:{id,email}, preferences:{keywords[],remoteOnly,candidateCountry}, latestCv: Cv \| null}` |
| `PUT /api/me/preferences` | session+CSRF | `{keywords[] (≤30, each ≤40 chars), remoteOnly, candidateCountry}` | `{preferences}` |
| `POST /api/cvs` | session+CSRF | multipart `file` | `202 Cv` (status `queued`); `413` > 5 MB; `415` bad type |
| `GET /api/cvs` | session | – | `{items: Cv[]}` (no content) |
| `GET /api/cvs/{id}` | session | – | `Cv` (owner only, else 404) |
| `DELETE /api/cvs/{id}` | session+CSRF | – | `204` |
| `GET /api/feed?cursor=&limit=20&q=&source=` | session | – | `{items: Job[], nextCursor: string\|null, keywords: string[]}` |
| `GET /api/search/live?q=&sources=seek,himalayas,remotive,wwr,arc&cursor=` | session | – | `{items: Job[], nextCursor: string\|null, sources:[{id, count, error?}]}` |

- `Cv` = `{id, filename, status, error, keywords[], profile: {headline, seniority, skills[], summary} | null, createdAt, processedAt}`.
- `Job` = the `Job` type in `packages/core` (`id, source, url, applyUrl, title, company, location, remote, employmentType, salaryText, tags, openTo, postedAt, firstSeenAt`).
- CSRF uses the double-submit pattern: header `X-CSRF-Token` must equal the `ujc_csrf` cookie on unsafe methods. The SPA client from M2-01 already sends it.

## 5. Environment variables (names only)
- `DATABASE_URL`
- `UJC_SECRET_KEY`: HMAC for OTP codes and the CSRF token
- `UJC_ENV`
- `UJC_OTP_REVIEW_MODE`
- `RESEND_API_KEY`
- `UJC_MAIL_FROM`
- worker only: `UJC_CLAUDE_MODEL`
