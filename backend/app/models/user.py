from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from app.models.organization import PyObjectId


class UserDocument(BaseModel):
    """
    Mirrors the users MongoDB collection schema.
    Contains sensitive fields (password_hash, reset_token_hash) that must
    NEVER be included in API response schemas.
    """

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}

    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    # ── Identity ──────────────────────────────────────────────────────────────
    org_id: PyObjectId
    name: str
    email: str  # lowercase, validated at schema layer before write

    # ── Security — never serialised in API responses ───────────────────────────
    password_hash: str

    # ── Role ──────────────────────────────────────────────────────────────────
    # super_admin is a platform-level role assigned manually — never via API.
    role: str = "user"  # super_admin | admin | user

    # ── Status ────────────────────────────────────────────────────────────────
    is_active: bool = True

    # ── Profile ───────────────────────────────────────────────────────────────
    avatar_url: Optional[str] = None

    # ── Password reset ────────────────────────────────────────────────────────
    # raw token is NEVER stored — only the bcrypt hash
    reset_token_hash: Optional[str] = None
    reset_token_exp: Optional[datetime] = None

    # ── Timestamps ────────────────────────────────────────────────────────────
    last_login: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_mongo(self) -> dict:
        """
        Serialises for MongoDB insertion.
        Excludes the Pydantic `id` alias — MongoDB manages _id on insert.
        """
        return self.model_dump(exclude={"id"}, by_alias=False)

    @classmethod
    def from_mongo(cls, data: dict) -> Optional["UserDocument"]:
        """Deserialises a raw MongoDB document."""
        if data is None:
            return None
        if "_id" in data:
            data["_id"] = str(data["_id"])
        if "org_id" in data:
            data["org_id"] = str(data["org_id"])
        return cls(**data)

    def is_reset_token_valid(self) -> bool:
        """Returns True if a reset token exists and has not expired."""
        if not self.reset_token_hash or not self.reset_token_exp:
            return False
        return datetime.now(timezone.utc) < self.reset_token_exp
