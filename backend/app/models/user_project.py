from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from app.models.organization import PyObjectId

# ── Project-scoped role definitions ──────────────────────────────────────────
# These are DISTINCT from system roles (users.role).
# System role is the outer gate; project role is the inner gate.
PROJECT_ROLES = ("viewer", "contributor", "manager", "admin")


class UserProjectDocument(BaseModel):
    """
    Mirrors the user_projects MongoDB collection.

    One document = one active or historical assignment of a user to a project.
    Records are NEVER hard-deleted — revocation sets is_active=False and stamps
    revoked_at/revoked_by. This preserves a full audit trail of who had
    access to what, and when that access was granted or removed.

    The unique partial index on { org_id, user_id, project_id } WHERE is_active=True
    ensures a user cannot have two concurrent active assignments to the same project,
    while still allowing re-assignment after revocation.
    """

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}

    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    # ── Tenant scope ──────────────────────────────────────────────────────────
    org_id: PyObjectId

    # ── Assignment ────────────────────────────────────────────────────────────
    user_id: PyObjectId
    project_id: PyObjectId

    # ── Role ──────────────────────────────────────────────────────────────────
    # viewer | contributor | manager | admin
    project_role: str = "viewer"

    # ── Assignment provenance ─────────────────────────────────────────────────
    assigned_by: PyObjectId       # user_id of the admin who created this assignment
    assigned_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    notes: Optional[str] = None

    # ── Revocation ────────────────────────────────────────────────────────────
    is_active: bool = True
    revoked_at: Optional[datetime] = None
    revoked_by: Optional[PyObjectId] = None

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_mongo(self) -> dict:
        """Serialises for MongoDB insertion. Excludes the Pydantic id alias."""
        from bson import ObjectId
        data = self.model_dump(exclude={"id"}, by_alias=False)
        # Convert all PyObjectId string fields to bson ObjectId for proper indexing
        for field in ("org_id", "user_id", "project_id", "assigned_by", "revoked_by"):
            if data.get(field) and ObjectId.is_valid(data[field]):
                data[field] = ObjectId(data[field])
        return data

    @classmethod
    def from_mongo(cls, data: dict) -> Optional["UserProjectDocument"]:
        """Deserialises a raw MongoDB document."""
        if data is None:
            return None
        if "_id" in data:
            data["_id"] = str(data["_id"])
        for field in ("org_id", "user_id", "project_id", "assigned_by", "revoked_by"):
            if data.get(field) is not None:
                data[field] = str(data[field])
        return cls(**data)
