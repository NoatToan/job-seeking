# Security

Scope: `apps/api` (FastAPI backend) and the static SPA's deployment headers (`vercel.json`,
`deploy/Caddyfile`). Issue M5-03 (#30). Full checklist in `docs/product/PRD.md` §8.

## 1. Threat model summary

| Actor | Goal | Primary controls |
|---|---|---|
| Unauthenticated internet user | Brute-force OTP codes / sessions; enumerate accounts | OTP per-email + per-IP rate limits (`auth/otp.py`), 6-digit code + 5 max attempts, generic per-IP unsafe-method limit (§3) |
| Authenticated user, wrong target | Read/modify another user's CV, applications, matches, preferences | Every owner-scoped query filters on `user_id`; cross-user access returns 404, not 403 (doesn't confirm the resource exists) |
| Authenticated user | Forge a request on another user's behalf (CSRF) | Double-submit `ujc_csrf` cookie + `X-CSRF-Token` header required on every unsafe method for session auth |
| Malicious upload | Get a crafted file parsed/served/executed as something else | `cv_upload.validate_cv`: extension + magic-byte check, 5 MB cap, never executed, never served back verbatim |
| Any client | Exhaust server resources (large bodies, request floods) | `BodySizeLimitMiddleware` (1 MB default / 5 MB CV), `RateLimitMiddleware` (120/min/IP on unsafe methods), per-user live-search limit (30/min) |
| Network attacker | Read cookies/tokens in transit, clickjack the SPA, inject scripts | HSTS, `Secure` session/CSRF cookies in production, CSP (`frame-ancestors 'none'`, same-origin `script-src`/`connect-src`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| Operator / on-call | Diagnose an incident without touching PII | Structured JSON logs keyed by `request_id` (never the query string); optional Sentry with a `before_send` scrubber (no request body, cookies, headers or query string) |
| Shared/browser cache | Cache a response that contains one user's data | `Cache-Control: no-store` whenever the request carried the session cookie |

Non-goals for this issue (out of scope: `apps/api only + vercel.json`, see "Open items" below):
`apps/worker`/`apps/crawler` observability, CI dependency scanning, backups, and the breach-notification
runbook.

## 2. Controls in place

### Authentication & sessions
- OTP codes: 6 digits, HMAC-SHA256-hashed at rest (never the raw code), 10-minute TTL, 5 max
  verify attempts, timing-safe comparison (`hmac.compare_digest`). Per-email (1/60s, 5/hour, DB-backed)
  and per-IP (20/hour, in-memory) limits on send (`auth/otp.py`).
- Sessions: 32 random bytes, sha256-hashed in the DB, `HttpOnly`, `Secure` in production,
  `SameSite=Lax` (`auth/session.py`).
- CSRF: double-submit cookie, required on every POST/PUT/PATCH/DELETE behind `current_user`
  (`auth/csrf.py`); enforced with `hmac.compare_digest`, not `==`.

### Rate limiting (`ujc_api.rate_limit`, reusing `auth.ratelimit.SlidingWindowRateLimiter`)
- **Generic, per IP, all unsafe methods** (`RateLimitMiddleware`): 120 requests/minute. Runs as
  ASGI middleware *ahead of routing*, so an attacker never reaches auth/CSRF/DB layers once
  limited. 429 body is `{"error": {"code": "rate_limited", ...}}` with `Retry-After: 60`.
- **Live search, per user** (`GET /api/search/live`): 30/minute — it fans out to live
  third-party sources per call, far more expensive than a normal read. 429 with `Retry-After: 60`.
- Both are on top of, not instead of, the existing endpoint-specific limits (OTP send, etc.) in
  `docs/product/ARCHITECTURE.md` §9.
- Same in-memory, single-process caveat as the existing OTP IP limiter: exact on one long-running
  instance, undercounts across multiple instances/cold starts. Acceptable at current scale; move
  to Postgres/Redis if/when scaling out (see `auth/ratelimit.py`'s docstring).

### Request size limits (`ujc_api.body_limit`)
- 1 MB default for every route's body, checked against `Content-Length` before the body is read
  and enforced again while streaming a chunked body (no `Content-Length`).
- 5 MB for `POST /api/cvs` only (`CV_UPLOAD_MAX_BYTES`, matching `cv_upload.MAX_CV_BYTES`, which
  still re-checks the limit itself after assembling the upload).
- 413 body: `{"error": {"code": "payload_too_large", ...}}`.

### Security headers
- **API responses** (`SecurityHeadersMiddleware`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` on every response;
  `Cache-Control: no-store` added whenever the request carried the session cookie (i.e. the
  response may contain user-specific data).
- **Static SPA** (`vercel.json` `headers`, mirroring `deploy/Caddyfile` for the Docker deploy so
  both paths behave the same):
  - `Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://*.googletagmanager.com; frame-src https://www.googletagmanager.com; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
    - The Google hosts are for Google Tag Manager (`GTM-WSR78ZW4`, loaded in `apps/web/src/app/layout.tsx`) and the GA4 tag it fires, per Google's CSP guide for GTM + GA4. A tag added in GTM that loads from any other host is blocked until it is added here and in `deploy/Caddyfile`.
    - `'unsafe-inline'` for scripts is required: the Next.js static export inlines its RSC bootstrap (`self.__next_f.push(...)`) and a static host cannot add per-request nonces. Tracked as an open item (hash-based CSP generated at build time).
    — same-origin only (the SPA calls the API same-origin in production); `'unsafe-inline'` on
    `style-src` only (Tailwind's generated stylesheet is same-origin; inline styles come from
    React/Next's own runtime). No nonce: static export (`output: 'export'`) can't run a
    per-request proxy to mint one, per the Next.js CSP guide.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Observability
- Structured JSON logs (`ujc_api.logging`): one line per request with `request_id`, `method`,
  `path` (never the query string), `status`, `duration_ms`.
- Every response — success, handled `HTTPException`, validation error, or unhandled exception —
  carries the same `X-Request-ID` it was logged with, so a client-reported error can be grepped
  straight out of the logs.
- Unhandled exceptions are logged (`log.exception`, full traceback server-side only — never in
  the response body) with `request_id` as a structured field, not just interpolated into the
  message.
- `GET /api/ready` (pre-existing): 503 on unreachable DB or pending migrations; `GET /api/health`
  is a plain liveness check.
- **Sentry decision**: `sentry-sdk[fastapi]` is now a dependency (`apps/api/pyproject.toml`,
  `api/requirements.txt`) — its resolved footprint is two small pure-Python packages
  (`sentry-sdk`, `urllib3`), negligible for the Vercel function bundle. `ujc_api.observability.init_sentry`
  is a no-op unless `SENTRY_DSN` is set, so it costs nothing by default (not even an import) and
  is the right tradeoff: Sentry adds error grouping/alerting across requests and processes that a
  local JSON log stream can't give you, while the JSON logs remain the source of truth and keep
  working with zero configuration. PII scrubbing: `send_default_pii=False` plus a `before_send`
  hook that drops the event's request body, cookies, headers and query string — only the method,
  path and exception survive, matching the "never log emails, CV text, cookies or tokens" rule.

### Contributor feedback (`/api/feedback`, ARCHITECTURE.md D12)
- **Admin role, server-side only.** `users.role` (`'user'`/`'admin'`, migration 021) or
  `UJC_ADMIN_EMAILS`, evaluated on every request (`ujc_api.auth.admin`), never cached in the
  session, never from a personal access token. Every admin action (`PATCH`, notes, `scope=all`
  list, deleting someone else's item) returns 403 for non-admins; `/api/me`'s `role` only drives
  what the SPA shows. First admin: env list or `python -m ujc_api.admin grant <email>`. No
  passwords, no seeded accounts.
- **Visibility.** New / under-review / rejected items are visible to their author and admins
  only (404 to everyone else). Page URL, selector, element text, region, screenshot and user agent
  are returned only to the author and admins, even for approved items; author identity only to
  admins.
- **Validation.** Pydantic models with `extra="forbid"` (clients cannot set status, author or
  reviewer), length caps mirrored by DB CHECK constraints, NUL bytes rejected, page URLs limited to
  http(s) or root-relative paths (no `javascript:`, `data:`, `//host`, `/\host`, credentials).
  10 submissions per author per hour, counted in Postgres under an advisory lock.
- **Screenshots.** JPEG/PNG/WebP data URL, at most 1.5 MB decoded; the stored type comes from
  magic bytes, not the client. `POST /api/feedback` may carry a 2.2 MB body (`body_limit.py`); every
  other route keeps 1 MB. Served only to the author/admins from
  `GET /api/feedback/{id}/screenshot` with `nosniff`, `Cache-Control: private, no-store`,
  `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy:
  same-origin`. The widget leaves out its own UI, password inputs and anything marked
  `data-contrib-exclude`.
- **XSS.** All feedback text is rendered as React text (no `dangerouslySetInnerHTML`); page URLs
  become links only after `safeHref` re-checks the scheme, with `rel="noopener noreferrer
  nofollow"`.
- **CSP: unchanged.** The screenshot preview is a `data:` image and stored screenshots load from
  the same origin, both already allowed by `img-src 'self' data:`; html-to-image renders the DOM
  locally (no new script, style or connect origins). Verified in Chrome against the exact
  `vercel.json` headers.
- **Privacy.** Account deletion cascades to the user's feedback, screenshots and votes;
  `GET /api/me/export` includes the feedback they sent (without screenshot bytes).

### Already covered elsewhere (unchanged by this issue)
- Consent, data export, account deletion, CV retention: M5-04 (`routers/me.py`
  `/api/me/consent`, `/export`, `DELETE /api/me`).
- CI (lint/typecheck/tests/build/migrations): M5-01 (`.github/workflows/ci.yml`).
- Docker images + Caddy headers + compose stack: M5-02 (`deploy/`).

## 3. Open items (not in this issue's scope)

- [ ] `pip-audit` and `pnpm audit --prod` (fail on high) in CI; `bandit` for `apps/api`; Dependabot.
- [ ] `apps/worker` observability: per-task structured logs (kind, duration, outcome, LLM tokens);
      optional Sentry for worker/crawler.
- [ ] `GET /api/ready` reporting worker heartbeat age (503 if stale).
- [ ] `deploy/backup.sh` (pg_dump, 14-day rotation) + `docs/ops/RUNBOOK.md` (restore drill, key
      rotation, incident response, 72 h breach notification).
- [ ] Strict Pydantic models (`extra='forbid'`) across request bodies.
- [ ] Job descriptions stripped of HTML server-side before being returned (stored-XSS hardening);
      today the web app never uses `dangerouslySetInnerHTML`, so this is defense in depth, not a
      currently-exploitable gap.
- [ ] gitleaks in CI; gitleaks/secret-scanning on `.env*`.
- [ ] Audit log for security-relevant events (login, logout, consent changes, deletion).
