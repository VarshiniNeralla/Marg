from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.user_project import UserProjectDocument
from app.repositories.base import BaseRepository


class UserProjectRepository(BaseRepository[UserProjectDocument]):
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        super().__init__(db, "user_projects", UserProjectDocument)

    # ── Core RBAC query — called on every protected request ───────────────────

    async def get_project_role(
        self, user_id: str, project_id: str, org_id: str
    ) -> Optional[str]:
        """
        Returns the project_role string for an active assignment, or None.
        This is the hot-path RBAC query. The compound index
        { org_id, user_id, project_id } WHERE is_active=True
        makes this a single-document index scan.
        """
        doc = await self._collection.find_one(
            {
                "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
                "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
                "project_id": ObjectId(project_id) if ObjectId.is_valid(project_id) else project_id,
                "is_active": True,
            },
            {"project_role": 1},  # projection — only fetch the role field
        )
        return doc["project_role"] if doc else None

    # ── Assignment lookup ─────────────────────────────────────────────────────

    async def find_active_assignment(
        self, user_id: str, project_id: str, org_id: str
    ) -> Optional[UserProjectDocument]:
        """Returns the full active assignment document, or None."""
        return await self.find_one({
            "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
            "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
            "project_id": ObjectId(project_id) if ObjectId.is_valid(project_id) else project_id,
            "is_active": True,
        })

    async def find_by_id_and_org(
        self, assignment_id: str, org_id: str
    ) -> Optional[UserProjectDocument]:
        """Fetches any assignment (active or historical) scoped to the org."""
        return await self.find_by_id(assignment_id, org_id=org_id)

    # ── List queries ──────────────────────────────────────────────────────────

    async def list_by_project(
        self,
        project_id: str,
        org_id: str,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 50,
    ):
        """Lists all (active) assignments for a project."""
        f: dict = {
            "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
            "project_id": ObjectId(project_id) if ObjectId.is_valid(project_id) else project_id,
        }
        if active_only:
            f["is_active"] = True
        return await self.find_many(f, skip=skip, limit=limit, sort=[("assigned_at", -1)])

    async def list_by_user(
        self,
        user_id: str,
        org_id: str,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 50,
    ):
        """Lists all project assignments for a user."""
        f: dict = {
            "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
            "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
        }
        if active_only:
            f["is_active"] = True
        return await self.find_many(f, skip=skip, limit=limit, sort=[("assigned_at", -1)])

    async def get_accessible_project_ids(
        self, user_id: str, org_id: str
    ) -> list[str]:
        """
        Returns a list of project_id strings the user currently has active access to.
        Used by project-list endpoints to filter visible projects for non-admin users.
        Deliberately returns only string IDs — not full documents — for speed.
        """
        cursor = self._collection.find(
            {
                "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
                "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
                "is_active": True,
            },
            {"project_id": 1},
        )
        docs = await cursor.to_list(length=1000)
        return [str(d["project_id"]) for d in docs]

    # ── Write methods ─────────────────────────────────────────────────────────

    async def create(self, assignment: UserProjectDocument) -> str:
        """Inserts a new assignment and returns the new _id."""
        return await self.insert_one(assignment.to_mongo())

    async def revoke(
        self, assignment_id: str, revoked_by: str, org_id: str
    ) -> bool:
        """
        Soft-revokes an assignment by setting is_active=False.
        Returns True if the document was found and updated.
        The org_id guard ensures an admin from Org A cannot revoke assignments in Org B.
        """
        from bson import ObjectId as BsonOID
        now = datetime.now(timezone.utc)
        result = await self._collection.update_one(
            {
                "_id": BsonOID(assignment_id) if BsonOID.is_valid(assignment_id) else assignment_id,
                "org_id": BsonOID(org_id) if BsonOID.is_valid(org_id) else org_id,
                "is_active": True,
            },
            {
                "$set": {
                    "is_active": False,
                    "revoked_at": now,
                    "revoked_by": BsonOID(revoked_by) if BsonOID.is_valid(revoked_by) else revoked_by,
                    "updated_at": now,
                }
            },
        )
        return result.modified_count > 0

    async def update_role(
        self, assignment_id: str, new_role: str, org_id: str
    ) -> Optional[UserProjectDocument]:
        """Updates the project_role on an active assignment."""
        now = datetime.now(timezone.utc)
        return await self.update_by_id(
            assignment_id,
            {"project_role": new_role, "updated_at": now},
            org_id=org_id,
        )

    # ── Existence check ───────────────────────────────────────────────────────

    async def active_assignment_exists(
        self, user_id: str, project_id: str, org_id: str
    ) -> bool:
        """Used before creating an assignment to detect duplicates."""
        return await self.exists({
            "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
            "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
            "project_id": ObjectId(project_id) if ObjectId.is_valid(project_id) else project_id,
            "is_active": True,
        })
