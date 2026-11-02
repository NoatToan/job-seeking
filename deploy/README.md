# Self-hosted stack (deploy/)

This is the reference production target (docs/product/ARCHITECTURE.md §11 "Deployment"). Vercel
stays the review/preview host; this stack is for self-hosting the app on your own machine or
server with Docker.

Services (`deploy/compose.yml`): `postgres`, a one-shot `migrate`, `api` (FastAPI/uvicorn), and
`web` (the static export, served by Caddy, which also proxies `/api/*` to `api`). The **worker**
(CV scanning) is intentionally not a container — see "Worker" below.

## Up

```bash
cp deploy/.env.example deploy/.env   # fill in POSTGRES_PASSWORD, DATABASE_URL, UJC_SECRET_KEY
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
curl -f http://localhost:8080/api/health
curl -f http://localhost:8080/
```

Run `docker compose -f deploy/compose.yml config` first if you want to see the fully-resolved
config (including which required variables are missing) without starting anything.

Builds run from the repo root as the Docker build context (both Dockerfiles need sibling
directories: `apps/api` needs `apps/crawler` and `apps/mcp`; `apps/web` needs `packages/core` and
`packages/ui`), so always pass `-f deploy/compose.yml` from the repo root rather than `cd`-ing
into `deploy/`.

`migrate` applies every `db/migrations/*.sql` file not yet recorded in `schema_migrations` (same
table and ordering as `scripts/migrate.mjs`), then exits; `api` only starts once `migrate`
completes successfully.

## Down

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env down      # keep the postgres volume
docker compose -f deploy/compose.yml --env-file deploy/.env down -v   # also delete all data
```

## Environment

See `deploy/.env.example` for the full list of names. At minimum you must set
`POSTGRES_PASSWORD`, `DATABASE_URL` (pointed at the `postgres` service, same password) and
`UJC_SECRET_KEY` (`openssl rand -hex 32`). `deploy/.env` is gitignored; never commit it.

## Worker (CV scanning)

The worker runs `claude -p` (the owner's logged-in Claude Code CLI, not an API key), so it cannot
run unattended inside this container stack. Run it on any host that has the `claude` CLI
installed and logged in, pointed at this stack's Postgres:

1. Give the worker's machine a way to reach `postgres`: add a `ports` mapping (e.g. the host's
   `5432`) to the `postgres` service in `deploy/compose.yml`, or run the worker on the same
   Docker host so it can use the compose network's `localhost` port mapping.
2. From `apps/api`, set `DATABASE_URL` to the same value configured for the stack, with its host
   part changed from `postgres` (the in-network service name) to the address the worker's machine
   can actually reach, then run:

```bash
cd apps/api
uv sync
uv run python -m ujc_api.worker
```

See `apps/api/README.md` ("Host worker (CV scanning)") for `--once`, retries, and the macOS
launchd service wrapper (`apps/api/scripts/worker-service.sh`).

## Backups

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
```

Keep 14 days of daily dumps (docs/product/ARCHITECTURE.md §11). Restore drill:

```bash
gunzip -c backup-2026-01-01.sql.gz | \
  docker compose -f deploy/compose.yml --env-file deploy/.env exec -T postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

Test the restore against a scratch database/volume before relying on it, not the live one.
