-- Full-text search on jobs (Postgres FTS instead of Elasticsearch: enough for millions of rows,
-- no extra service to run). Title weighs most, then company/tags, then description.
CREATE FUNCTION job_unified_tags_text(tags TEXT[]) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string(tags, ' ') $$;

ALTER TABLE jobs ADD COLUMN search TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(company, '') || ' ' || job_unified_tags_text(tags)), 'B') ||
  setweight(to_tsvector('english', coalesce(location, '')), 'B') ||
  setweight(to_tsvector('english', left(coalesce(description, ''), 20000)), 'C')
) STORED;
CREATE INDEX jobs_search_idx ON jobs USING GIN (search);

-- What a user is looking for. Jobs are mapped to a profile at read time with FTS ranking,
-- so a new profile shows results immediately and every daily crawl refreshes them.
CREATE TABLE search_profiles (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT        NOT NULL,
  keywords         TEXT        NOT NULL,             -- web-search syntax: "react native" -senior OR mobile
  locations        TEXT[]      NOT NULL DEFAULT '{}', -- any of these in job location (empty = anywhere)
  remote_only      BOOLEAN     NOT NULL DEFAULT FALSE,
  sources          TEXT[]      NOT NULL DEFAULT '{}', -- empty = all sources
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
