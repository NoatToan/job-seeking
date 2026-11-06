"""Manage admin accounts: `python -m ujc_api.admin grant|revoke|list`.

    uv run python -m ujc_api.admin grant person@example.com   # account must have signed in once
    uv run python -m ujc_api.admin revoke person@example.com
    uv run python -m ujc_api.admin list

Uses `DATABASE_URL` like the API. Emails in `UJC_ADMIN_EMAILS` are admins regardless of the
`role` column (see `ujc_api.auth.admin`); `list` shows both sources.
"""

import argparse
import sys

import psycopg

from ujc_api.settings import get_settings


def set_role(conn: psycopg.Connection, email: str, role: str) -> bool:
    cur = conn.execute("UPDATE users SET role = %s WHERE email = %s", (role, email.strip().lower()))
    return cur.rowcount > 0


def list_admins(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute("SELECT email FROM users WHERE role = 'admin' ORDER BY email").fetchall()
    return [r[0] for r in rows]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m ujc_api.admin")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("grant", "make an existing account an admin"),
        ("revoke", "remove admin"),
    ):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("email")
    sub.add_parser("list", help="list admins (database role and UJC_ADMIN_EMAILS)")
    args = parser.parse_args(argv)
    settings = get_settings()

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        if args.command == "list":
            for email in list_admins(conn):
                print(f"{email}\t(role)")
            for email in sorted(settings.admin_emails()):
                print(f"{email}\t(UJC_ADMIN_EMAILS)")
            return 0
        role = "admin" if args.command == "grant" else "user"
        if not set_role(conn, args.email, role):
            print(
                f"no account with email {args.email!r}; they must sign in once first",
                file=sys.stderr,
            )
            return 1
        print(f"{args.email.strip().lower()}: role={role}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
