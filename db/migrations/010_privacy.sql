-- Privacy & data rights (M5-04 / M4-02). Consent gate for sending CV text to the LLM provider.
-- Account deletion is a hard delete (cascades from `users` already cover sessions, user_cvs,
-- user_preferences, applications — see 007_auth_cv_tasks.sql and 008_applications.sql), so no
-- `deleted_at` column is needed here.
ALTER TABLE users ADD COLUMN ai_consent_at TIMESTAMPTZ;
