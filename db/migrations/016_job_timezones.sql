-- The time zone(s) a job works in, derived by the crawler (apps/crawler/src/job_crawler/timezones.py):
-- IANA names ('America/New_York') or fixed offsets ('UTC+07:00'); several = any of them, first is the
-- primary. NULL = unknown or no constraint (worldwide). The web app compares the job's working
-- hours in these zones with the user's own time zone (user_preferences.digest_tz when signed in).
ALTER TABLE jobs ADD COLUMN timezones TEXT[];
-- 'stated' (the posting says it) or 'location' (inferred from where the job is).
ALTER TABLE jobs ADD COLUMN timezone_source TEXT;
