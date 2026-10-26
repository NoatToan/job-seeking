-- Who a remote job accepts, parsed from its location text by the crawler
-- (apps/crawler/src/job_crawler/eligibility.py): 'WORLDWIDE', ISO country codes ('US', 'VN'),
-- or regions ('APAC', 'EUROPE', ...). NULL = unknown or not remote.
ALTER TABLE jobs ADD COLUMN open_to TEXT[];
CREATE INDEX jobs_open_to_idx ON jobs USING GIN (open_to);

-- Where the candidate lives (ISO code). Remote jobs that clearly exclude it are hidden.
ALTER TABLE search_profiles ADD COLUMN candidate_country TEXT;
