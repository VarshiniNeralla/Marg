"""Media responses must always carry `Vary: Origin` so the browser cache never serves a CORS-less copy to a CORS fetch."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from httpx import ASGITransport, AsyncClient

from app.middleware.security_headers import SecurityHeadersMiddleware


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/media/{p:path}")
    async def media(p: str):
        return PlainTextResponse("x", headers={"Cache-Control": "private, max-age=86400"})

    @app.get("/api/v1/ping")
    async def ping():
        return PlainTextResponse("ok")

    return app


@pytest.mark.asyncio
async def test_media_response_varies_on_origin_even_without_an_origin_header():
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://t") as c:
        r = await c.get("/media/a/b.jpg")
    assert "origin" in r.headers.get("vary", "").lower()


@pytest.mark.asyncio
async def test_non_media_routes_are_unchanged():
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://t") as c:
        r = await c.get("/api/v1/ping")
    assert "origin" not in r.headers.get("vary", "").lower()
