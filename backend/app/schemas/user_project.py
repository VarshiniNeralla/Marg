from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.user_project import PROJECT_ROLES


# ── Request schemas ───────────────────────────────────────────────────────────

class CreateAssignmentRequest(BaseModel):
    user_id: str = Field(..., description="ObjectId of the user to assign")
    project_role: str = Field(..., description="viewer | contributor | manager | admin")
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("project_role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in PROJECT_ROLES:
            raise ValueError(f"project_role must be one of: {', '.join(PROJECT_ROLES)}")
        return v


class UpdateAssignmentRequest(BaseModel):
    project_role: str = Field(..., description="viewer | contributor | manager | admin")

    @field_validator("project_role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in PROJECT_ROLES:
            raise ValueError(f"project_role must be one of: {', '.join(PROJECT_ROLES)}")
        return v


# ── Response schemas ──────────────────────────────────────────────────────────

class AssignmentResponse(BaseModel):
    """
    Full assignment record. user_name/email are denormalised from the users
    collection at service layer to avoid N+1 lookups in the list endpoint.
    """
    id: str
    user_id: str
    user_name: str
    user_email: str
    user_avatar: Optional[str] = None
    project_id: str
    project_role: str
    assigned_by: str
    assigned_at: datetime
    is_active: bool
    revoked_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime


class AssignmentBriefResponse(BaseModel):
    """Compact assignment used in user-detail responses and project summaries."""
    assignment_id: str
    project_id: str
    project_name: str
    project_role: str
    assigned_at: datetime
    is_active: bool
