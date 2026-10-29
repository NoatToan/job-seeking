"""Vercel Python function entrypoint: serves the FastAPI app (apps/api) under /api/*.

The monorepo's Python packages aren't installed as wheels on Vercel; their src directories are
bundled with the function (vercel.json `includeFiles`) and put on sys.path here.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for src in ("apps/api/src", "apps/crawler/src", "apps/mcp/src"):
    path = str(ROOT / src)
    if path not in sys.path:
        sys.path.insert(0, path)

from ujc_api.main import create_app  # noqa: E402

app = create_app()
