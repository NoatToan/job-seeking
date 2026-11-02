-- Daily digest email (M4-08, flow v2 adaptation). Unsubscribe is stateless -- HMAC(UJC_SECRET_KEY,
-- user_id|"digest"), see ujc_api.digest.unsubscribe_token -- so no token table is needed.
ALTER TABLE user_preferences
  ADD COLUMN digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN digest_hour SMALLINT NOT NULL DEFAULT 7 CHECK (digest_hour BETWEEN 0 AND 23),
  ADD COLUMN digest_tz TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN last_digest_at TIMESTAMPTZ;

-- `ujc_api.digest run` scans every row with digest_enabled; this keeps that scan cheap as the
-- table grows.
CREATE INDEX user_preferences_digest_idx ON user_preferences (digest_enabled) WHERE digest_enabled;
