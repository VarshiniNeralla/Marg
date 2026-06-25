from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

_VALID_SYSTEM_ROLES = ("admin", "manager", "field_engineer", "user", "super_admin", "reviewer", "viewer")


# ── Response schemas ──────────────────────────────────────────────────────────

class AssignedProjectBrief(BaseModel):
    """Compact project assignment embedded in user detail responses."""
    project_id: str
    project_name: str
    project_role: str
    assigned_at: datetime


class UserResponse(BaseModel):
    """
    Public user profile. Omits all security fields by design.
    password_hash, reset_token_hash, reset_token_exp NEVER appear here.
    """
    id: str
    name: str
    email: str
    role: str
    is_active: bool
    designation: Optional[str] = None
    avatar_url: Optional[str] = None
    last_login: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class UserDetailResponse(UserResponse):
    """Full user detail including project assignments — used by GET /users/:id."""
    assigned_projects: list[AssignedProjectBrief] = []


# ── Request schemas ───────────────────────────────────────────────────────────

class UpdateUserRequest(BaseModel):
    """
    Fields that can be updated via PUT /users/:id.
    - name and avatar_url: any authenticated user on their own profile.
    - role and is_active: admin only (enforced in service, not schema).
    The schema accepts all fields; the service layer rejects role/is_active
    changes from non-admins.
    """
    name: Optional[str] = Field(default=None, min_length=2, max_length=100, strip_whitespace=True)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)
    designation: Optional[str] = Field(default=None, max_length=120)
    role: Optional[str] = Field(default=None)
    is_active: Optional[bool] = None

    def has_admin_fields(self) -> bool:
        """Returns True if the request attempts to change admin-only fields."""
        return self.role is not None or self.is_active is not None

    def validate_role(self) -> None:
        if self.role and self.role not in _VALID_SYSTEM_ROLES:
            from app.core.exceptions import ValidationException
            raise ValidationException(
                f"role must be one of: {', '.join(_VALID_SYSTEM_ROLES)}"
            )


# ── List response ─────────────────────────────────────────────────────────────

class UserListResponse(BaseModel):
    """Paginated user list envelope item — leaner than UserDetailResponse."""
    id: str
    name: str
    email: str
    role: str
    is_active: bool
    designation: Optional[str] = None
    avatar_url: Optional[str] = None
    last_login: Optional[datetime] = None
    created_at: datetime
