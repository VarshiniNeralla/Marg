"""
Rate limiting via slowapi.

Auth endpoints (login, register, forgot-password) are the brute-force surface,
so they get strict per-IP limits. Storage uses Redis when REDIS_URL is reachable
(shared across instances) and falls back to in-memory otherwise (single-instance,
still better than nothing). The limiter degrades gracefully: if slowapi is somehow
unavailable, a no-op limiter is used so the app still boots.
"""
from loguru import logger

from app.core.config import get_settings

settings = get_settings()


def _client_ip(request) -> str:
    """
    Key function: prefer the left-most X-Forwarded-For hop (Render/!proxies put
    the real client there), else the socket peer. Used to bucket rate limits.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _build_limiter():
    try:
        from slowapi import Limiter
    except Exception as exc:  # slowapi missing — should not happen, but degrade.
        logger.error(f"slowapi unavailable, rate limiting disabled: {exc}")
        return None

    storage_uri = None
    # Production only: Redis buckets are shared and persistent — using them in
    # local dev caused 429 lockouts that survived backend restarts.
    if settings.RATE_LIMIT_ENABLED and settings.is_production:
        # Try Redis storage; verify connectivity so a dead Redis doesn't make
        # every request error. If unreachable, fall back to in-memory storage.
        try:
            import redis

            client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
            client.ping()
            storage_uri = settings.REDIS_URL
            logger.info("Rate limiting using Redis storage.")
        except Exception as exc:
            logger.warning(
                f"Redis unavailable for rate limiting ({exc}); using in-memory storage."
            )
            storage_uri = None

    return Limiter(
        key_func=_client_ip,
        storage_uri=storage_uri,
        enabled=settings.RATE_LIMIT_ENABLED,
    )


# Singleton limiter used by route decorators and registered on the app.
limiter = _build_limiter()
