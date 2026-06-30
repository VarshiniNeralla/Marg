import asyncio
from typing import AsyncGenerator, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

settings = get_settings()


class MongoDB:
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


_mongo = MongoDB()


async def connect_db(retries: int = 5, base_delay: float = 1.0) -> None:
    """
    Opens the Motor client and pings the deployment to confirm connectivity.
    Called once during FastAPI startup via the lifespan context manager.

    Connectivity is verified with bounded exponential-backoff retry so that a
    transient Atlas blip during deploy does NOT crash-loop the container — Motor
    pools/reconnects on its own once the client exists, but the startup ping is
    what previously hard-failed. We retry it a few times before giving up.
    """
    logger.info("Connecting to MongoDB Atlas...")
    _mongo.client = AsyncIOMotorClient(
        settings.MONGO_URI,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        maxPoolSize=50,
        minPoolSize=5,
        retryWrites=True,
    )
    _mongo.db = _mongo.client[settings.DB_NAME]

    last_exc: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            await _mongo.client.admin.command("ping")
            logger.info(f"Connected to MongoDB Atlas — database: '{settings.DB_NAME}'")
            return
        except Exception as exc:  # pragma: no cover - network dependent
            last_exc = exc
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(
                f"MongoDB ping failed (attempt {attempt}/{retries}): {exc}. "
                f"Retrying in {delay:.1f}s..."
            )
            await asyncio.sleep(delay)

    # All retries exhausted. Keep the client (Motor may still recover on first
    # request); surface the failure so the orchestrator/operator is aware, but
    # the readiness probe (/health/ready) is the real gate for traffic.
    logger.error(f"MongoDB unreachable after {retries} attempts: {last_exc}")
    raise RuntimeError(f"Could not establish MongoDB connectivity at startup: {last_exc}")


async def ping_db() -> bool:
    """Returns True if the database currently responds to a ping. Used by the
    readiness health check. Never raises."""
    try:
        if _mongo.client is None:
            return False
        await _mongo.client.admin.command("ping")
        return True
    except Exception:
        return False


async def close_db() -> None:
    """
    Closes the Motor client. Called during FastAPI shutdown via lifespan.
    """
    if _mongo.client is not None:
        _mongo.client.close()
        logger.info("MongoDB connection closed.")


def get_database() -> AsyncIOMotorDatabase:
    """
    Returns the active database instance.
    Used as a FastAPI dependency: Depends(get_database).
    Raises RuntimeError if called before connect_db() has completed.
    """
    if _mongo.db is None:
        raise RuntimeError(
            "Database not initialised. Ensure connect_db() ran during startup."
        )
    return _mongo.db


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """
    Async generator version for use with FastAPI Depends.
    Yields the database and handles any cleanup if needed.
    """
    yield get_database()
