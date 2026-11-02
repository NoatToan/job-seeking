-- Per-user job match scores (M4-03) from the `match_score` task: the user's latest done CV
-- profile scored against their feed candidates. Recomputed wholesale on each run (delete +
-- insert), so a row disappearing just means the job no longer made the cut.
CREATE TABLE user_matches (
  user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  cv_id          BIGINT      NOT NULL REFERENCES user_cvs (id) ON DELETE CASCADE,
  job_id         BIGINT      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  score          INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
  summary        TEXT        NOT NULL,
  reasons        TEXT[]      NOT NULL DEFAULT '{}',
  missing_skills TEXT[]      NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX user_matches_user_score_idx ON user_matches (user_id, score DESC);

-- Counts `POST /api/matches/refresh` calls for the daily quota (max 3/user/day). Not reused for
-- the automatic post-cv_extract match_score task, which doesn't count against it.
CREATE TABLE match_refreshes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX match_refreshes_user_idx ON match_refreshes (user_id, created_at DESC);
