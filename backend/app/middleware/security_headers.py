from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings

settings = get_settings()


class SecurityHeadersMiddleware:
    """
    Pure-ASGI middleware that attaches baseline security headers to every HTTP
    response. Uses the raw ASGI interface (not BaseHTTPMiddleware) to avoid the
    Starlette header-stripping bug that breaks CORS preflights.

    Headers:
      - Strict-Transport-Security: force HTTPS for a year (prod/HTTPS only).
      - X-Content-Type-Options: nosniff — block MIME sniffing.
      - X-Frame-Options: DENY — block clickjacking via framing.
      - Referrer-Policy: don't leak full URLs (which may carry tokens) cross-origin.
      - Permissions-Policy: drop powerful features the API never uses.
      - Content-Security-Policy: lock the API origin down. This is an API host
        (no HTML UI in prod — docs are disabled), so a strict default-src 'none'
        is safe and does not affect the separately-hosted SPA.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.setdefault(
                    "Permissions-Policy",
                    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=()",
                )
                # Only assert HSTS over HTTPS (prod) — never on plain-HTTP dev.
                if settings.cookie_secure:
                    headers.setdefault(
                        "Strict-Transport-Security",
                        "max-age=31536000; includeSubDomains",
                    )
                # Strict CSP for the API origin. Docs (Swagger UI) need inline
                # styles/scripts, so relax CSP only when docs are enabled (dev).
                if settings.is_production:
                    headers.setdefault(
                        "Content-Security-Policy",
                        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)
