-- contributor-box: feedback items, admin notes, votes and screenshots.
--
-- Host contract: the host database already has `users (id BIGINT PRIMARY KEY)`. Admin roles are
-- the host's concern (its own migration), not this file's. Every table is prefixed `feedback_`
-- so it never collides with host tables. Copied verbatim into the host's migration folder by
-- `scripts/sync.mjs`; once a host has applied it, never edit it: add `002_...sql` instead.

CREATE TABLE feedback_items (
  id                BIGSERIAL PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('bug', 'feedback', 'idea')),
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  body              TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  status            TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'under_review', 'approved', 'planned', 'done', 'rejected')),
  -- Where the user was and what they pointed at (all optional; captured by the widget).
  page_url          TEXT CHECK (char_length(page_url) <= 2048),
  page_title        TEXT CHECK (char_length(page_title) <= 300),
  element_selector  TEXT CHECK (char_length(element_selector) <= 1000),
  element_text      TEXT CHECK (char_length(element_text) <= 300),
  -- {x, y, width, height} in CSS pixels, relative to the viewport at capture time.
  region            JSONB,
  viewport_width    INTEGER CHECK (viewport_width BETWEEN 1 AND 20000),
  viewport_height   INTEGER CHECK (viewport_height BETWEEN 1 AND 20000),
  user_agent        TEXT CHECK (char_length(user_agent) <= 500),
  -- Public reply from the team, shown on the board next to the item.
  admin_response    TEXT CHECK (char_length(admin_response) <= 5000),
  -- The author's rows go with their account (privacy: account deletion is a hard delete).
  author_id         BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reviewed_by       BIGINT REFERENCES users (id) ON DELETE SET NULL,
  status_changed_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Board (public statuses) and admin queue, newest first.
CREATE INDEX feedback_items_status_created_idx ON feedback_items (status, created_at DESC, id DESC);
-- "My feedback" and the per-author hourly submit limit.
CREATE INDEX feedback_items_author_created_idx ON feedback_items (author_id, created_at DESC);
-- FK index: `ON DELETE SET NULL` when an admin account is deleted.
CREATE INDEX feedback_items_reviewed_by_idx ON feedback_items (reviewed_by) WHERE reviewed_by IS NOT NULL;

-- At most one screenshot per item, kept out of the hot row. Bytes are validated (magic bytes,
-- size cap) by the API before insert; never served with a client-supplied content type.
CREATE TABLE feedback_screenshots (
  item_id    BIGINT PRIMARY KEY REFERENCES feedback_items (id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size  INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2000000),
  width      INTEGER CHECK (width BETWEEN 1 AND 20000),
  height     INTEGER CHECK (height BETWEEN 1 AND 20000),
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (byte_size = octet_length(data))
);
-- JPEG/PNG/WebP are already compressed: store out of line without another compression pass.
ALTER TABLE feedback_screenshots ALTER COLUMN data SET STORAGE EXTERNAL;

-- Content admins add to an item: internal notes (admins only) or public notes (shown on the
-- board), plus an automatic 'status' entry for every status change (the item's history).
CREATE TABLE feedback_notes (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT NOT NULL REFERENCES feedback_items (id) ON DELETE CASCADE,
  author_id   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'status')),
  visibility  TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'public')),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  from_status TEXT CHECK (from_status IN ('new', 'under_review', 'approved', 'planned', 'done', 'rejected')),
  to_status   TEXT CHECK (to_status IN ('new', 'under_review', 'approved', 'planned', 'done', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_notes_item_idx ON feedback_notes (item_id, created_at, id);
-- FK index: `ON DELETE SET NULL` when an admin account is deleted.
CREATE INDEX feedback_notes_author_idx ON feedback_notes (author_id) WHERE author_id IS NOT NULL;

CREATE TABLE feedback_votes (
  item_id    BIGINT NOT NULL REFERENCES feedback_items (id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
-- Account deletion cascades by user_id.
CREATE INDEX feedback_votes_user_idx ON feedback_votes (user_id);
