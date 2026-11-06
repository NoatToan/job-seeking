"""Admin role (Contributor feature, docs/product/ARCHITECTURE.md D14).

A user is an admin when `users.role = 'admin'` **or** their email is listed in `UJC_ADMIN_EMAILS`
(comma-separated, case-insensitive). The env list bootstraps the first admin without a database
write or any stored credential, and removing an email from it revokes that path immediately; the
`role` column is managed with the CLI in `ujc_api.admin`. Checked on every request, never cached
in the session, so a revocation applies to existing sessions too.

Only browser sessions count: personal access tokens (`ujc_pat_...`) never authenticate admin
routes, because `viewer_is_admin` depends on `current_user` (session cookie only).
"""

import psycopg
from fastapi import Depends

from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.settings import Settings


def is_admin(conn: psycopg.Connection, settings: Settings, user: AuthedUser) -> bool:
    if user.email.strip().lower() in settings.admin_emails():
        return True
    row = conn.execute("SELECT role FROM users WHERE id = %s", (user.id,)).fetchone()
    return bool(row and row[0] == "admin")


def role_from(settings: Settings, user: AuthedUser, stored_role: str | None) -> str:
    """`user_role` when the caller already read `users.role` (no extra lookup)."""
    admin = user.email.strip().lower() in settings.admin_emails() or stored_role == "admin"
    return "admin" if admin else "user"


def user_role(conn: psycopg.Connection, settings: Settings, user: AuthedUser) -> str:
    return "admin" if is_admin(conn, settings, user) else "user"


def viewer_is_admin(
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> bool:
    """FastAPI dependency: whether the signed-in (session) user is an admin. 401 if signed out."""
    return is_admin(conn, settings, user)
