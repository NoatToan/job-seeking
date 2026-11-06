"""Contributor feature: feedback, feature ideas and admin review under `/api/feedback`.

The endpoints, validation and authorisation rules live in the vendored `contributor_box` package
(NoatToan/contributor-box, synced by `pnpm contributor:sync`; do not edit it here). This module
only plugs in job-seeking's session auth, CSRF check, admin role and pooled connection.

Anonymous feedback is on (`allow_anonymous=True`): signed-out visitors can submit (create only),
CSRF-protected with the cookie from `GET /api/auth/csrf`, rate-limited by contributor-box per
`anonymous_key` (HMAC of the client IP with `UJC_SECRET_KEY`; the raw IP is never stored).

The public board is on too (`public_board=True`), for the public `/roadmap/` page: signed-out
visitors can read `GET /api/feedback?scope=board`, `GET /api/feedback/stats` and the detail of an
approved / planned / done item, with public fields only. Voting and everything else need a session.
"""

import hashlib
import hmac

import psycopg
from fastapi import Depends, Request

from contributor_box import FeedbackDeps, PgFeedbackRepository, create_feedback_router
from ujc_api.auth.admin import is_admin, viewer_is_admin
from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user, optional_user
from ujc_api.db import get_conn
from ujc_api.deps import app_settings
from ujc_api.net import client_ip
from ujc_api.settings import Settings


def feedback_repo(conn: psycopg.Connection = Depends(get_conn)) -> PgFeedbackRepository:
    return PgFeedbackRepository(conn)


def optional_viewer_is_admin(
    user: AuthedUser | None = Depends(optional_user),
    conn: psycopg.Connection = Depends(get_conn),
    settings: Settings = Depends(app_settings),
) -> bool:
    return user is not None and is_admin(conn, settings, user)


def anonymous_key(request: Request, settings: Settings = Depends(app_settings)) -> str:
    message = f"feedback-anon:{client_ip(request)}".encode()
    return hmac.new(settings.ujc_secret_key.encode(), message, hashlib.sha256).hexdigest()


router = create_feedback_router(
    FeedbackDeps(
        current_user=current_user,
        viewer_is_admin=viewer_is_admin,
        get_repo=feedback_repo,
        require_csrf=require_csrf,
        optional_user=optional_user,
        optional_viewer_is_admin=optional_viewer_is_admin,
        anonymous_key=anonymous_key,
    ),
    allow_anonymous=True,
    public_board=True,
)
