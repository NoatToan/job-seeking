-- Admin role (Contributor feature, docs/product/ARCHITECTURE.md D12). Every existing and new
-- account is a plain 'user'. Admins are granted with `python -m ujc_api.admin grant <email>`
-- (apps/api) or listed in `UJC_ADMIN_EMAILS`; no account is promoted by this migration and no
-- credential is stored anywhere.
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
-- Admin lookups (`list` command, audits) only; the per-request check is by primary key.
CREATE INDEX users_admin_idx ON users (id) WHERE role = 'admin';
