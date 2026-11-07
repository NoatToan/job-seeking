-- Relocation signals, parsed by the crawler with regex rules (apps/crawler/src/job_crawler/
-- relocation.py). Never edit this file once applied.
--
-- `relocation_support`:  true = the employer helps the hire move (package, assistance, budget),
--                        false = the posting says it doesn't, NULL = not mentioned.
-- `relocation_required`: true = the hire must live in / move to the job's location ("based in
--                        Dublin or willing to relocate"), false = "no relocation required",
--                        NULL = not mentioned.
-- Both are derived columns: written on every crawler upsert and re-applied to old rows by
-- `python -m job_crawler --recompute-derived` (nightly, after the crawl), which is also the
-- backfill for jobs stored before this migration.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS relocation_support BOOLEAN,
  ADD COLUMN IF NOT EXISTS relocation_required BOOLEAN;

-- The "Relocation support" / "Relocation required" filters (`relocation` param on GET /api/jobs
-- and /api/feed) only ever ask for `true`, a small slice of the table.
CREATE INDEX IF NOT EXISTS jobs_relocation_support_idx ON jobs (id) WHERE relocation_support;
CREATE INDEX IF NOT EXISTS jobs_relocation_required_idx ON jobs (id) WHERE relocation_required;
