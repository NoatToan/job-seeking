# PRD: job-seeking for individual users

Owner: Tony (PO). Author: BA agent. Date: 2026-10-29. Status: proposed.
Related: [E2E_FLOW.md](./E2E_FLOW.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [backlog.json](./backlog.json)

## 1. Problem

A developer looking for work (for example a Vietnamese Next.js engineer who wants a remote job or relocation)
has to search many places. Those include public remote boards, company ATS pages, Adzuna, LinkedIn, Seek,
Glassdoor, Arc and Upwork. Each has different filters, and remote jobs often silently exclude the candidate's
country. Today our tool works for **one operator** at the command line and on a public, single-tenant web page.
We want any individual to open the web app, connect the platforms they use, search everything at once, see which
jobs fit their CV and why, and track what they applied to. All of this must stay within each platform's rules.

## 2. Personas

| Persona | Context | Needs |
|---|---|---|
| **Linh, mid-level frontend dev in Ho Chi Minh City** (primary) | Wants remote (open to Vietnam/APAC) or relocation with visa. Has LinkedIn, no Upwork. Reads English, prefers Vietnamese explanations. | One list of jobs she is actually eligible for, CV fit scores with reasons and missing skills, a daily email of new good matches. |
| **Minh, freelance full-stack dev** | Mixes contract work (Upwork) with full-time remote roles. Uses Claude Desktop daily. | Upwork results next to other sources (clearly separated), and the ability to ask Claude "find me Next.js contracts this week" using his own accounts. |
| **Sarah, senior engineer in Sydney** | Local roles on Seek and LinkedIn plus remote AU roles. Privacy-conscious. | Her LinkedIn/Seek logins never leave her laptop; can delete all her data at any time. |
| **Operator (Tony)** | Runs one deployment for themselves and a few friends. | Simple ops (one compose stack), predictable Claude cost, no legal exposure from scraping or ToS breaches. |

Out of persona scope: recruiters, companies, teams and agencies. There are no shared workspaces.

## 3. Goals and success metrics (MVP)

| Goal | Metric (first 30 days after launch on a real host) |
|---|---|
| G1. New users get to useful results fast | Median time from sign-up to first results page under 10 min; 70% of sign-ups create a profile |
| G2. Results are relevant and eligible | ≥ 60% of a user's top-10 scored jobs rated "relevant" (thumbs up/down on the card, M4-04); < 5% of shown remote jobs exclude the user's country |
| G3. Users come back | ≥ 40% of active users open a digest or the app on ≥ 3 days a week |
| G4. Compliance | 0 Upwork terms violations (no Upwork data in `jobs`, digests or LLM prompts), 0 server-side platform cookies, data deletion completes in < 1 min |
| G5. Production quality | CI green on `main`, ≥ 80% line coverage on `apps/api`, p95 API latency < 500 ms for list endpoints at 100k jobs |

## 4. Scope

### In scope (MVP, milestones M1–M5)
1. Accounts: email + password sign-up, email verification, login/logout, password reset, change password, account deletion, data export.
2. Search profiles per user (keywords in web-search syntax, locations, remote-only, sources, "I'm based in" country), up to 20.
3. Unified results per profile across public sources, Adzuna, the user's runner-crawled sites, with source badge, eligibility ("open to") label, filters, pagination.
4. Platform connections page: public sources (info only), Adzuna (optional own key), Upwork (official MCP instructions + deep link now; OAuth live search after API key approval), companion runner for LinkedIn/Seek/Glassdoor/Arc.
5. CV upload (PDF, DOCX later, TXT/MD, PNG/JPG), extraction to a structured profile, consent for AI processing.
6. CV fit scoring (0–100, summary, reasons, missing skills) for a profile's top candidate jobs, with per-user daily quota.
7. Application tracker: save, applied, interviewing, offer, rejected, withdrawn, hidden; notes; next action date; history.
8. Daily email digest of new jobs above a score threshold, with one-click unsubscribe.
9. `ujc` MCP server so a user's own Claude can search their unified results and update the tracker; documentation for adding Upwork's official MCP alongside.
10. Production hardening: CI, Docker compose, security controls, privacy controls, observability, backups.

### Out of scope (MVP)
- Auto-apply, form autofill, cover-letter generation, sending messages to employers or Upwork clients.
- Browser extension. Mobile app (the Expo app reuses `packages/ui` later).
- Social login (Google/LinkedIn OAuth for sign-in), 2FA (planned post-MVP; design sessions so TOTP can be added).
- Teams, recruiters, sharing profiles, payments/subscriptions.
- Server-side crawling of LinkedIn/Seek/Glassdoor/Arc, CAPTCHA solving, fingerprint spoofing, proxies, fake accounts.
- Scheduled/background Upwork polling, AI scoring of Upwork jobs, Upwork data in digests.
- Vercel deployment (keep on GitHub; Docker compose is the reference target).
- Elasticsearch (Postgres FTS is enough; see root README).

## 5. Features and acceptance criteria

Each feature maps to backlog issues (keys in brackets). Issue bodies hold the implementation-level criteria.

### F1. Account & session [M1-02, M1-03, M2-02]
- [ ] A visitor can register with email + password (≥ 10 chars, not in common list) and must tick Terms + Privacy; duplicate email returns a generic error without revealing whether the account exists on login/forgot flows.
- [ ] After register the user is signed in and sees a banner "Verify your email"; verification link valid 24 h, single use.
- [ ] Login with wrong password 5 times per email per minute returns 429 with `Retry-After`.
- [ ] Forgot password always answers "If an account exists, we sent a link"; reset link valid 1 h, single use, signs out all sessions.
- [ ] Session lasts 30 days sliding; logout invalidates it server-side.
- [ ] Every state-changing request without a valid CSRF token gets 403.

### F2. Search profiles [M1-05, M2-03]
- [ ] User can create, edit, delete profiles (name ≤ 80, keywords ≤ 300 in web-search syntax, ≤ 10 locations, remote-only, sources subset, candidate country defaulting to the account country).
- [ ] A user never sees or modifies another user's profile (404).
- [ ] Deleting a profile deletes its matches and links, not the shared jobs.

### F3. Unified results [M1-06, M2-01, M2-03, M3-05]
- [ ] Profile results show jobs from every selected source with a source badge, company, location, remote flag, "open to" label, posted date, salary when known.
- [ ] Remote jobs that clearly exclude the candidate country are hidden; unknown eligibility is shown with an "eligibility unknown" hint.
- [ ] Filters: text, source, remote, min score, application status; sort by score (when scored) then relevance then date; 50 per page.
- [ ] "Run search now" enqueues a per-profile search; the page shows progress and refreshes when done; repeated clicks while running are idempotent.
- [ ] Jobs fetched by the user's runner are visible only to that user.
- [ ] Empty state explains how to widen the search and links to Connections.

### F4. Platform connections [M3-01, M3-02, M3-04, M3-06, M3-07, M3-08]
- [ ] `/connections` lists every platform grouped by kind (Built-in, API key, Upwork, Runner) with a clear status: Always on / Connected / Not connected / Needs attention / Coming soon.
- [ ] Adzuna: user can save their own app id/key; the key is verified with a test call before saving and is never shown again (only last 4 chars).
- [ ] Runner: user generates a pairing code (10 min), runs one command on their machine, and sees the runner as Paired with last-seen time and per-site login status; can revoke it.
- [ ] Upwork (before key approval): card explains "Use Upwork in Claude" (official MCP setup steps) and "Search on Upwork" deep link with the profile keywords.
- [ ] Upwork (after approval, `UPWORK_ENABLED`): Connect via Upwork OAuth; "Search Upwork now" on a profile shows a separate "Upwork (live)" panel attributed to Upwork, results expire after 24 h, no AI score; Disconnect revokes and deletes tokens and cache.
- [ ] MCP: user can create a personal access token (shown once) and copy a ready-made Claude config for the `ujc` MCP server.

### F5. CVs [M4-01, M4-02, M4-04]
- [ ] Upload PDF/TXT/MD/PNG/JPG ≤ 5 MB (type checked by magic bytes); user must tick "Send my CV to Anthropic (USA) for analysis" before upload.
- [ ] Extraction runs in background; the CV card shows Extracting → Ready (headline, seniority, skills, target titles) or Failed with a reason and Retry.
- [ ] Original file is not stored; user can delete a CV, which deletes its text, extracted profile and matches immediately.
- [ ] CVs unused for `UJC_CV_RETENTION_DAYS` are deleted automatically with an email notice 7 days before.

### F6. Fit scoring [M4-03, M4-04]
- [ ] "Score with CV X" on a profile scores up to 60 prefiltered jobs; progress visible; results show score badge, one-line summary, reasons (in the user's locale), missing skills.
- [ ] Daily per-user quota enforced with a clear message and reset time; Upwork jobs are never sent.
- [ ] A Claude failure on one batch does not lose the others; failed batches are reported.

### F7. Application tracker [M4-05, M4-06]
- [ ] Save any job (including an Upwork live result as a snapshot, or a manual entry with URL/title/company) to the tracker.
- [ ] Change status by drag-and-drop (board) or select (list); each change is recorded with timestamp; notes and next-action date editable.
- [ ] Hidden jobs disappear from results for that user.
- [ ] Result cards show the application status badge.

### F8. Onboarding [M4-07]
- [ ] First login redirects to `/onboarding` until completed or skipped: 1) Where are you based + timezone + language, 2) Upload a CV (skippable), 3) First search profile (prefilled from CV target titles/skills), 4) Connect platforms (skippable), 5) Run first search → lands on results.
- [ ] Progress is saved per step; refreshing resumes at the same step.

### F9. Daily digest [M4-08]
- [ ] At the user's chosen local hour, if there are new (first seen since last digest) non-Upwork jobs scoring ≥ threshold (or, without CV, top 10 relevance), send one email with up to 10 jobs, each with source and link.
- [ ] No email when nothing new (recorded as skipped). One-click unsubscribe works without login.

### F10. Privacy & account data [M5-04]
- [ ] Settings → Privacy: download all my data (JSON), delete my account (password confirm), withdraw AI consent (stops scoring, deletes CV text).
- [ ] Privacy notice page explains data collected, purposes, cross-border transfer (Anthropic/USA, hosting location), retention, rights and contact.

## 6. Non-functional requirements
- Performance: list endpoints p95 < 500 ms at 100k jobs and 1k profiles; SPA first load < 250 KB JS gzipped for `/`.
- Availability: single-region, best effort; health/readiness endpoints; worker restarts safely (tasks are idempotent and retryable).
- Accessibility: WCAG 2.2 AA for core flows (labels, focus order, contrast, keyboard drag alternative on tracker).
- i18n: UI English first; strings kept in one module per screen so Vietnamese can be added; Claude reasons follow `users.locale`.
- Browsers: last 2 versions of Chrome, Edge, Safari, Firefox; responsive down to 360 px.

## 7. Legal & platform constraints (must hold in every release)
- **Upwork API & MCP Terms**: user-directed search only; cache ≤ 24 h; attribution; no AI processing of Upwork content; no scraping; no competing-marketplace features. Key approval required before in-app search. See ARCHITECTURE §7.
- **LinkedIn/Seek/Glassdoor/Arc**: personal, low-volume crawling in the user's own browser via the runner only; no CAPTCHA bypass; users are told their account could be restricted (consent checkbox when pairing the runner).
- **Remotive**: few calls per day, link back and name the source. **Adzuna**: attribution on Adzuna results.
- **Vietnam Law on Personal Data Protection No. 91/2025/QH15** (effective 2026-01-01; Decree 356/2025/ND-CP): explicit, specific consent per purpose (account, AI processing, emails); data-subject rights (access, correction, deletion, consent withdrawal); cross-border transfer impact assessment filed with the Ministry of Public Security (A05) within 60 days of first transfer (CV text to Anthropic in the USA, hosting abroad); breach notification within 72 h of detection. Operator task, tracked in M5-04.
- **Australia Privacy Act 1988 (APPs)**: privacy policy (APP 1), collection notice (APP 5), cross-border disclosure (APP 8), security and destruction when no longer needed (APP 11), access/correction (APP 12/13), Notifiable Data Breaches scheme. Treat as applicable even if the small-business exemption might apply.

## 8. Production readiness checklist

### Security
- [ ] Passwords argon2id; no password or token ever logged; session/PAT/runner/email tokens stored as sha256 hashes only.
- [ ] Session cookie HttpOnly, Secure, SameSite=Lax; CSRF double-submit on unsafe methods; logout and password change revoke sessions.
- [ ] CORS closed in production (same origin); dev allowlist only.
- [ ] Rate limits on login, register, forgot-password, CV upload, runner results, Upwork search, LLM tasks (per-user quotas).
- [ ] Security headers at Caddy: strict CSP (`default-src 'self'`; `connect-src 'self'`), `frame-ancestors 'none'`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`.
- [ ] Uploads: size limit, magic-byte type check, parsed in a temp dir, never served back, never executed.
- [ ] Every owner-scoped endpoint has a cross-user 404 test.
- [ ] Third-party credentials (Upwork tokens, Adzuna keys) encrypted at rest with rotatable keys; secrets only in env / secret store; `.env*` git-ignored; gitleaks in CI.
- [ ] Dependency audit (`pip-audit`, `pnpm audit --prod`) in CI; Dependabot enabled.
- [ ] Audit log for security-relevant events; admin can read it via SQL.
- [ ] Outbound URLs from runner uploads validated against site domain allowlists; job descriptions rendered as text (no `dangerouslySetInnerHTML`).

### Privacy (PDPL 91/2025, AU Privacy Act)
- [ ] Consents recorded with version + timestamp: terms, privacy, AI processing, digest email; withdrawal supported.
- [ ] Data export (JSON) and account deletion (cascade) self-service; deletion also purges Upwork cache, runner tokens, sessions.
- [ ] CV retention: original file never stored; text deleted with CV/profile/account, on consent withdrawal, and after `UJC_CV_RETENTION_DAYS` unused.
- [ ] Privacy notice and Terms pages linked from sign-up and footer.
- [ ] Cross-border transfer impact assessment drafted and filed (operator); breach-response runbook with 72 h notification.
- [ ] Logs contain user ids, not emails or CV text; log retention 30 days.

### Operations
- [ ] Docker images for api/worker (python:3.12-slim, non-root, uv-installed, pinned lockfile) and Caddy serving the static SPA.
- [ ] `docker compose up` brings up postgres, migrate, api, worker, web; migrations run as a one-shot before api/worker.
- [ ] `/api/health` (liveness) and `/api/ready` (DB + migrations) wired into compose health checks.
- [ ] Structured JSON logs with request id; worker logs task id/kind/duration/outcome; optional Sentry.
- [ ] Daily `pg_dump` backups, 14-day retention, restore tested and documented.
- [ ] Graceful shutdown: worker finishes or releases its current task on SIGTERM.

### CI / quality
- [ ] On every PR: pnpm lint + typecheck + build (web static export), vitest for web; ruff + pytest for crawler, api, mcp (with Postgres service); migrations applied from scratch.
- [ ] Playwright smoke (sign up → create profile → results) against the compose stack.
- [ ] Branch protection on `main`: CI green + 1 review; squash merge.
