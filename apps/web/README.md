# apps/web

Next.js 16 **static-export SPA** (`output: 'export'`). No database access and no server code: every
page is a client component that fetches from `apps/api` (contract: `docs/product/ARCHITECTURE.md` §3
and §5). There are no dynamic route segments — detail pages use query params, e.g.
`/jobs/view?id=123`.

## Develop

```bash
pnpm install                                   # from the repo root
cp .env.example .env.local                     # optional: set NEXT_PUBLIC_API_BASE_URL
pnpm --filter web dev                          # http://localhost:3000
```

`apps/api` does not exist yet (it lands in M1-01), so `NEXT_PUBLIC_API_BASE_URL` can stay unset
during local SPA development; the jobs page shows its error state until a backend is reachable.
Once the API is running (default `http://localhost:8000`), set:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

`localhost:3000` and `localhost:8000` are the same site, so `SameSite=Lax` session/CSRF cookies are
sent on API calls (`src/lib/api.ts`'s `apiFetch` always sends `credentials: 'include'`).

## Test

```bash
pnpm --filter web test        # vitest, no network: fetch is mocked in every test
```

## Build

```bash
pnpm --filter web build       # next build -> apps/web/out/ (static HTML/CSS/JS)
pnpm --filter web typecheck   # next typegen && tsc --noEmit
pnpm --filter web lint
```

`out/` is served by any static host; in production, Caddy serves it at `/` and proxies `/api/*`
to `apps/api` (see `docs/product/ARCHITECTURE.md` §4/§11). There is no `next start` in production.

## Layout

| Path | What |
|---|---|
| `src/app/layout.tsx` | App shell: nav placeholders (profiles, connections — later milestones), footer with source attributions |
| `src/app/page.tsx`, `src/app/jobs-browser.tsx` | Public jobs page: search, source filter, remote toggle, pagination (state in the URL via `useSearchParams`), source status strip, loading/empty/error states |
| `src/app/jobs/view/page.tsx`, `job-view.tsx` | Job detail by `?id=` |
| `src/lib/api.ts` | Typed fetch client (`apiFetch`, `ApiError`, `getJobs`/`getJob`/`getSources`) |
| `src/lib/use-api.ts` | Minimal `useApi(fn, deps)` data hook (loading/error/data/reload) |

**Data fetching:** a small hand-rolled `useApi` hook, not TanStack Query — the SPA only needs
one-shot `GET` requests on a handful of pages at this milestone, so a dependency-free hook keeps
the bundle and the dependency list smaller. Revisit this if a later milestone needs polling,
caching across routes, or request deduplication (task polling already has its own documented
interval in ARCHITECTURE §3).
