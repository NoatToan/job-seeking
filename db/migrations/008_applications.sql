-- Application tracking (M4-05). `job_snapshot` (title, company, url, source) is captured at
-- creation time so a card keeps showing even if the `jobs` row it came from is later deleted
-- (hence `job_id ... ON DELETE SET NULL` rather than CASCADE).
CREATE TABLE applications (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id         BIGINT      REFERENCES jobs (id) ON DELETE SET NULL,
  job_snapshot   JSONB       NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'saved'
                 CHECK (status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn')),
  note           TEXT,
  next_action_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one tracked application per (user, job); manual/snapshot-only entries (job_id NULL) are unrestricted
CREATE UNIQUE INDEX applications_user_job_idx ON applications (user_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX applications_user_updated_idx ON applications (user_id, updated_at DESC);
CREATE INDEX applications_user_status_idx ON applications (user_id, status, updated_at DESC);

CREATE TABLE application_events (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT      NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT        NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX application_events_application_idx ON application_events (application_id, created_at DESC);
