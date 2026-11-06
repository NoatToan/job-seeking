-- ISO codes of the countries a job is in / open to, derived by the crawler
-- (apps/crawler/src/job_crawler/derived.py `job_countries`). Unlike open_to it covers on-site jobs
-- too and never holds regions or WORLDWIDE. NULL = worldwide / unknown. Backs the country filter.
ALTER TABLE jobs ADD COLUMN countries TEXT[];
CREATE INDEX jobs_countries_idx ON jobs USING GIN (countries);
