-- CVs a user uploaded for a search profile, with the profile Claude extracted from them.
-- CV text is personal data: delete it with the profile (cascade) or on request.
CREATE TABLE cvs (
  id           BIGSERIAL PRIMARY KEY,
  profile_id   BIGINT      NOT NULL REFERENCES search_profiles (id) ON DELETE CASCADE,
  filename     TEXT        NOT NULL,
  text         TEXT        NOT NULL,
  extracted    JSONB       NOT NULL,   -- skills, target_titles, seniority, summary...
  ocr_used     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cvs_profile_idx ON cvs (profile_id, created_at DESC);

-- Claude's fit score (0-100) of one CV for one job.
CREATE TABLE cv_matches (
  cv_id          BIGINT      NOT NULL REFERENCES cvs (id) ON DELETE CASCADE,
  job_id         BIGINT      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  score          INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
  summary        TEXT        NOT NULL,
  reasons        TEXT[]      NOT NULL DEFAULT '{}',
  missing_skills TEXT[]      NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cv_id, job_id)
);
