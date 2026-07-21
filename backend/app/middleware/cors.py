from typing import Any

from app.core.config import get_settings

settings = get_settings()

# localhost + private LAN ranges so teammates can open the Vite app via your IP.
_DEV_ORIGIN_REGEX = (
    r"https?://("
    r"localhost|"
    r"127\.0\.0\.1|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)


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
