from typing import AsyncGenerator, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

settings = get_settings()


class MongoDB:
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


_mongo = MongoDB()


async def connect_db() -> None:
    """
    Opens the Motor client and pings the deployment to confirm connectivity.
    Called once during FastAPI startup via the lifespan context manager.
    """
    logger.info("Connecting to MongoDB Atlas...")
    _mongo.client = AsyncIOMotorClient(
        settings.MONGO_URI,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        maxPoolSize=50,
        minPoolSize=5,
    )
    _mongo.db = _mongo.client[settings.DB_NAME]

    # Verify connectivity at startup — fail fast rather than fail at first request.
    await _mongo.client.admin.command("ping")
    logger.info(f"Connected to MongoDB Atlas — database: '{settings.DB_NAME}'")


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
