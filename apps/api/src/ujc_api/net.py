"""Small request-shape helpers shared across routers."""

from fastapi import Request


def client_ip(request: Request) -> str:
    """The caller's IP: `X-Forwarded-For`'s first hop (Vercel/most proxies set this), else the
    ASGI-reported peer address."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
