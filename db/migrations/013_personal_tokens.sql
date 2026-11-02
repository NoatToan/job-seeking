-- Personal access tokens (M3-08): lets a user's own Claude (apps/mcp) call the API on their
-- behalf without a browser session. `token_hash` is sha256 of the raw `ujc_pat_<random>` value,
-- which is shown to the user exactly once at creation and never stored in the clear.
CREATE TABLE personal_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT '{}',   -- subset of jobs:read, applications:write
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,           -- at most 365 days out at creation
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX personal_tokens_user_idx ON personal_tokens (user_id, created_at DESC);
