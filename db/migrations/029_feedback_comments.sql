-- contributor-box: up/down votes, two-level comments, display identities, comment reports.
--
-- Votes become +1 / -1 (score = ups - downs). Every existing vote row was an upvote, so the new
-- `value` column backfills to +1 and keeps all data. Comments live in `feedback_comments`, two
-- levels deep (a reply's parent is always a top-level comment of the same item; the router
-- enforces "top-level", the composite foreign key enforces "same item"). Anonymous visitors are
-- identified by `visitor_key`, the host's keyed hash of a random id kept in a signed HttpOnly
-- cookie; the raw cookie value is never stored. Never edit this file once a host has applied it.

-- 1. Votes: +1 / -1 per voter, switching allowed.
ALTER TABLE feedback_votes
  ADD COLUMN value SMALLINT NOT NULL DEFAULT 1 CHECK (value IN (-1, 1)),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- Existing rows are +1 now; new rows must say what they are.
ALTER TABLE feedback_votes ALTER COLUMN value DROP DEFAULT;

-- 2. Items: comment lock, the anonymous submitter's visitor identity, and stored counters
-- (score = upvotes - downvotes, visible comments) kept by the triggers below, so a board page
-- never counts votes or comments per row and "top" sorts straight off an index.
ALTER TABLE feedback_items
  ADD COLUMN comments_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN visitor_key TEXT CHECK (char_length(visitor_key) BETWEEN 1 AND 128),
  ADD COLUMN upvotes INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  ADD COLUMN score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0);
ALTER TABLE feedback_items ADD CONSTRAINT feedback_items_visitor_anonymous_only
  CHECK (visitor_key IS NULL OR author_id IS NULL);
ALTER TABLE feedback_items ADD CONSTRAINT feedback_items_score_is_ups_minus_downs
  CHECK (score = upvotes - downvotes);

UPDATE feedback_items i SET upvotes = v.n, score = v.n
  FROM (SELECT item_id, count(*)::int AS n FROM feedback_votes GROUP BY item_id) v
  WHERE v.item_id = i.id;

-- Board columns and roadmap "top": status, then score, newest first (keyset pagination).
CREATE INDEX feedback_items_status_score_idx
  ON feedback_items (status, score DESC, created_at DESC, id DESC);

-- +1 / -1 bookkeeping on the item for every vote insert, switch and removal (including the
-- cascades from account and item deletion).
CREATE FUNCTION feedback_votes_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE feedback_items SET
      upvotes = upvotes - (OLD.value = 1)::int,
      downvotes = downvotes - (OLD.value = -1)::int,
      score = score - OLD.value
    WHERE id = OLD.item_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE feedback_items SET
      upvotes = upvotes + (NEW.value = 1)::int,
      downvotes = downvotes + (NEW.value = -1)::int,
      score = score + NEW.value
    WHERE id = NEW.item_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER feedback_votes_count AFTER INSERT OR UPDATE OR DELETE ON feedback_votes
  FOR EACH ROW EXECUTE FUNCTION feedback_votes_count();

-- 3. Chosen display names: one per signed-in user or per anonymous visitor. Without a row, a
-- user shows their email's local part and a visitor their generated pseudonym.
CREATE TABLE feedback_identities (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  visitor_key  TEXT UNIQUE CHECK (char_length(visitor_key) BETWEEN 1 AND 128),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (visitor_key IS NULL))
);

-- 4. Comments, two levels.
CREATE TABLE feedback_comments (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT NOT NULL REFERENCES feedback_items (id) ON DELETE CASCADE,
  parent_id   BIGINT,
  -- Exactly one identity while the comment exists: a signed-in author or an anonymous visitor.
  -- Account deletion sets `author_id` NULL, and the trigger below turns the row into a tombstone.
  author_id   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  visitor_key TEXT CHECK (char_length(visitor_key) BETWEEN 1 AND 128),
  -- Anonymous comments only: the host's HMAC of the client IP, for the per-IP hourly limit.
  anon_key    TEXT CHECK (char_length(anon_key) BETWEEN 1 AND 128),
  -- Whether the author was an admin when posting (shown as a "Team" badge).
  by_team     BOOLEAN NOT NULL DEFAULT false,
  body        TEXT NOT NULL CHECK (char_length(body) <= 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ,
  -- Soft delete keeps a "[deleted]" placeholder while replies hang off the comment.
  deleted_at  TIMESTAMPTZ,
  hidden_at   TIMESTAMPTZ,
  hidden_by   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  -- Kept by `feedback_comment_votes_count`, like the item counters.
  upvotes     INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  downvotes   INTEGER NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  score       INTEGER NOT NULL DEFAULT 0,
  CHECK (score = upvotes - downvotes),
  UNIQUE (item_id, id),
  FOREIGN KEY (item_id, parent_id) REFERENCES feedback_comments (item_id, id) ON DELETE CASCADE,
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (author_id IS NULL OR visitor_key IS NULL),
  CHECK (anon_key IS NULL OR visitor_key IS NOT NULL),
  CHECK (deleted_at IS NOT NULL OR author_id IS NOT NULL OR visitor_key IS NOT NULL),
  CHECK (deleted_at IS NOT NULL OR char_length(body) >= 1)
);
-- The item's thread (and the FK to items), top-level page by score, replies per parent.
CREATE INDEX feedback_comments_item_idx ON feedback_comments (item_id, created_at, id);
CREATE INDEX feedback_comments_top_idx
  ON feedback_comments (item_id, score DESC, created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX feedback_comments_parent_idx ON feedback_comments (parent_id, created_at, id)
  WHERE parent_id IS NOT NULL;
-- Per-author hourly limit and `ON DELETE SET NULL` on account deletion.
CREATE INDEX feedback_comments_author_idx ON feedback_comments (author_id, created_at DESC)
  WHERE author_id IS NOT NULL;
-- Per-visitor, per-IP and global anonymous hourly limits.
CREATE INDEX feedback_comments_visitor_idx ON feedback_comments (visitor_key, created_at DESC)
  WHERE visitor_key IS NOT NULL;
CREATE INDEX feedback_comments_anon_idx ON feedback_comments (anon_key, created_at DESC)
  WHERE anon_key IS NOT NULL;
CREATE INDEX feedback_comments_anonymous_created_idx ON feedback_comments (created_at DESC)
  WHERE visitor_key IS NOT NULL;
CREATE INDEX feedback_comments_hidden_by_idx ON feedback_comments (hidden_by)
  WHERE hidden_by IS NOT NULL;

-- A deleted account leaves a "[deleted]" tombstone (body cleared) instead of taking other
-- people's replies with it. Fires for the `ON DELETE SET NULL` above.
CREATE FUNCTION feedback_comments_author_gone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.author_id IS NULL AND OLD.author_id IS NOT NULL THEN
    NEW.deleted_at := COALESCE(NEW.deleted_at, now());
    NEW.body := '';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER feedback_comments_author_gone BEFORE UPDATE ON feedback_comments
  FOR EACH ROW EXECUTE FUNCTION feedback_comments_author_gone();

-- `feedback_items.comment_count` = comments that are neither deleted nor hidden. Recounted for
-- the affected item (one indexed count) whenever a comment appears, goes, or changes state.
CREATE FUNCTION feedback_comments_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target BIGINT := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at THEN
    RETURN NULL;
  END IF;
  UPDATE feedback_items SET comment_count = (
    SELECT count(*) FROM feedback_comments c
    WHERE c.item_id = target AND c.deleted_at IS NULL AND c.hidden_at IS NULL
  ) WHERE id = target;
  RETURN NULL;
END;
$$;
CREATE TRIGGER feedback_comments_count AFTER INSERT OR UPDATE OR DELETE ON feedback_comments
  FOR EACH ROW EXECUTE FUNCTION feedback_comments_count();

-- 5. Comment votes: signed-in users, +1 / -1.
CREATE TABLE feedback_comment_votes (
  comment_id BIGINT NOT NULL REFERENCES feedback_comments (id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX feedback_comment_votes_user_idx ON feedback_comment_votes (user_id);

CREATE FUNCTION feedback_comment_votes_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE feedback_comments SET
      upvotes = upvotes - (OLD.value = 1)::int,
      downvotes = downvotes - (OLD.value = -1)::int,
      score = score - OLD.value
    WHERE id = OLD.comment_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE feedback_comments SET
      upvotes = upvotes + (NEW.value = 1)::int,
      downvotes = downvotes + (NEW.value = -1)::int,
      score = score + NEW.value
    WHERE id = NEW.comment_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER feedback_comment_votes_count
  AFTER INSERT OR UPDATE OR DELETE ON feedback_comment_votes
  FOR EACH ROW EXECUTE FUNCTION feedback_comment_votes_count();

-- 6. Reports: one per reporter (user or visitor) per comment, until an admin dismisses them.
CREATE TABLE feedback_comment_reports (
  id                   BIGSERIAL PRIMARY KEY,
  comment_id           BIGINT NOT NULL REFERENCES feedback_comments (id) ON DELETE CASCADE,
  reporter_id          BIGINT REFERENCES users (id) ON DELETE CASCADE,
  reporter_visitor_key TEXT CHECK (char_length(reporter_visitor_key) BETWEEN 1 AND 128),
  reason               TEXT CHECK (char_length(reason) <= 500),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((reporter_id IS NULL) <> (reporter_visitor_key IS NULL))
);
CREATE UNIQUE INDEX feedback_comment_reports_user_uniq
  ON feedback_comment_reports (comment_id, reporter_id) WHERE reporter_id IS NOT NULL;
CREATE UNIQUE INDEX feedback_comment_reports_visitor_uniq
  ON feedback_comment_reports (comment_id, reporter_visitor_key)
  WHERE reporter_visitor_key IS NOT NULL;
CREATE INDEX feedback_comment_reports_reporter_idx ON feedback_comment_reports (reporter_id)
  WHERE reporter_id IS NOT NULL;
-- Report counts per comment (admin views, the reported queue) and the FK cascade.
CREATE INDEX feedback_comment_reports_comment_idx
  ON feedback_comment_reports (comment_id, created_at DESC);
-- Global hourly cap on anonymous reports.
CREATE INDEX feedback_comment_reports_anonymous_created_idx
  ON feedback_comment_reports (created_at DESC) WHERE reporter_visitor_key IS NOT NULL;
