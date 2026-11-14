-- What scripts/google-indexing/notify.mjs last told the Google Indexing API about each static job
-- page: URL_UPDATED (published) or URL_DELETED (gone from the sitemap). The daily run diffs the
-- live job sitemaps against this table, so every page is announced once, within the API's daily
-- quota, newest first, and every page that disappears is withdrawn once.
-- Never edit this file once applied.
CREATE TABLE IF NOT EXISTS seo_indexing_notices (
  url         TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('URL_UPDATED', 'URL_DELETED')),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
