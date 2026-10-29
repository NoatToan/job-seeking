# apps/api — ujc_api

FastAPI backend for the Unified Job Crawler. Plain SQL with `psycopg` (no ORM), a Postgres-backed
task queue (added in M1-07), and no in-process dependency on `apps/web`. See
`docs/product/ARCHITECTURE.md` for the full contract (endpoints, tables, env vars).

## Setup

```bash
cd apps/api
uv sync
```

This also installs `job_crawler` (from `../crawler`) as an editable path dependency, so the
sources/eligibility/matching code is reused, not duplicated.

## Run

```bash
uv run uvicorn ujc_api.main:app --reload --port 8000
```

Requires `DATABASE_URL` in the environment (or a repo-root `.env.local` in development — see
`.env.example`). `GET /api/health` is a plain liveness check; `GET /api/ready` also checks the
database and that every migration has been applied. OpenAPI docs (`/api/docs`,
`/api/openapi.json`) are served unless `UJC_ENV=production`.

## Migrate

```bash
uv run python -m ujc_api.migrate
```

Applies every `db/migrations/*.sql` file not yet recorded in `schema_migrations`, in name order,
one transaction each. Uses the same table as `scripts/migrate.mjs`, so either runner can be used
against a given database without repeating the other's work.

## Test

```bash
uv run pytest
```

Tests that do not need a database (settings, health, error-format, request-id/access-log
middleware, migration ordering against a fake connection) always run. Tests that need a real
database (`GET /api/ready` against a working DB, applying migrations 001-006 end to end) read
`TEST_DATABASE_URL` and are **skipped with a clear message** if it is unset:

```bash
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/ujc_test
uv run pytest
```

Each test session creates a throwaway Postgres schema, applies every migration into it, and drops
it afterwards — the real `public` schema is never touched.

## Lint

```bash
uv run ruff check .
uv run ruff format --check .
```
