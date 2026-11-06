-- Indexes from the DB audit (docs/product/PERFORMANCE.md). Each one is backed by an EXPLAIN
-- (ANALYZE, BUFFERS) on a seeded 80k-job database; before/after numbers are in that doc.
--
-- Plain CREATE INDEX (not CONCURRENTLY): scripts/migrate.mjs runs every file inside a
-- transaction, where CONCURRENTLY is not allowed. On today's ~5-10k jobs each build takes well
-- under a second, so the short write lock during the Vercel build is harmless.

-- Daily digest (ujc_api.digest.select_digest_jobs): "jobs first seen since the user's last
-- digest". Without it every due user costs a sequential scan of `jobs`.
CREATE INDEX IF NOT EXISTS jobs_first_seen_at_idx ON jobs (first_seen_at);

-- Sources summary (`GET /api/sources`, `GET /api/platforms`): count(*) and max(first_seen_at)
-- per source become an index-only scan instead of a scan of the whole (wide) jobs heap. Its
-- leading `source` column also serves `WHERE source = ...`, so it replaces jobs_source_idx
-- (which UNIQUE (source, external_id) made redundant anyway). first_seen_at never changes after
-- insert, so this adds no write cost to crawler upserts.
CREATE INDEX IF NOT EXISTS jobs_source_first_seen_idx ON jobs (source, first_seen_at);
DROP INDEX IF EXISTS jobs_source_idx;

-- Worker `requeue_stale` runs before every poll (every few seconds) with
-- `WHERE status = 'running' AND locked_at < ...`. `tasks` keeps every done row, so without this
-- that is a sequential scan of an ever-growing table; with it, a scan of the few running rows.
CREATE INDEX IF NOT EXISTS tasks_running_locked_idx ON tasks (locked_at) WHERE status = 'running';
