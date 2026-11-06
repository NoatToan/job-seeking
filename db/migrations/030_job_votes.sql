-- Community signal on jobs ("Not worth applying?" / "Still good"), see docs/DECISIONS.md
-- "Job downvotes" and apps/api ujc_api/job_votes.py.
--
-- `job_votes` holds one vote per (job, user): -1 = a report with a required reason, +1 = "still
-- good". Changing a vote updates the row; removing it deletes the row. `note` is optional free
-- text (required by the API for reason 'other'); it is never shown publicly, only to admins.
CREATE TABLE IF NOT EXISTS job_votes (
  job_id     BIGINT      NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vote       SMALLINT    NOT NULL CHECK (vote IN (-1, 1)),
  reason     TEXT        CHECK (reason IN (
               'expired', 'not_remote', 'scam', 'wrong_details', 'ghosting', 'evergreen', 'other'
             )),
  note       TEXT        CHECK (note IS NULL OR char_length(note) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id),
  -- A report always says why; "still good" never carries a reason.
  CONSTRAINT job_votes_reason_matches_vote CHECK ((vote = -1) = (reason IS NOT NULL))
);
-- Per-user rate limit (votes written in the last hour) and the account's own votes.
CREATE INDEX IF NOT EXISTS job_votes_user_updated_idx ON job_votes (user_id, updated_at DESC);

-- Denormalised aggregate per job, recomputed in the same request as every vote write (one
-- statement) and daily by `ujc_api.maintenance` (decay, accounts that came of age, reposts).
-- Job lists / detail read it with one LEFT JOIN on the primary key: no per-row query, no GROUP BY
-- at read time. `cleared_at` is the admin "clear reports" mark: votes written before it no
-- longer count (the votes themselves are kept, so voters still see their own choice).
CREATE TABLE IF NOT EXISTS job_vote_stats (
  job_id       BIGINT      PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  down_count   INTEGER     NOT NULL DEFAULT 0,
  up_count     INTEGER     NOT NULL DEFAULT 0,
  down_score   REAL        NOT NULL DEFAULT 0,
  up_score     REAL        NOT NULL DEFAULT 0,
  flagged      BOOLEAN     NOT NULL DEFAULT FALSE,
  top_reason   TEXT,
  reasons      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_down_at TIMESTAMPTZ,
  cleared_at   TIMESTAMPTZ,
  cleared_by   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- "Hide reported jobs" and the daily refresh only care about the few rows with any signal.
CREATE INDEX IF NOT EXISTS job_vote_stats_active_idx ON job_vote_stats (job_id)
  WHERE down_count > 0 OR up_count > 0;
