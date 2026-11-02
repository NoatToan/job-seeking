# apps/api image: FastAPI served by uvicorn. Also used, with a different CMD, to run the
# migration one-shot and (on a host with the `claude` CLI, outside this image — see
# deploy/README.md) the worker.
#
# Build context must be the repo root (not deploy/), because apps/api's pyproject.toml declares
# `job_crawler` and `job_search_mcp` as editable path dependencies on ../crawler and ../mcp
# (docs/product/ARCHITECTURE.md §2 "apps/api internal layout"), and ujc_api.migrate resolves
# db/migrations relative to the repo root.
FROM python:3.12-slim

# Official distroless uv binary (docs: https://docs.astral.sh/uv/guides/integration/docker/).
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /usr/local/bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Only the Python packages apps/api depends on (path deps) plus the migrations it applies.
COPY apps/api apps/api
COPY apps/crawler apps/crawler
COPY apps/mcp apps/mcp
COPY db/migrations db/migrations

WORKDIR /app/apps/api
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["uv", "run", "python", "-c", "import urllib.request as u; u.urlopen('http://localhost:8000/api/health', timeout=2)"]

CMD ["uv", "run", "uvicorn", "ujc_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
