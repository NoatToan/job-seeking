-- Blog: third-party articles we cite or republish, and our own daily roundup posts that group
-- them. Written by `python -m job_crawler.blog` (.github/workflows/daily-blog.yml); read at web
-- build time by scripts/export-blog.mjs. See docs/DECISIONS.md "Blog" for the copyright model:
--   excerpt mode (default): metadata + a <= 50-word excerpt, never the article body;
--   full mode: only for sources whose licence allows republication (public domain, CC BY,
--   CC BY-SA, CC BY-ND, explicit permission); the body is stored as sanitised JSON blocks.

CREATE TABLE blog_articles (
  id             BIGSERIAL   PRIMARY KEY,
  source         TEXT        NOT NULL,                   -- key in job_crawler/blog/sources.py
  source_name    TEXT        NOT NULL,                   -- publisher name for the credit line
  source_url     TEXT        CHECK (source_url ~ '^https?://'), -- publisher homepage
  external_id    TEXT        NOT NULL,                   -- the feed item's guid (or its url)
  url            TEXT        NOT NULL,                   -- canonical link to the original
  title          TEXT        NOT NULL CHECK (char_length(title) <= 300),
  author         TEXT        CHECK (char_length(author) <= 120),
  -- Plain text, <= 50 words. The length cap backs up the crawler's word limit.
  excerpt        TEXT        CHECK (char_length(excerpt) <= 600),
  published_at   TIMESTAMPTZ,
  topics         TEXT[]      NOT NULL DEFAULT '{}',
  republish_mode TEXT        NOT NULL DEFAULT 'excerpt' CHECK (republish_mode IN ('full', 'excerpt')),
  slug           TEXT        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), -- /blog/articles/<slug>/ (full only)
  licence_name   TEXT,
  licence_url    TEXT        CHECK (licence_url ~ '^https://'),
  body           JSONB,                                  -- sanitised block document (full only)
  pixel_url      TEXT        CHECK (pixel_url ~ '^https://'), -- counter pixel a licence requires
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blog_articles_url_http CHECK (url ~ '^https?://'),
  -- The article body exists only for full-mode rows, and a full-mode row always carries its
  -- licence and page slug.
  CONSTRAINT blog_articles_full_mode CHECK (
    (republish_mode = 'excerpt' AND body IS NULL AND slug IS NULL AND pixel_url IS NULL)
    OR (republish_mode = 'full' AND body IS NOT NULL AND jsonb_typeof(body) = 'array'
        AND slug IS NOT NULL AND licence_name IS NOT NULL AND licence_url IS NOT NULL)
  ),
  CONSTRAINT blog_articles_source_external_id_key UNIQUE (source, external_id),
  CONSTRAINT blog_articles_url_key UNIQUE (url),
  CONSTRAINT blog_articles_slug_key UNIQUE (slug)
);
-- Uncited-articles lookup for the next roundup, newest first.
CREATE INDEX blog_articles_recency_idx ON blog_articles ((coalesce(published_at, first_seen_at)) DESC);

CREATE TABLE blog_posts (
  id           BIGSERIAL   PRIMARY KEY,
  slug         TEXT        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind         TEXT        NOT NULL DEFAULT 'daily-roundup' CHECK (kind IN ('daily-roundup')),
  title        TEXT        NOT NULL,
  description  TEXT        NOT NULL,                     -- meta description
  intro        TEXT        NOT NULL,                     -- our text; paragraphs split by blank lines
  sections     JSONB       NOT NULL DEFAULT '[]',        -- [{topic, commentary}] in display order
  related_jobs JSONB       NOT NULL DEFAULT '[]',        -- [{id, title, company, location, remote, topic}] snapshot
  topics       TEXT[]      NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_posts_published_idx ON blog_posts (published_at DESC);

-- Articles cited by a post. An article is cited by at most one post (no duplicate content across
-- roundups), which is also how the next roundup finds uncited articles.
CREATE TABLE blog_post_articles (
  post_id    BIGINT  NOT NULL REFERENCES blog_posts (id) ON DELETE CASCADE,
  article_id BIGINT  NOT NULL REFERENCES blog_articles (id) ON DELETE CASCADE,
  topic      TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (post_id, article_id),
  CONSTRAINT blog_post_articles_article_key UNIQUE (article_id)
);
