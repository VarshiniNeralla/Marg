from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.exceptions import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.db.indexes import create_indexes
from app.db.mongodb import close_db, connect_db, get_database, ping_db
from app.middleware.cors import get_cors_kwargs
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware

settings = get_settings()


# ── Lifespan (startup + shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.
    Code before `yield` runs at startup; code after runs at shutdown.
    This is the recommended replacement for @app.on_event("startup").
    """
    # ── Startup ───────────────────────────────────────────────────────────────
    logger.info(f"Starting {settings.APP_NAME} — env: {settings.APP_ENV}")

    await connect_db()

    # Index creation is best-effort: a transient failure here must not prevent
    # the service from starting (indexes can be ensured on a later boot).
    try:
        db = get_database()
        await create_indexes(db)
    except Exception as exc:
        logger.error(f"Index creation failed at startup (continuing): {exc}")

    logger.info("Application startup complete.")
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await close_db()
    logger.info("Application shutdown complete.")


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        description=(
            "Production-grade Horizon API. "
            "Used for construction monitoring and immersive room tours."
        ),
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Middleware — order matters: last added = outermost = first to run ────────
    # RequestLoggingMiddleware added first → innermost (runs after CORS).
    # SecurityHeadersMiddleware next → wraps responses with security headers.
    # CORSMiddleware added last → outermost (intercepts OPTIONS preflights first).
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(CORSMiddleware, **get_cors_kwargs())

    # ── Rate limiting ───────────────────────────────────────────────────────
    # Register the slowapi limiter + its 429 handler so @limiter.limit(...) on
    # the auth routes is enforced. No-op safely if the limiter failed to build.
    from app.core.rate_limit import limiter
    if limiter is not None:
        from slowapi import _rate_limit_exceeded_handler
        from slowapi.errors import RateLimitExceeded

        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # ── Exception handlers ────────────────────────────────────────────────────
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(api_router, prefix="/api/v1")

    # ── Root + health — no auth, no rate limiting ─────────────────────────────
    @app.api_route("/", methods=["GET", "HEAD"], tags=["Meta"], include_in_schema=False)
    async def root():
        return {
            "status": "ok",
            "service": settings.APP_NAME,
            "environment": settings.APP_ENV,
            "docs": "/docs",
            "health": "/health",
        }

    @app.get("/health", tags=["Meta"], include_in_schema=False)
    async def health_check():
        # Liveness: the process is up and serving. Cheap, never touches the DB —
        # so a DB blip does not cause the orchestrator to kill a healthy process.
        return {"status": "healthy"}

    @app.get("/health/ready", tags=["Meta"], include_in_schema=False)
    async def readiness_check():
        # Readiness: should this instance receive traffic? Verifies DB connectivity.
        db_ok = await ping_db()
        body = {
            "status": "ready" if db_ok else "degraded",
            "checks": {"mongodb": "up" if db_ok else "down"},
        }
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200 if db_ok else 503, content=body)

    return app


app = create_app()
