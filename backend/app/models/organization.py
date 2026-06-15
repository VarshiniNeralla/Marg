from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from pydantic import BaseModel, Field, field_validator


class PyObjectId(str):
    """
    Custom type that coerces a bson.ObjectId to/from a plain string.
    Allows Pydantic models to accept ObjectId values from MongoDB documents
    and serialise them as strings in JSON responses.
    """

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return str(v)
        if isinstance(v, str) and ObjectId.is_valid(v):
            return v
        raise ValueError(f"Invalid ObjectId: {v}")

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema
        return core_schema.no_info_plain_validator_function(cls.validate)


# ── Sub-documents ─────────────────────────────────────────────────────────────

class OrgSettings(BaseModel):
    max_projects: int = 10
    max_users: int = 20
    storage_limit_gb: float = 50.0
    allowed_roles: list[str] = ["viewer", "contributor", "manager", "admin"]


class OrgBilling(BaseModel):
    contact_email: Optional[str] = None
    subscription_id: Optional[str] = None  # Stripe ID — future


# ── Main document ─────────────────────────────────────────────────────────────

class OrganizationDocument(BaseModel):
    """
    Mirrors the organizations MongoDB collection schema exactly.
    Used when reading from / writing to the database.
    Not exposed directly to API consumers — see schemas/organization.py for that.
    """

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}

    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    name: str
    slug: str
    plan: str = "free"  # free | starter | professional | enterprise
    status: str = "active"  # active | suspended | cancelled
    owner_id: Optional[PyObjectId] = None
    settings: OrgSettings = Field(default_factory=OrgSettings)
    billing: OrgBilling = Field(default_factory=OrgBilling)
    logo_url: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_mongo(self) -> dict:
        """
        Serialises the document for MongoDB insertion.
        Excludes the `id` field (MongoDB manages _id itself on insert).
        Converts nested models to plain dicts.
        """
        data = self.model_dump(exclude={"id"}, by_alias=False)
        return data

    @classmethod
    def from_mongo(cls, data: dict) -> "OrganizationDocument":
        """Deserialises a raw MongoDB document into this model."""
        if data is None:
            return None
        if "_id" in data:
            data["_id"] = str(data["_id"])
        return cls(**data)
