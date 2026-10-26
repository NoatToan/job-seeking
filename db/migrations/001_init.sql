-- Jobs collected from every source. (source, external_id) is the dedupe key.
CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL,              -- see packages/core/src/sources.ts
  external_id     TEXT        NOT NULL,              -- id (or url) of the job at the source
  url             TEXT        NOT NULL,              -- original posting, always shown in the UI
  apply_url       TEXT,
  title           TEXT        NOT NULL,
  company         TEXT        NOT NULL,
  location        TEXT,
  remote          BOOLEAN     NOT NULL DEFAULT FALSE,
  employment_type TEXT,
  salary_text     TEXT,
  description     TEXT,
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  posted_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw             JSONB,
  UNIQUE (source, external_id)
);
CREATE INDEX jobs_source_idx ON jobs (source);
CREATE INDEX jobs_posted_at_idx ON jobs (posted_at DESC NULLS LAST);
CREATE INDEX jobs_last_seen_at_idx ON jobs (last_seen_at DESC);

-- Company job boards on public ATS APIs (Greenhouse / Lever / Ashby) the crawler follows.
CREATE TABLE company_boards (
  id           BIGSERIAL PRIMARY KEY,
  ats          TEXT    NOT NULL CHECK (ats IN ('greenhouse', 'lever', 'ashby')),
  slug         TEXT    NOT NULL,
  company_name TEXT    NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (ats, slug)
);

-- One row per source per crawl, so the UI can show freshness and errors.
CREATE TABLE crawl_runs (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  jobs_found  INTEGER     NOT NULL DEFAULT 0,
  jobs_new    INTEGER     NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX crawl_runs_source_started_idx ON crawl_runs (source, started_at DESC);

-- Starter boards (YC / remote-friendly companies). Add more rows to widen coverage.
INSERT INTO company_boards (ats, slug, company_name) VALUES
  ('greenhouse', 'airbnb', 'Airbnb'),
  ('greenhouse', 'stripe', 'Stripe'),
  ('greenhouse', 'gitlab', 'GitLab'),
  ('greenhouse', 'canva', 'Canva'),
  ('greenhouse', 'coinbase', 'Coinbase'),
  ('lever', 'palantir', 'Palantir'),
  ('ashby', 'linear', 'Linear'),
  ('ashby', 'supabase', 'Supabase'),
  ('ashby', 'posthog', 'PostHog'),
  ('ashby', 'deel', 'Deel')
ON CONFLICT DO NOTHING;
