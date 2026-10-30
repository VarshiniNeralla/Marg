from typing import Any

from starlette.middleware.cors import CORSMiddleware

from app.core.config import get_settings

settings = get_settings()

# localhost + private LAN ranges so teammates can open the Vite app via your IP.
_DEV_ORIGIN_REGEX = (
    r"https?://("
    r"localhost|"
    r"(?:myhome|kohinoor)\.localhost|"      # explicit per-tenant local-development hosts
    r"127\.0\.0\.1|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)


class TenantAwareCORSMiddleware(CORSMiddleware):
    """
    CORSMiddleware that, in multi-tenant mode, additionally requires the request Origin
    to be one of the CURRENT tenant's own hosts, so the Kohinoor SPA origin is never
    accepted by the My Home API (and vice versa), whatever CORS_ORIGINS lists.
    Unchanged in single-tenant mode.
    """

    def is_allowed_origin(self, origin: str) -> bool:
        if not super().is_allowed_origin(origin):
            return False
        from app.core import tenancy

        # Host routing: the origin must belong to the request's own tenant. E-mail routing has no tenant before
        # login, so the configured CORS origin list applies (tokens are tenant-bound regardless).
        if tenancy.multi_tenant_enabled() and not tenancy.email_routing():
            return tenancy.origin_belongs_to_current_tenant(origin)
        return True


def get_cors_kwargs() -> dict[str, Any]:
    """
    Returns the kwargs dict passed to Starlette's CORSMiddleware.

    In production, origins are strictly limited to CORS_ORIGINS from settings.
    In development, also allow private-network IPs so the frontend can be shared
    on the LAN via your machine's IP.

    allow_credentials=True is required for the browser to send/receive
    the httpOnly refresh token cookie across origins.
    """
    kwargs: dict[str, Any] = {
        "allow_credentials": True,
        "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        "allow_headers": [
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "Accept",
            "Origin",
            "Cookie",
            "X-Requested-With",
            # Sent by the mobile app's axios client to bypass ngrok's free-tier
            # browser-warning interstitial when the API base is a dev tunnel;
            # harmless against a real deployed backend. Without listing it here
            # explicitly, the browser's own preflight for this header is
            # correctly rejected by CORS (400) before ngrok is ever involved.
            "ngrok-skip-browser-warning",
        ],
        "expose_headers": ["X-Request-ID", "Set-Cookie"],
        "max_age": 600,
    }

    if settings.is_development:
        kwargs["allow_origin_regex"] = _DEV_ORIGIN_REGEX
    else:
        kwargs["allow_origins"] = settings.get_cors_origins()

    return kwargs
