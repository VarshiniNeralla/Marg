import time
from uuid import uuid4

from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Structured HTTP request/response logging middleware.

    For every request:
    - Assigns a unique X-Request-ID header (or uses the one sent by the client).
    - Logs method, path, status code, and response time.
    - Propagates X-Request-ID in the response for client-side correlation.

    Sensitive paths (login, register) are logged at DEBUG level to avoid
    capturing credentials in log aggregators.
    """

    _SENSITIVE_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}
    _SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip noisy non-business paths
        if request.url.path in self._SKIP_PATHS:
            return await call_next(request)

        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        start_time = time.perf_counter()

        # Make request_id available to downstream code via request.state
        request.state.request_id = request_id

        try:
            response: Response = await call_next(request)
        except Exception as exc:
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.error(
                f"[{request_id}] {request.method} {request.url.path} "
                f"UNHANDLED ERROR ({elapsed:.1f}ms) — {type(exc).__name__}: {exc}"
            )
            raise

        elapsed = (time.perf_counter() - start_time) * 1000
        status_code = response.status_code

        log_fn = logger.info
        if status_code >= 500:
            log_fn = logger.error
        elif status_code >= 400:
            log_fn = logger.warning
        elif request.url.path in self._SENSITIVE_PATHS:
            log_fn = logger.debug

        log_fn(
            f"[{request_id}] {request.method} {request.url.path} "
            f"→ {status_code} ({elapsed:.1f}ms)"
        )

        response.headers["X-Request-ID"] = request_id
        return response
