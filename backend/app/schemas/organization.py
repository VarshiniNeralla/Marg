import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

_SLUG_REGEX = re.compile(r"^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$")
_VALID_PLANS = ("free", "starter", "professional", "enterprise")
_VALID_STATUSES = ("active", "suspended", "cancelled")


# ── Sub-schemas ───────────────────────────────────────────────────────────────

class OrgSettingsSchema(BaseModel):
    max_projects: Optional[int] = Field(default=None, ge=1, le=10000)
    max_users: Optional[int] = Field(default=None, ge=1, le=10000)
    storage_limit_gb: Optional[float] = Field(default=None, ge=1.0, le=100000.0)


class OrgStatsSchema(BaseModel):
    total_projects: int = 0
    total_users: int = 0
    storage_used_gb: float = 0.0


# ── Create (super_admin only) ─────────────────────────────────────────────────

class CreateOrganizationRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, strip_whitespace=True)
    slug: str = Field(..., min_length=3, max_length=50)
    plan: str = Field(default="free")
    owner_email: str  # must match an existing user — validated in service layer
    settings: Optional[OrgSettingsSchema] = None

    @field_validator("slug")
    @classmethod
    def slug_format(cls, v: str) -> str:
        v = v.lower().strip()
        if not _SLUG_REGEX.match(v):
            raise ValueError(
                "Slug must be 3–50 characters, lowercase alphanumeric and hyphens, "
                "cannot start or end with a hyphen"
            )
        return v

    @field_validator("plan")
    @classmethod
    def valid_plan(cls, v: str) -> str:
        if v not in _VALID_PLANS:
            raise ValueError(f"Plan must be one of: {', '.join(_VALID_PLANS)}")
        return v


# ── Update (org admin) ────────────────────────────────────────────────────────

class UpdateOrganizationRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100, strip_whitespace=True)
    logo_url: Optional[str] = Field(default=None, max_length=2048)
    settings: Optional[OrgSettingsSchema] = None


# ── Responses ─────────────────────────────────────────────────────────────────

class OrganizationResponse(BaseModel):
    """Full organisation detail — returned to admin users."""
    id: str
    name: str
    slug: str
    plan: str
    status: str
    logo_url: Optional[str] = None
    settings: dict
    created_at: datetime
    updated_at: datetime


class OrganizationMeResponse(BaseModel):
    """
    Org detail enriched with live stats — returned by GET /organizations/me.
    Stats are computed at query time (small counts) until analytics snapshots exist.
    """
    id: str
    name: str
    slug: str
    plan: str
    status: str
    logo_url: Optional[str] = None
    settings: dict
    stats: OrgStatsSchema
    created_at: datetime
    updated_at: datetime
