-- Description sections and seniority level, parsed by the crawler with regex rules
-- (apps/crawler/src/job_crawler/sections.py, level.py). Never edit this file once applied.
--
-- `sections`: the description split into canonical sections, in posting order:
--   [{"key": "requirements", "heading": "What you'll bring", "body": "- 5+ years…", "summary": "…"}]
--   keys: intro, about_company, about_role, responsibilities, requirements, nice_to_have,
--   tech_stack, compensation, benefits, location_remote, hiring_process, other, equal_opportunity.
--   NULL = no description, or no heading recognised (the app then shows the raw description).
-- `sections_version`: the rules version that wrote `sections` / `level` (sections.VERSION); 0 = not
--   parsed yet. `python -m job_crawler --backfill-sections` (nightly, after the crawl) re-parses
--   every row below the current version, in batches, so a rule change reaches old rows.
-- `level` / `level_source`: intern … director, and where it came from: the board's own seniority
--   field ("source"), the title ("title") or the description ("description"). NULL = not stated.
ALTER TABLE jobs
  ADD COLUMN sections JSONB,
  ADD COLUMN sections_version INT NOT NULL DEFAULT 0,
  ADD COLUMN level TEXT
    CHECK (level IN ('intern', 'junior', 'mid', 'senior', 'lead', 'manager', 'director')),
  ADD COLUMN level_source TEXT CHECK (level_source IN ('source', 'title', 'description'));

-- The backfill picks rows below the current version, in id order.
CREATE INDEX jobs_sections_version_idx ON jobs (sections_version, id);
CREATE INDEX jobs_level_idx ON jobs (level) WHERE level IS NOT NULL;
