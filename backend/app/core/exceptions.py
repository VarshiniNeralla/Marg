from typing import Any, Optional

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger

try:
    from uvicorn.protocols.utils import ClientDisconnected as _ClientDisconnected
except ImportError:
    _ClientDisconnected = None  # type: ignore[assignment,misc]


# ── Base application exception ────────────────────────────────────────────────

class AppException(HTTPException):
    """
    Base for all domain-level exceptions.
    Carries a machine-readable error_code alongside the HTTP status.
    """

    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        detail: Optional[Any] = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.error_code = error_code
        self.message = message
        self.extra_detail = detail


# ── 400 Bad Request ───────────────────────────────────────────────────────────

class BadRequestException(AppException):
    def __init__(self, message: str = "Bad request", detail: Optional[Any] = None) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="BAD_REQUEST",
            message=message,
            detail=detail,
        )


# ── 401 Unauthorized ──────────────────────────────────────────────────────────

class UnauthorizedException(AppException):
    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="UNAUTHORIZED",
            message=message,
        )


class InvalidTokenException(AppException):
    def __init__(self, message: str = "Token is invalid or expired") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="INVALID_TOKEN",
            message=message,
        )


class InvalidCredentialsException(AppException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="INVALID_CREDENTIALS",
            message="Invalid email or password",
        )


# ── 403 Forbidden ─────────────────────────────────────────────────────────────

class ForbiddenException(AppException):
    def __init__(self, message: str = "You do not have permission to perform this action") -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="FORBIDDEN",
            message=message,
        )


class AccountInactiveException(AppException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="ACCOUNT_INACTIVE",
            message="Your account has been deactivated. Contact your administrator.",
        )


class OrganizationSuspendedException(AppException):
    def __init__(self) -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="ORG_SUSPENDED",
            message="Your organization account is suspended.",
        )


# ── 404 Not Found ─────────────────────────────────────────────────────────────

class NotFoundException(AppException):
    def __init__(self, resource: str = "Resource", resource_id: Optional[str] = None) -> None:
        msg = f"{resource} not found"
        if resource_id:
            msg = f"{resource} '{resource_id}' not found"
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="NOT_FOUND",
            message=msg,
        )


# ── 409 Conflict ──────────────────────────────────────────────────────────────

class ConflictException(AppException):
    def __init__(self, message: str = "Resource already exists") -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            error_code="CONFLICT",
            message=message,
        )


# ── 422 Validation (domain-level, separate from Pydantic 422) ─────────────────

class ValidationException(AppException):
    def __init__(self, message: str, detail: Optional[Any] = None) -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            error_code="VALIDATION_ERROR",
            message=message,
            detail=detail,
        )


# ── 429 Rate limited ──────────────────────────────────────────────────────────

class RateLimitException(AppException):
    def __init__(self, message: str = "Too many requests. Please try again later.") -> None:
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code="RATE_LIMITED",
            message=message,
        )


# ── 500 Internal ─────────────────────────────────────────────────────────────

class InternalServerException(AppException):
    def __init__(self, message: str = "An unexpected error occurred") -> None:
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="INTERNAL_ERROR",
            message=message,
        )


# ── Exception handlers registered on the FastAPI app ─────────────────────────

async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Converts AppException subclasses into the standard API envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.error_code,
            "message": exc.message,
            **({"detail": exc.extra_detail} if exc.extra_detail else {}),
        },
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Converts Pydantic RequestValidationError into the standard envelope.
    Flattens Pydantic's nested error format into a flat list for the client.
    """
    errors = []
    for error in exc.errors():
        field = " → ".join(str(loc) for loc in error["loc"] if loc != "body")
        errors.append({"field": field, "message": error["msg"]})

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": "VALIDATION_ERROR",
            "message": "Request validation failed",
            "detail": errors,
        },
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all handler for unhandled exceptions. Logs full traceback."""
    if _ClientDisconnected and isinstance(exc, _ClientDisconnected):
        return JSONResponse(status_code=200, content={})
    logger.exception(f"Unhandled exception on {request.method} {request.url}: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred",
        },
    )
