from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.user import UserDocument
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[UserDocument]):
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        super().__init__(db, "users", UserDocument)

    # ── Lookup methods ────────────────────────────────────────────────────────

    async def find_by_email(self, email: str) -> Optional[UserDocument]:
        """Case-insensitive email lookup (emails are stored lowercase)."""
        return await self.find_one({"email": email.lower()})

    async def find_by_id_and_org(self, user_id: str, org_id: str) -> Optional[UserDocument]:
        """Finds a user only if they belong to the given org (tenant isolation)."""
        return await self.find_by_id(user_id, org_id=org_id)

    async def find_by_reset_token_lookup(self, email: str) -> Optional[UserDocument]:
        """
        Finds a user with a non-expired reset token by email.
        Full token verification (bcrypt) is done in the service layer.
        """
        now = datetime.now(timezone.utc)
        return await self.find_one({
            "email": email.lower(),
            "reset_token_hash": {"$ne": None},
            "reset_token_exp": {"$gt": now},
        })

    # ── Write methods ─────────────────────────────────────────────────────────

    async def create(self, user: UserDocument) -> str:
        """Inserts a new user. Returns the new _id as a string."""
        doc = user.to_mongo()
        # Ensure email is always lowercase in the DB
        doc["email"] = doc["email"].lower()
        # Store org_id as ObjectId for indexed queries
        if doc.get("org_id") and ObjectId.is_valid(doc["org_id"]):
            doc["org_id"] = ObjectId(doc["org_id"])
        return await self.insert_one(doc)

    async def update_last_login(self, user_id: str) -> None:
        await self.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"last_login": datetime.now(timezone.utc)}},
        )

    async def set_reset_token(
        self, user_id: str, token_hash: str, expires_at: datetime
    ) -> None:
        await self.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "reset_token_hash": token_hash,
                    "reset_token_exp": expires_at,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def clear_reset_token(self, user_id: str) -> None:
        await self.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "reset_token_hash": None,
                    "reset_token_exp": None,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def update_password(self, user_id: str, new_password_hash: str) -> None:
        await self.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "password_hash": new_password_hash,
                    "reset_token_hash": None,
                    "reset_token_exp": None,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    async def update_profile(self, user_id: str, org_id: str, fields: dict) -> Optional[UserDocument]:
        """Updates mutable profile fields (name, avatar_url)."""
        fields["updated_at"] = datetime.now(timezone.utc)
        return await self.update_by_id(user_id, fields, org_id=org_id)

    async def set_active(self, user_id: str, is_active: bool) -> None:
        await self.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"is_active": is_active, "updated_at": datetime.now(timezone.utc)}},
        )

    # ── Existence checks ──────────────────────────────────────────────────────

    async def email_exists(self, email: str) -> bool:
        return await self.exists({"email": email.lower()})

    # ── List ──────────────────────────────────────────────────────────────────

    async def list_by_org(
        self,
        org_id: str,
        skip: int = 0,
        limit: int = 20,
        role: Optional[str] = None,
        is_active: Optional[bool] = None,
    ):
        filter: dict = {"org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id}
        if role:
            filter["role"] = role
        if is_active is not None:
            filter["is_active"] = is_active

        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("created_at", -1)],
        )
