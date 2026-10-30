import asyncio
from typing import AsyncGenerator, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.tenancy import TENANTS, Tenant, multi_tenant_enabled, require_tenant, tenant_by_slug

settings = get_settings()


class MongoDB:
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


_mongo = MongoDB()

# Multi-tenant mode: one Motor client per tenant, each bound to that tenant's own
# database. The legacy single-database handle above is never used in that mode.
_tenant_clients: dict[str, AsyncIOMotorClient] = {}


def _tenant_uri(tenant: Tenant) -> str:
    return (getattr(settings, tenant.mongo_uri_setting, "") or "").strip()


def _open_tenant_client(tenant: Tenant) -> Optional[AsyncIOMotorClient]:
    uri = _tenant_uri(tenant)
    if not uri:
        return None
    return AsyncIOMotorClient(
        uri,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
        maxPoolSize=25,
        minPoolSize=1,
        retryWrites=True,
    )


async def _connect_tenants(retries: int, base_delay: float) -> None:
    ok = 0
    for tenant in TENANTS:
        client = _open_tenant_client(tenant)
        if client is None:
            logger.error(f"Tenant '{tenant.slug}' has no connection string configured; its requests will fail")
            continue
        _tenant_clients[tenant.slug] = client
        for attempt in range(1, retries + 1):
            try:
                await client.admin.command("ping")
                logger.info(f"Connected tenant '{tenant.slug}' — database: '{tenant.db_name}'")
                ok += 1
                break
            except Exception as exc:  # pragma: no cover - network dependent
                logger.warning(f"Tenant '{tenant.slug}' ping failed (attempt {attempt}/{retries}): {type(exc).__name__}")
                await asyncio.sleep(base_delay * (2 ** (attempt - 1)))
    if ok == 0:
        raise RuntimeError("Could not establish MongoDB connectivity for any tenant at startup")


def tenant_database(slug: str) -> AsyncIOMotorDatabase:
    tenant = tenant_by_slug(slug)
    client = _tenant_clients.get(tenant.slug) if tenant else None
    if tenant is None or client is None:
        raise RuntimeError(f"Tenant database '{slug}' is not available")
    return client[tenant.db_name]


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
    if multi_tenant_enabled():
        await _connect_tenants(retries, base_delay)
        return
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
        if multi_tenant_enabled():
            if not _tenant_clients:
                return False
            for client in _tenant_clients.values():
                await client.admin.command("ping")
            return True
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
    for client in _tenant_clients.values():
        client.close()
    _tenant_clients.clear()
    if _mongo.client is not None:
        _mongo.client.close()
        logger.info("MongoDB connection closed.")


def get_database() -> AsyncIOMotorDatabase:
    """
    Returns the active database instance.
    Used as a FastAPI dependency: Depends(get_database).
    Raises RuntimeError if called before connect_db() has completed.

    Multi-tenant mode: returns the database of the tenant bound to the current
    request/task and raises (never falls back to another database) when there is
    no tenant in context.
    """
    if multi_tenant_enabled():
        return tenant_database(require_tenant().slug)
    if _mongo.db is None:
        raise RuntimeError(
            "Database not initialised. Ensure connect_db() ran during startup."
        )
    return _mongo.db


async def get_db() -> AsyncGenerator[AsyncIOMotorDatabase, None]:
    """
    Async generator version for use with FastAPI Depends.
    Yields the database and handles any cleanup if needed.

    Multi-tenant (email routing): a request that carries no valid tenant credential has no tenant, so it
    gets 401 here rather than ever reaching another tenant's (or the legacy) database.
    """
    from app.core.exceptions import UnauthorizedException
    from app.core.tenancy import TenantResolutionError

    try:
        db = get_database()
    except TenantResolutionError:
        raise UnauthorizedException("Authentication required")
    yield db


async def get_db_or_none() -> AsyncGenerator[Optional[AsyncIOMotorDatabase], None]:
    """Like get_db but yields None when the request has no tenant yet (optional-auth endpoints)."""
    from app.core.tenancy import TenantResolutionError

    try:
        db = get_database()
    except TenantResolutionError:
        db = None
    yield db
