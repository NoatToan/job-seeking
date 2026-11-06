-- Jobs the user has already opened ("read" history), so the feed can mark them as seen across
-- devices. One row per (user, job); re-opening a job only bumps `viewed_at`. Rows go away with
-- the user or the job (CASCADE): unlike `applications` there is nothing worth keeping once the
-- job itself is gone.
CREATE TABLE job_views (
  user_id   BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id    BIGINT      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX job_views_user_viewed_idx ON job_views (user_id, viewed_at DESC);
