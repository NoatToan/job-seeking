"""Contributor feature: feedback, feature ideas and admin review under `/api/feedback`.

The endpoints, validation and authorisation rules live in the vendored `contributor_box` package
(NoatToan/contributor-box, synced by `pnpm contributor:sync`; do not edit it here). This module
only plugs in job-seeking's session auth, CSRF check, admin role and pooled connection.
"""

import psycopg
from fastapi import Depends

from contributor_box import FeedbackDeps, PgFeedbackRepository, create_feedback_router
from ujc_api.auth.admin import viewer_is_admin
from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import current_user
from ujc_api.db import get_conn


def feedback_repo(conn: psycopg.Connection = Depends(get_conn)) -> PgFeedbackRepository:
    return PgFeedbackRepository(conn)


router = create_feedback_router(
    FeedbackDeps(
        current_user=current_user,
        viewer_is_admin=viewer_is_admin,
        get_repo=feedback_repo,
        require_csrf=require_csrf,
    )
)
