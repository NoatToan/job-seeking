"""contributor-box: in-context feedback, feature ideas and admin review for a FastAPI + Postgres
host. See the repository README for how a host wires `create_feedback_router`."""

from contributor_box.constants import CREATE_MAX_BODY_BYTES, KINDS, PUBLIC_STATUSES, STATUSES
from contributor_box.repository import FeedbackRepository, PgFeedbackRepository
from contributor_box.router import FeedbackDeps, create_feedback_router

__all__ = [
    "CREATE_MAX_BODY_BYTES",
    "KINDS",
    "PUBLIC_STATUSES",
    "STATUSES",
    "FeedbackDeps",
    "FeedbackRepository",
    "PgFeedbackRepository",
    "create_feedback_router",
]
