"""
Refresh-token revocation store.

Implements rotation + revocation for refresh tokens:
  - revoke(jti, ttl): mark a specific refresh-token jti as no longer valid.
  - is_revoked(jti): check before honoring a refresh.
  - revoke_user(user_id): bump a per-user epoch so ALL tokens issued before now
    are rejected (used on password reset / "log out everywhere").

Backed by Redis when REDIS_URL is reachable (works across instances). Falls back
to an in-process dict when Redis is unavailable — correct for a single instance,
and still strictly better than the previous behavior (no revocation at all).
Entries carry a TTL matching the refresh-token lifetime so the store self-prunes.
"""
import time
from typing import Optional

from loguru import logger

from app.core.config import get_settings

settings = get_settings()

_REFRESH_TTL_SECONDS = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


class _RedisTokenStore:
    def __init__(self, client) -> None:
        self._r = client

    def revoke(self, jti: str, ttl: int = _REFRESH_TTL_SECONDS) -> None:
        self._r.setex(f"revoked_jti:{jti}", ttl, "1")

    def is_revoked(self, jti: str) -> bool:
        return self._r.exists(f"revoked_jti:{jti}") == 1

    def revoke_user(self, user_id: str) -> None:
        # Store the epoch (now). Tokens issued (iat) before this are invalid.
        self._r.setex(f"user_token_epoch:{user_id}", _REFRESH_TTL_SECONDS, str(int(time.time())))

    def user_epoch(self, user_id: str) -> int:
        val = self._r.get(f"user_token_epoch:{user_id}")
        return int(val) if val else 0


class _MemoryTokenStore:
    def __init__(self) -> None:
        self._revoked: dict[str, float] = {}     # jti -> expiry epoch
        self._user_epoch: dict[str, int] = {}     # user_id -> epoch seconds

    def _prune(self) -> None:
        now = time.time()
        expired = [k for k, exp in self._revoked.items() if exp < now]
        for k in expired:
            self._revoked.pop(k, None)

    def revoke(self, jti: str, ttl: int = _REFRESH_TTL_SECONDS) -> None:
        self._prune()
        self._revoked[jti] = time.time() + ttl

    def is_revoked(self, jti: str) -> bool:
        exp = self._revoked.get(jti)
        if exp is None:
            return False
        if exp < time.time():
            self._revoked.pop(jti, None)
            return False
        return True

    def revoke_user(self, user_id: str) -> None:
        self._user_epoch[user_id] = int(time.time())

    def user_epoch(self, user_id: str) -> int:
        return self._user_epoch.get(user_id, 0)


def _build_store():
    try:
        import redis

        client = redis.Redis.from_url(
            settings.REDIS_URL, socket_connect_timeout=1, decode_responses=True
        )
        client.ping()
        logger.info("Token revocation store using Redis.")
        return _RedisTokenStore(client)
    except Exception as exc:
        logger.warning(
            f"Redis unavailable for token revocation ({exc}); using in-memory store "
            "(single-instance only)."
        )
        return _MemoryTokenStore()


token_store = _build_store()


def is_token_active(jti: Optional[str], user_id: str, issued_at: Optional[int]) -> bool:
    """Returns True if a refresh token (by jti + iat) is still valid."""
    if jti and token_store.is_revoked(jti):
        return False
    epoch = token_store.user_epoch(user_id)
    if epoch and issued_at is not None and issued_at < epoch:
        return False
    return True
