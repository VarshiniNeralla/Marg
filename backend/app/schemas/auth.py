import re
from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, EmailStr, Field, field_validator

T = TypeVar("T")


# ── Password policy ───────────────────────────────────────────────────────────
# Centralised so it applies identically on register and change-password.
_PASSWORD_REGEX = re.compile(
    r"^(?=.*[A-Z])(?=.*[0-9])(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$"
)


def _validate_password(v: str) -> str:
    if not _PASSWORD_REGEX.match(v):
        raise ValueError(
            "Password must be at least 8 characters and contain "
            "at least one uppercase letter, one digit, and one special character (@$!%*?&)"
        )
    return v


# ── Shared sub-schemas ────────────────────────────────────────────────────────

class UserInfo(BaseModel):
    """Compact user profile embedded in auth responses."""
    id: str
    name: str
    email: str
    role: str
    org_id: str
    org_name: str
    avatar_url: Optional[str] = None


class OrgInfo(BaseModel):
    """Organisation info embedded in registration response."""
    id: str
    name: str
    slug: str


# ── Register ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, strip_whitespace=True)
    email: EmailStr
    password: str = Field(..., min_length=8)
    org_slug: str = Field(..., min_length=3, max_length=50)
    role: Optional[str] = Field(default=None)
    designation: Optional[str] = Field(default=None, max_length=120)

    @field_validator("password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        return _validate_password(v)

    @field_validator("name")
    @classmethod
    def no_html_in_name(cls, v: str) -> str:
        if re.search(r"[<>\"&]", v):
            raise ValueError("Name must not contain HTML characters")
        return v


class RegisterResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    org: OrgInfo
    created_at: datetime


# ── Login ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    user: UserInfo


# ── Refresh token ─────────────────────────────────────────────────────────────

class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"


# ── Forgot password ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


# ── Reset password ────────────────────────────────────────────────────────────

class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        return _validate_password(v)


# ── Change password (authenticated) ──────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        return _validate_password(v)


# ── GET /auth/me response ──────────────────────────────────────────────────────

class MeResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    org_id: str
    org_name: str
    org_slug: str
    avatar_url: Optional[str] = None
    last_login: Optional[datetime] = None
    created_at: datetime


# ── Standard API envelope ─────────────────────────────────────────────────────

class ApiResponse(BaseModel, Generic[T]):
    """Generic single-item API envelope. Use ApiResponse[SomeModel] as response_model."""
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None
