from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.organization import OrganizationDocument
from app.repositories.base import BaseRepository


class OrganizationRepository(BaseRepository[OrganizationDocument]):
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        super().__init__(db, "organizations", OrganizationDocument)

    # ── Lookup methods ────────────────────────────────────────────────────────

    async def find_by_slug(self, slug: str) -> Optional[OrganizationDocument]:
        return await self.find_one({"slug": slug.lower()})

    async def find_by_name(self, name: str) -> Optional[OrganizationDocument]:
        return await self.find_one({"name": name})

    async def find_active_by_slug(self, slug: str) -> Optional[OrganizationDocument]:
        """Used during registration — ensures users can only join active orgs."""
        return await self.find_one({"slug": slug.lower(), "status": "active"})

    # ── Write methods ─────────────────────────────────────────────────────────

    async def create(self, org: OrganizationDocument) -> str:
        doc = org.to_mongo()
        if doc.get("owner_id") and ObjectId.is_valid(doc["owner_id"]):
            doc["owner_id"] = ObjectId(doc["owner_id"])
        return await self.insert_one(doc)

    async def update_settings(self, org_id: str, fields: dict) -> Optional[OrganizationDocument]:
        fields["updated_at"] = datetime.now(timezone.utc)
        return await self.update_by_id(org_id, fields)

    async def set_status(self, org_id: str, status: str) -> None:
        await self.update_one(
            {"_id": ObjectId(org_id)},
            {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
        )

    # ── Existence checks ──────────────────────────────────────────────────────

    async def slug_exists(self, slug: str) -> bool:
        return await self.exists({"slug": slug.lower()})

    async def name_exists(self, name: str) -> bool:
        return await self.exists({"name": name})
