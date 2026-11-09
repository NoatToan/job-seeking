-- Company logo URL, derived by the crawler (apps/crawler/src/job_crawler/logo.py): the logo the
-- source sends, else the employer's site icon; NULL = the app shows the company's initials.
-- A derived column: written on every upsert and re-applied to old rows by
-- `python -m job_crawler --recompute-derived` (nightly), which is also the backfill.
-- Never edit this file once applied.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_logo TEXT;
