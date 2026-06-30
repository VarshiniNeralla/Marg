from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Cookie, Request, Response, status

from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.core.dependencies import CurrentUser, DB, OptionalCurrentUser, RefreshTokenCookie
from app.core.exceptions import ConflictException, ValidationException
from app.core.security import hash_password, verify_password
from app.repositories.user import UserRepository
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    OrgInfo,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    UserInfo,
)
from app.services.auth_service import AuthService
from app.utils.pagination import success_response

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["Authentication"])


def _rate_limit(limit_value: str):
    """Apply a slowapi rate limit if the limiter built successfully; else no-op.
    Keeps the endpoints decoratable even when slowapi/Redis are unavailable."""
    if limiter is not None:
        return limiter.limit(limit_value)

    def _noop(func):
        return func

    return _noop

# ── Cookie configuration ──────────────────────────────────────────────────────
_COOKIE_NAME = "refresh_token"
_COOKIE_MAX_AGE = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60  # seconds
# SameSite "none" is required when frontend & backend are on different sites so
# the browser sends the cookie on the cross-site /auth/refresh request fired on
# page load; "none" mandates Secure=True (enforced by settings.cookie_secure).
_COOKIE_SAMESITE = settings.cookie_samesite
_COOKIE_SECURE = settings.cookie_secure


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Sets the httpOnly refresh token cookie on the response."""
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
        path="/api/v1/auth",  # Scoped to auth paths only — reduces attack surface
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Clears the refresh token cookie (logout)."""
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/api/v1/auth",
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
    )


# ── POST /auth/register ───────────────────────────────────────────────────────

@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    response_description="Created user profile",
)
@_rate_limit(settings.RATE_LIMIT_REGISTER)
async def register(request: Request, payload: RegisterRequest, db: DB, caller: OptionalCurrentUser = None):
    """
    Registers a new user under an existing active organisation.
    - Email must be globally unique.
    - org_slug must reference an active organisation.
    - Password is validated against the security policy.
    - Anonymous self-registration is always assigned role "user"; a client-supplied
      role is ignored. Only an authenticated admin (presenting a Bearer token) may
      assign an elevated role, and only within their own organisation. This closes
      the privilege-escalation hole where anyone could register as super_admin.
    """
    service = AuthService(db)
    user, org = await service.register(payload, caller=caller)

    return success_response(
        data=RegisterResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            org=OrgInfo(id=org.id, name=org.name, slug=org.slug),
            created_at=user.created_at,
        ),
        message="Registration successful. Please log in.",
    )


# ── POST /auth/login ──────────────────────────────────────────────────────────

@router.post(
    "/login",
    status_code=status.HTTP_200_OK,
    summary="Authenticate and receive tokens",
)
@_rate_limit(settings.RATE_LIMIT_LOGIN)
async def login(request: Request, payload: LoginRequest, response: Response, db: DB):
    """
    Authenticates a user/admin.
    - Returns access_token in response body (store in memory only).
    - Sets refresh_token as httpOnly cookie (not accessible to JS).
    """
    service = AuthService(db)
    user, org, access_token, refresh_token, assigned_project_ids = await service.login(payload)

    _set_refresh_cookie(response, refresh_token)

    return success_response(
        data=LoginResponse(
            access_token=access_token,
            token_type="Bearer",
            user=UserInfo(
                id=user.id,
                name=user.name,
                email=user.email,
                role=user.role,
                org_id=str(user.org_id),
                org_name=org.name,
                avatar_url=user.avatar_url,
                assigned_project_ids=assigned_project_ids,
            ),
        ),
        message="Login successful",
    )


# ── POST /auth/refresh ────────────────────────────────────────────────────────

@router.post(
    "/refresh",
    status_code=status.HTTP_200_OK,
    summary="Refresh access token using cookie",
)
async def refresh_token(
    response: Response,
    db: DB,
    token: RefreshTokenCookie,
):
    """
    Issues a new access token + refresh token pair (token rotation).
    - Reads refresh_token from httpOnly cookie.
    - Old refresh token is invalidated; new cookie is set.
    """
    service = AuthService(db)
    new_access_token, new_refresh_token = await service.refresh_access_token(token)

    _set_refresh_cookie(response, new_refresh_token)

    return success_response(
        data=RefreshResponse(access_token=new_access_token, token_type="Bearer"),
    )


# ── POST /auth/logout ─────────────────────────────────────────────────────────

@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Revoke session and clear cookie",
)
async def logout(
    response: Response,
    current_user: CurrentUser,
    db: DB,
    refresh_token: Optional[str] = Cookie(default=None, alias="refresh_token"),
):
    """
    Revokes the current refresh token (so it cannot be reused even if captured)
    and clears the cookie. The access token is short-lived (15 min) and expires
    naturally.
    """
    if refresh_token:
        await AuthService(db).revoke_refresh_token(refresh_token)
    _clear_refresh_cookie(response)
    return success_response(data=None, message="Logged out successfully")


# ── POST /auth/forgot-password ────────────────────────────────────────────────

@router.post(
    "/forgot-password",
    status_code=status.HTTP_200_OK,
    summary="Request a password reset email",
)
@_rate_limit(settings.RATE_LIMIT_FORGOT_PASSWORD)
async def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: DB,
):
    """
    Initiates password reset. Always returns 200 regardless of whether
    the email is registered — prevents user enumeration attacks.
    Email is sent as a background task to keep response latency low.
    """
    service = AuthService(db)
    background_tasks.add_task(service.forgot_password, payload.email)

    return success_response(
        data=None,
        message="If this email is registered, a reset link has been sent.",
    )


# ── POST /auth/reset-password ─────────────────────────────────────────────────

@router.post(
    "/reset-password",
    status_code=status.HTTP_200_OK,
    summary="Set new password using reset token",
)
async def reset_password(payload: ResetPasswordRequest, db: DB):
    """
    Resets the user's password using the one-time token from the reset email.
    - Token is verified via bcrypt (raw vs stored hash).
    - Token is single-use and expires in 15 minutes.
    - All active refresh tokens for this user are revoked on success.
    """
    service = AuthService(db)
    await service.reset_password(payload.token, payload.new_password)

    return success_response(
        data=None,
        message="Password reset successful. Please log in.",
    )


# ── GET /auth/me ──────────────────────────────────────────────────────────────

@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
    summary="Get current authenticated user profile",
    response_model=None,
)
async def get_me(current_user: CurrentUser, db: DB):
    """
    Returns the current user's profile with their organisation info.
    Requires a valid access token in the Authorization header.
    """
    service = AuthService(db)
    me = await service.get_me(current_user.id, str(current_user.org_id))
    return success_response(data=me)


# ── PUT /auth/me/password ─────────────────────────────────────────────────────

@router.put(
    "/me/password",
    status_code=status.HTTP_200_OK,
    summary="Change own password while authenticated",
)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUser,
    db: DB,
):
    """
    Changes the authenticated user's password.
    - Requires current_password verification.
    - Enforces password policy on new_password.
    - Rejects if new password is identical to the current one.
    """
    if not verify_password(payload.current_password, current_user.password_hash):
        raise ConflictException("Current password is incorrect")

    if verify_password(payload.new_password, current_user.password_hash):
        raise ValidationException("New password must be different from the current password")

    user_repo = UserRepository(db)
    new_hash = hash_password(payload.new_password)
    await user_repo.update_password(current_user.id, new_hash)

    return success_response(data=None, message="Password changed successfully")
