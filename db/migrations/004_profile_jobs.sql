-- Jobs a site's own search returned for a profile (session crawler: LinkedIn / Seek).
-- Those cards often have no description, so full-text search alone would miss them.
CREATE TABLE profile_jobs (
  profile_id BIGINT      NOT NULL REFERENCES search_profiles (id) ON DELETE CASCADE,
  job_id     BIGINT      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  found_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, job_id)
);
CREATE INDEX profile_jobs_job_idx ON profile_jobs (job_id);
