-- The GitHub issue opened for a feedback item (ujc_api.feedback_github): when an admin moves an
-- item to `FEEDBACK_GITHUB_STATUS` (default `planned`), the API opens one issue in
-- `FEEDBACK_GITHUB_REPO` and remembers it here, so later edits never open a second one.
-- A job-seeking table, not contributor-box's (whose migrations are 022, 024, 029).
-- Never edit this file once applied.
CREATE TABLE IF NOT EXISTS feedback_github_issues (
  item_id      BIGINT PRIMARY KEY REFERENCES feedback_items (id) ON DELETE CASCADE,
  repo         TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_url    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
