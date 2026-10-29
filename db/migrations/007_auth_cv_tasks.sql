CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,            -- stored lower-cased
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE email_otps (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                     -- HMAC-SHA256(secret, email|code)
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,        -- max 5
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_otps_email_idx ON email_otps (email, created_at DESC);
CREATE TABLE sessions (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,              -- sha256 of the cookie value
  user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,              -- 30 days, sliding
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE user_cvs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  content      BYTEA NOT NULL,                   -- ≤ 5 MB; deleted with the CV
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','error')),
  error        TEXT,
  text         TEXT,
  profile      JSONB,                            -- skills, target_titles, seniority, summary…
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX user_cvs_user_idx ON user_cvs (user_id, created_at DESC);
CREATE TABLE user_preferences (
  user_id           BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  keywords          TEXT[] NOT NULL DEFAULT '{}',
  remote_only       BOOLEAN NOT NULL DEFAULT FALSE,
  candidate_country TEXT,                        -- ISO code, see eligibility
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                      -- 'cv_extract'
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  run_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by  TEXT,
  locked_at  TIMESTAMPTZ,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_queue_idx ON tasks (status, run_after) WHERE status = 'queued';
-- keyset pagination for the feed: newest first, id as tie-breaker
CREATE INDEX jobs_feed_idx ON jobs ((coalesce(posted_at, first_seen_at)) DESC, id DESC);
