-- Companion runner pairing (M3-06). Adapted to flow v2: the runner crawls the user's own
-- `user_preferences` keywords (docs/product/FLOW_V2.md §4), not a per-profile search config
-- (there are no `search_profiles` in this flow).
CREATE TABLE runners (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  token_hash   TEXT        NOT NULL UNIQUE,            -- sha256 of the bearer token (shown once)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX runners_user_idx ON runners (user_id);

CREATE TABLE runner_pairing_codes (
  code_hash  TEXT        PRIMARY KEY,                  -- sha256 of the 8-char pairing code
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,                      -- 10 minutes
  used_at    TIMESTAMPTZ
);
CREATE INDEX runner_pairing_codes_user_idx ON runner_pairing_codes (user_id);
