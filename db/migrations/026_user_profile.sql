-- Editable public-facing profile (`GET/PATCH /api/me/profile`): a display name used instead of the
-- email in the app chrome, a one-line headline and three optional links. Location and time zone
-- are not duplicated here: they stay in `user_preferences.candidate_country` / `digest_tz`, which
-- the feed's eligibility filter and the daily digest already read. No avatar column: the avatar is
-- generated from the display name (initials + colour), so no image is ever stored.
-- Every column is optional and every existing account keeps working with all of them NULL.
-- Never edit this file once it has been applied.

ALTER TABLE users
  ADD COLUMN display_name TEXT CHECK (char_length(display_name) BETWEEN 1 AND 60),
  ADD COLUMN headline     TEXT CHECK (char_length(headline) BETWEEN 1 AND 120),
  ADD COLUMN linkedin_url TEXT CHECK (char_length(linkedin_url) <= 300 AND linkedin_url LIKE 'https://%'),
  ADD COLUMN github_url   TEXT CHECK (char_length(github_url) <= 300 AND github_url LIKE 'https://%'),
  ADD COLUMN website_url  TEXT CHECK (char_length(website_url) <= 300 AND website_url LIKE 'https://%');
