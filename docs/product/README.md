# Product docs: job-seeking for individual users

| Doc | What it answers |
|---|---|
| [PRD.md](./PRD.md) | Who it is for, goals, scope in/out, features with acceptance criteria, legal constraints, production-readiness checklist |
| [E2E_FLOW.md](./E2E_FLOW.md) | The end-to-end user journey: screens, states, error cases, sequence diagrams |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | SPA + FastAPI + Postgres design, API endpoints, migrations, platform connection model, Upwork/MCP plan, LLM provider, environment variable names |
| [backlog.json](./backlog.json) | 30 issues (M1–M5), each sized for one PR, with dependencies and parallel lanes |

Agents: `.claude/agents/ba-analyst.md` (refines these docs and the backlog) and
`.claude/agents/feature-engineer.md` (implements one backlog issue per PR).

## Key decisions (short)
- **SPA**: Next.js 16 static export (`output: 'export'`) that calls the API only. The pages call no database
  and run no server code.
- **Backend**: FastAPI in `apps/api` reuses `apps/crawler` (`job_crawler`) as a library. Background tasks use a
  Postgres queue plus a worker. Postgres is the only datastore.
- **Platforms**: public sources are always on. Adzuna can optionally use the user's own key. LinkedIn, Seek,
  Glassdoor and Arc go through a **companion runner** on the user's machine, so cookies never reach the server.
- **Upwork**: users get Upwork through Upwork's **official MCP server** in their own Claude, plus a deep link.
  After API key approval there is also an in-app, user-directed live search with a 24 h cache. That search
  never runs on a schedule and its results never go to AI scoring (Upwork API Terms §4.1, §5.3, §8.3).
- **Our MCP**: `apps/mcp` exposes the user's unified results and tracker to their Claude, using a personal
  access token.
- **Hosting**: no Vercel for now. Docker compose (Caddy + api + worker + Postgres) is the reference target.

## Milestones

| Milestone | Issues | Outcome |
|---|---|---|
| M1 Backend API foundation | M1-01 … M1-07 | Accounts, owner-scoped data, profiles and jobs API, task queue |
| M2 SPA | M2-01 … M2-03 | Static SPA: browse, auth, profiles, unified results |
| M3 Platforms (incl. Upwork & MCP) | M3-01 … M3-08 | Connections page, Adzuna key, per-user search runs, runner pairing + CLI, Upwork client/OAuth/live search, `ujc` MCP |
| M4 Matching & tracking | M4-01 … M4-08 | LLM provider, CV upload, fit scoring, tracker, onboarding, daily digest |
| M5 Production hardening | M5-01 … M5-04 | CI, Docker/compose + e2e, security & observability, privacy & data rights |

## Two engineers in parallel

`parallel_group` in `backlog.json` is a **lane**. Lanes own disjoint directories, so issues in different lanes
can be built at the same time without touching the same files. Issues in the same lane run one after the
other.

| Lane | Owns | Typical owner |
|---|---|---|
| A | `apps/api` routers, repos, schemas, auth | Engineer 1 |
| E | `apps/api/src/ujc_api/tasks/**`, `worker.py`, task handlers | Engineer 1 or 2 (new files only) |
| B | `apps/web/**`, `packages/core`, `packages/ui` | Engineer 2 |
| C | `apps/crawler/**` library code, `apps/mcp/**` | whoever is waiting on a dependency |
| D | `.github/**`, `deploy/**`, Dockerfiles, `e2e/**` | either |

**Start first, in parallel:** `M1-01` (scaffold `apps/api`, lane A) and `M2-01` (SPA conversion, lane B).
They share no files: M1-01 touches only `apps/api/**`, and M2-01 touches only `apps/web/**` and
`packages/core/**`.

Suggested waves (E1 = engineer 1, E2 = engineer 2):

| Wave | E1 | E2 |
|---|---|---|
| 1 | M1-01 | M2-01 |
| 2 | M1-02 | M5-01 (CI), then M3-03 |
| 3 | M1-04, M1-03 | M2-02, M4-01 |
| 4 | M1-05, M1-06 | M1-07 (lane E), M2-03 |
| 5 | M3-01, M3-06 | M3-07 (C), M3-08 (C) |
| 6 | M4-02, M4-05 | M3-05 (E), M3-02 |
| 7 | M4-03 (E), M3-04 | M4-04, M4-06 |
| 8 | M4-08 (E), M5-04 | M4-07, M5-02 |
| 9 | M5-03 | review / bug fixes |

Web issues build against the API **contract** in ARCHITECTURE §5, with mocked fetch in tests. So a web issue
can merge before its API issue, but end-to-end use waits for both.

**Migrations**: every issue that adds a migration uses the number reserved in ARCHITECTURE §4 (007–017).
Never renumber an existing one, and never edit a migration that has already merged. Add a new one instead.

## How we work

1. **Issue.** Each backlog item becomes a GitHub issue in `NoatToan/job-seeking`:
   - title = `title`, body = `body`, labels = `labels`, milestone = `milestone`;
   - after creation, replace the dependency keys with the issue numbers;
   - create issues via the GitHub REST API with `curl` (see the team's rules), not `gh`.
2. **Branch.** `feat/<key>-<slug>` from an up-to-date `main`, e.g. `feat/m1-01-api-scaffold`. Use one
   worktree per topic (`../job-seeking-wt-<topic>`).
3. **Build.** Implement exactly one issue. Keep the diff focused, with no drive-by refactors.
4. **PR.** Title `[M1-01] Scaffold apps/api ...`. The body contains:
   - a summary;
   - `Closes #<n>`;
   - the acceptance-criteria checklist ticked, with evidence (test names, command output);
   - screenshots for UI;
   - migration notes;
   - new environment variable names;
   - risks.
5. **Review.** CI must be green and one approving review is required: Tony, or the other engineer plus Tony
   for security-labelled issues. Address comments with new commits; we squash on merge.
6. **Merge.** Squash-merge into `main`. Delete the branch and remove the worktree once `main` builds and passes
   its tests.
7. **No deploys.** Don't deploy to Vercel or anywhere else until Tony says so. The code lives on GitHub.

## Definition of Done (every PR)
- [ ] Every acceptance criterion in the issue is met, and each one is shown by a test or by evidence in the PR.
- [ ] Tests added or updated:
  - Python: `uv run ruff check .`, `uv run ruff format --check .` and `uv run pytest` pass in each touched app.
  - Web: `pnpm lint`, `pnpm typecheck`, `pnpm --filter web test` and `pnpm --filter web build` (static export)
    pass.
- [ ] Owner-scoped endpoints have a cross-user 404 test. New inputs are validated, and limits are documented.
- [ ] No secrets, tokens, cookies, CV text or emails in code, logs, fixtures or the PR. `.env*` files are never
      committed. New variables are added by **name** to `.env.example` and to ARCHITECTURE §10.
- [ ] Platform rules respected:
  - no CAPTCHA bypass or fingerprint spoofing;
  - no server-side platform cookies;
  - Upwork data is never polled, never stored past 24 h and never sent to an LLM;
  - source attribution is visible.
- [ ] Docs updated in the same PR when a contract changes: ARCHITECTURE (endpoints, tables, variables), the
      app README (commands), and E2E_FLOW (screens and states).
- [ ] pnpm only for JS (no npm, npx or yarn); uv only for Python.
- [ ] The PR description follows the template above and links the issue with `Closes #n`.
