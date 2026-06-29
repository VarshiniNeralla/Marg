from typing import Any

from app.core.config import get_settings

settings = get_settings()


def get_cors_kwargs() -> dict[str, Any]:
    """
    Returns the kwargs dict passed to Starlette's CORSMiddleware.

    In production, origins are strictly limited to CORS_ORIGINS from settings.
    In development, the same list applies but typically includes localhost.

    allow_credentials=True is required for the browser to send/receive
    the httpOnly refresh token cookie across origins.
    """
    origins = settings.get_cors_origins()

    return {
        "allow_origins": origins,
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
        ],
        "expose_headers": ["X-Request-ID", "Set-Cookie"],
        "max_age": 600,
    }
