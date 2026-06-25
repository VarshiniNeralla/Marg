import time
from uuid import uuid4

from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.datastructures import MutableHeaders

try:
    from uvicorn.protocols.utils import ClientDisconnected as _ClientDisconnected
except ImportError:
    _ClientDisconnected = None  # type: ignore[assignment,misc]


class RequestLoggingMiddleware:
    """
    Pure-ASGI request/response logging middleware.

    Uses the raw ASGI interface (not BaseHTTPMiddleware) to avoid the known
    Starlette bug where BaseHTTPMiddleware strips headers set by inner
    middleware — which breaks CORSMiddleware preflight responses.
    """

    _SENSITIVE_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}
    _SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")

        # Skip non-business paths and CORS preflight
        if path in self._SKIP_PATHS or method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        request_id = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                request_id = value.decode()
                break
        if not request_id:
            request_id = str(uuid4())

        # Expose request_id to downstream via scope state
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        start_time = time.perf_counter()
        status_code = 500

        async def send_with_logging(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                # Inject X-Request-ID into response headers
                headers = MutableHeaders(scope=message)
                headers.append("x-request-id", request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_logging)
        except Exception as exc:
            # Client closed the connection before the response was fully sent.
            # This is normal in SPAs during navigation — not a server error.
            if _ClientDisconnected and isinstance(exc, _ClientDisconnected):
                return
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.error(
                f"[{request_id}] {method} {path} "
                f"UNHANDLED ERROR ({elapsed:.1f}ms) — {type(exc).__name__}: {exc}"
            )
            raise
        finally:
            elapsed = (time.perf_counter() - start_time) * 1000
            log_fn = logger.info
            if status_code >= 500:
                log_fn = logger.error
            elif status_code >= 400:
                log_fn = logger.warning
            elif path in self._SENSITIVE_PATHS:
                log_fn = logger.debug

            log_fn(f"[{request_id}] {method} {path} → {status_code} ({elapsed:.1f}ms)")
