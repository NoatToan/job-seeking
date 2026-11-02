-- Platform connections (M3-01) & Upwork search cache (M3-04), adapted from
-- docs/product/ARCHITECTURE.md §4 010_platform_connections.sql / 012_upwork_cache.sql to the
-- current schema and merged into one migration (both are assigned migration 011 here).
--
-- `credentials_encrypted` is AES-GCM ciphertext (nonce || ciphertext) produced by
-- `ujc_api.crypto.encrypt_json`, keyed off `UJC_SECRET_KEY` via HKDF — never plaintext.
CREATE TABLE platform_connections (
  user_id                BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform               TEXT        NOT NULL CHECK (platform IN ('adzuna', 'upwork')),
  status                 TEXT        NOT NULL DEFAULT 'connected'
                         CHECK (status IN ('connected', 'error', 'revoked')),
  credentials_encrypted  BYTEA       NOT NULL,
  external_account       TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

-- Upwork API & MCP Terms §8.3: cache for at most 24h, then the row is purged (see
-- `ujc_api.maintenance.purge_expired_upwork_cache`), never re-fetched just to refresh.
CREATE TABLE upwork_search_cache (
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  query_hash  TEXT        NOT NULL,
  results     JSONB       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, query_hash)
);

CREATE INDEX upwork_search_cache_expires_at_idx ON upwork_search_cache (expires_at);
