"""Shared FastAPI dependencies that need the *app instance's* settings (not the process-wide
cached singleton from `ujc_api.settings.get_settings`), so `create_app(settings=...)` fully
controls what every route sees — the same reasoning as `main._app_settings`.
"""

from fastapi import Request

from ujc_api.settings import Settings


def app_settings(request: Request) -> Settings:
    return request.app.state.settings
