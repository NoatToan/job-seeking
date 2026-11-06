-- Structured salary, derived by the crawler (apps/crawler/src/job_crawler/salary.py) from the
-- source's own salary text when it has one, else from the title + description. Amounts are in
-- `salary_currency` units per `salary_period` ('year' | 'month' | 'week' | 'day' | 'hour').
-- `salary_source`: 'source' (the board gave it) or 'description' (found in the posting).
-- `jobs.salary_text` stays exactly what the source sent.
ALTER TABLE jobs ADD COLUMN salary_min NUMERIC;
ALTER TABLE jobs ADD COLUMN salary_max NUMERIC;
ALTER TABLE jobs ADD COLUMN salary_currency TEXT;
ALTER TABLE jobs ADD COLUMN salary_period TEXT;
ALTER TABLE jobs ADD COLUMN salary_source TEXT;
