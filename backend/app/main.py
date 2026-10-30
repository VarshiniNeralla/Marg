from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from loguru import logger

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.exceptions import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.core.tenancy import TENANTS, media_path_allowed, multi_tenant_enabled, use_tenant
from app.db.indexes import create_indexes
from app.db.mongodb import close_db, connect_db, get_database, ping_db
from app.middleware.cors import TenantAwareCORSMiddleware, get_cors_kwargs
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.middleware.tenant import TenantMiddleware

settings = get_settings()

# Objects up to this size are served as a single response (see serve_local_media); larger ones are streamed.
_MEDIA_SINGLE_RESPONSE_MAX_BYTES = 32 * 1024 * 1024


async def _for_each_database(fn, label: str) -> None:
    """
    Run ``fn(db)`` for the single database (legacy mode) or, in multi-tenant mode,
    once per configured tenant database inside that tenant's context so anything
    the call spawns (e.g. re-dispatched stitch jobs) stays bound to its tenant.
    Best-effort per database: one tenant failing never blocks the others.
    """
    if not multi_tenant_enabled():
        await fn(get_database())
        return
    for tenant in TENANTS:
        try:
            with use_tenant(tenant):
                await fn(get_database())
        except Exception as exc:
            logger.error(f"{label} failed for tenant '{tenant.slug}' (continuing): {type(exc).__name__}")


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
        await _for_each_database(create_indexes, "Index creation")
    except Exception as exc:
        logger.error(f"Index creation failed at startup (continuing): {exc}")

    # Background stitch jobs run as asyncio tasks, which die with the process. Any
    # job still marked pending/processing is therefore orphaned by a restart and
    # must be re-dispatched (or failed) so it neither hangs forever nor blocks
    # retries of the same capture. Best-effort, same as index creation.
    try:
        from app.services.capture_stitch_service import CaptureStitchService

        async def _recover(db):
            await CaptureStitchService(db).recover_orphaned_jobs()

        await _for_each_database(_recover, "Stitch job recovery")
    except Exception as exc:
        logger.error(f"Stitch job recovery failed at startup (continuing): {exc}")

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
            "Production-grade SiteVision API. "
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
    # TenantAwareCORSMiddleware next → handles OPTIONS preflights (see TenantMiddleware below).
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(TenantAwareCORSMiddleware, **get_cors_kwargs())
    # TenantMiddleware LAST = outermost: the host-resolved tenant is bound before CORS,
    # logging and the route run (CORS needs it to apply the per-tenant origin rule).
    # It is a no-op unless MULTI_TENANT_ENABLED.
    app.add_middleware(TenantMiddleware)

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

    # Local media (MEDIA_STORAGE=local). Auth-gated — not world-readable StaticFiles.
    from fastapi import HTTPException, Query, Request
    from fastapi.responses import FileResponse

    from app.services.local_media_service import ensure_upload_root, upload_root
    from app.services.media_access import authorize_media_request, is_private_media_path

    media_root = ensure_upload_root()

    @app.get("/media/{file_path:path}", include_in_schema=False)
    async def serve_local_media(
        file_path: str,
        request: Request,
        access_token: str | None = Query(default=None),
        exp: str | None = Query(default=None),
        sig: str | None = Query(default=None),
    ):
        # Private processing area (raw spool, failure artifacts): never served,
        # not even to authenticated callers. Checked before auth or any lookup.
        if is_private_media_path(file_path):
            raise HTTPException(status_code=404, detail="Not found")
        authorize_media_request(
            request,
            file_path,
            access_token=access_token,
            exp=exp,
            sig=sig,
        )
        root = upload_root().resolve()
        full = (root / file_path).resolve()
        try:
            rel = full.relative_to(root)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Not found") from exc
        # Re-check the resolved path (covers symlinks / normalization surprises).
        if is_private_media_path(rel.as_posix()):
            raise HTTPException(status_code=404, detail="Not found")
        # Re-check tenant ownership on the RESOLVED path so a hop like
        # tenants/a/../b/x cannot reach another tenant's files.
        if not media_path_allowed(rel.as_posix()):
            raise HTTPException(status_code=404, detail="Not found")
        from app.services import object_store

        if object_store.s3_enabled():
            # Authorization and tenant checks above already passed; the object store only supplies the bytes.
            from anyio import to_thread
            from fastapi.responses import Response, StreamingResponse
            from starlette.concurrency import iterate_in_threadpool

            obj = None
            for key in object_store.candidate_keys(rel.as_posix()):
                obj = await to_thread.run_sync(object_store.get_object, key)
                if obj is not None:
                    break
            if obj is not None:
                body = obj["Body"]
                media_type = obj.get("ContentType") or object_store.content_type_for(rel.as_posix())
                headers = {"Cross-Origin-Resource-Policy": "cross-origin"}
                if obj.get("ETag"):
                    headers["ETag"] = obj["ETag"]
                if int(obj["ContentLength"]) <= _MEDIA_SINGLE_RESPONSE_MAX_BYTES:
                    # Normal images/PDFs go out as ONE response message. A streamed body ends with an empty trailing
                    # chunk, and nginx closes its connection as soon as it has the whole file, so that last send hit a
                    # closed connection and logged a ClientDisconnected error on every image view.
                    try:
                        data = await to_thread.run_sync(body.read)
                    finally:
                        body.close()
                    return Response(content=data, media_type=media_type, headers=headers)

                async def _chunks():
                    try:
                        async for chunk in iterate_in_threadpool(body.iter_chunks(1024 * 256)):
                            yield chunk
                    finally:
                        body.close()

                headers["Content-Length"] = str(obj["ContentLength"])
                return StreamingResponse(_chunks(), media_type=media_type, headers=headers)
            if not settings.S3_READ_FALLBACK_TO_DISK:
                raise HTTPException(status_code=404, detail="Not found")
        if not full.is_file():
            # A legacy SiteVision/ path whose original was retired is served from its verified tenant copy.
            from app.services.local_media_service import resolve_stored_file

            alias = resolve_stored_file(rel.as_posix())
            if alias is None:
                raise HTTPException(status_code=404, detail="Not found")
            full = alias
        # CORP lets Photo Sphere Viewer / canvas use the file as a cross-origin
        # texture when the SPA is not on the same host as /media.
        return FileResponse(
            full,
            headers={"Cross-Origin-Resource-Policy": "cross-origin"},
        )

    logger.info(
        f"Media storage={settings.MEDIA_STORAGE} root={media_root} "
        f"require_auth={settings.MEDIA_REQUIRE_AUTH} "
        f"public_base={settings.MEDIA_PUBLIC_BASE_URL or '(relative /media)'}"
    )

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
