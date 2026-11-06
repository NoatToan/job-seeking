-- contributor-box: anonymous submissions (opt-in per host with `allow_anonymous=True`).
--
-- An anonymous item has no author (`author_id` NULL), an optional display name the visitor typed,
-- and `anon_key`: the host's HMAC of the client IP, used only to rate-limit anonymous submissions.
-- Signed-in rows never carry either field. Never edit this file once a host has applied it.

ALTER TABLE feedback_items ALTER COLUMN author_id DROP NOT NULL;

ALTER TABLE feedback_items
  ADD COLUMN author_name TEXT CHECK (char_length(author_name) BETWEEN 1 AND 80),
  ADD COLUMN anon_key    TEXT CHECK (char_length(anon_key) BETWEEN 1 AND 128);

-- Signed-in rows: no anonymous fields. Anonymous rows: a rate-limit key.
ALTER TABLE feedback_items ADD CONSTRAINT feedback_items_author_or_anonymous CHECK (
  (author_id IS NOT NULL AND author_name IS NULL AND anon_key IS NULL)
  OR (author_id IS NULL AND anon_key IS NOT NULL)
);

-- Per-key and global hourly limits on anonymous submissions.
CREATE INDEX feedback_items_anon_created_idx ON feedback_items (anon_key, created_at DESC)
  WHERE author_id IS NULL;
CREATE INDEX feedback_items_anonymous_created_idx ON feedback_items (created_at DESC)
  WHERE author_id IS NULL;
