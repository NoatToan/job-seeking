-- Onboarding wizard (M4-07). Tracks when a user finished the /onboarding/ flow so
-- the web app knows whether to redirect a freshly logged-in user there (docs/product/FLOW_V2.md).
ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
