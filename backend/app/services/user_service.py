from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import (
    ConflictException,
    ForbiddenException,
    NotFoundException,
    ValidationException,
)
from app.models.user import UserDocument
from app.services.security_audit import write_security_audit
from app.repositories.user import UserRepository
from app.repositories.user_project import UserProjectRepository
from app.schemas.user import (
    AssignedProjectBrief,
    UpdateUserRequest,
    UserDetailResponse,
    UserListResponse,
    UserResponse,
)
from app.schemas.user_project import AssignmentBriefResponse


class UserService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._user_repo = UserRepository(db)
        self._up_repo = UserProjectRepository(db)
        self._db = db

    # ── GET /users ────────────────────────────────────────────────────────────

    async def list_users(
        self,
        org_id: str,
        skip: int = 0,
        limit: int = 20,
        role: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> tuple[list[UserListResponse], int]:
        users, total = await self._user_repo.list_by_org(
            org_id=org_id,
            skip=skip,
            limit=limit,
            role=role,
            is_active=is_active,
        )
        return [self._to_list_response(u) for u in users], total

    # ── Favorite tours (persist until user clears) ────────────────────────────

    async def get_favorite_tour_ids(self, user_id: str, org_id: str) -> list[str]:
        doc = await self._find_user_doc(user_id, org_id)
        if not doc:
            raise NotFoundException("User", user_id)
        raw = doc.get("favorite_tour_ids") or []
        return [str(x).strip() for x in raw if str(x).strip()]

    async def set_favorite_tour_ids(
        self, user_id: str, org_id: str, tour_ids: list[str]
    ) -> list[str]:
        doc = await self._find_user_doc(user_id, org_id)
        if not doc:
            raise NotFoundException("User", user_id)

        seen: set[str] = set()
        clean: list[str] = []
        for tid in tour_ids:
            s = str(tid or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            clean.append(s)
            if len(clean) >= 500:
                break

        await self._db.users.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "favorite_tour_ids": clean,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        return clean

    async def _find_user_doc(self, user_id: str, org_id: str) -> Optional[dict]:
        def _variants(v: str) -> list:
            out: list = [v]
            if ObjectId.is_valid(v):
                out.append(ObjectId(v))
            return out

        return await self._db.users.find_one({
            "_id": {"$in": _variants(user_id)},
            "org_id": {"$in": _variants(org_id)},
        })

    # ── GET /users/:id ────────────────────────────────────────────────────────

    async def get_user(
        self, user_id: str, org_id: str, include_projects: bool = True
    ) -> UserDetailResponse:
        """
        Fetches a user scoped to the org.
        org_id in the filter ensures cross-org access is structurally impossible.
        """
        user = await self._user_repo.find_by_id(user_id, org_id=org_id)
        if not user:
            raise NotFoundException("User", user_id)

        assigned_projects: list[AssignedProjectBrief] = []
        if include_projects:
            # Query raw documents: project_id may be a plain string ("p72518")
            # that the strict UserProjectDocument model would reject.
            def _variants(v: str) -> list:
                out: list = [v]
                if ObjectId.is_valid(v):
                    out.append(ObjectId(v))
                return out

            cursor = self._db.user_projects.find({
                "user_id": {"$in": _variants(user_id)},
                "org_id": {"$in": _variants(org_id)},
                "is_active": True,
            })
            for a in await cursor.to_list(length=200):
                pid = str(a["project_id"])
                proj_doc = await self._db.projects.find_one(
                    {"_id": ObjectId(pid) if ObjectId.is_valid(pid) else pid},
                    {"name": 1},
                )
                proj_name = proj_doc["name"] if proj_doc else "Unknown Project"
                assigned_projects.append(AssignedProjectBrief(
                    project_id=pid,
                    project_name=proj_name,
                    project_role=a.get("project_role", "contributor"),
                    assigned_at=a.get("assigned_at") or datetime.now(timezone.utc),
                ))

        return UserDetailResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
            avatar_url=user.avatar_url,
            last_login=user.last_login,
            created_at=user.created_at,
            updated_at=user.updated_at,
            assigned_projects=assigned_projects,
        )

    # ── PUT /users/:id ────────────────────────────────────────────────────────

    async def update_user(
        self,
        target_user_id: str,
        org_id: str,
        caller_id: str,
        caller_role: str,
        payload: UpdateUserRequest,
    ) -> UserResponse:
        """
        Updates a user. Permission rules:
        - Any authenticated user can update their own name/avatar_url.
        - Only admins can change role or is_active.
        - Managers may update a field engineer's profile (name/designation) —
          but never role/is_active, and never another admin/manager's account.
        - An admin cannot demote their own role (self-demotion prevention).
        """
        payload.validate_role()

        # Verify target exists in this org
        target = await self._user_repo.find_by_id(target_user_id, org_id=org_id)
        if not target:
            raise NotFoundException("User", target_user_id)

        is_self = caller_id == target_user_id
        is_admin = caller_role in ("admin", "super_admin")
        is_manager_editing_engineer = (
            caller_role == "manager" and target.role == "field_engineer"
        )

        # Non-admins can only update their own profile, or (managers only) a field engineer's
        if not is_admin and not is_self and not is_manager_editing_engineer:
            raise ForbiddenException("You can only update your own profile")

        # Only admins can set role or is_active — even a manager editing a field engineer
        # cannot promote/demote or reactivate/deactivate.
        if payload.has_admin_fields() and not is_admin:
            raise ForbiddenException("Only administrators can change role or active status")

        # Prevent admin from demoting their own role
        if is_self and payload.role is not None and payload.role != target.role:
            if target.role in ("admin", "super_admin"):
                raise ForbiddenException(
                    "Administrators cannot change their own role. "
                    "Ask another admin to do this."
                )

        # Prevent self-deactivation (lockout)
        if is_self and payload.is_active is False:
            raise ForbiddenException("You cannot deactivate your own account")

        # Cap assignable roles the same way register does
        if is_admin and payload.role is not None and payload.role != target.role:
            assignable = self._assignable_roles(caller_role)
            if payload.role not in assignable:
                raise ForbiddenException(
                    f"You cannot assign role '{payload.role}'. "
                    f"Allowed: {', '.join(sorted(assignable))}"
                )

        # Last-admin protection: demote / deactivate must leave ≥1 active admin
        becoming_non_admin = (
            is_admin
            and target.role in ("admin", "super_admin")
            and target.is_active
            and (
                (payload.role is not None and payload.role not in ("admin", "super_admin"))
                or payload.is_active is False
            )
        )
        if becoming_non_admin:
            await self._ensure_another_active_admin(org_id, excluding_user_id=target_user_id)

        fields: dict = {}
        if payload.name is not None:
            fields["name"] = payload.name.strip()
        if payload.avatar_url is not None:
            fields["avatar_url"] = payload.avatar_url
        if payload.designation is not None:
            fields["designation"] = payload.designation.strip()
        if is_admin and payload.role is not None:
            fields["role"] = payload.role
        if is_admin and payload.is_active is not None:
            fields["is_active"] = payload.is_active

        if not fields:
            # Nothing to update — return current state
            return self._to_response(target)

        fields["updated_at"] = datetime.now(timezone.utc)
        updated = await self._user_repo.update_profile(target_user_id, org_id, fields)
        if not updated:
            raise NotFoundException("User", target_user_id)

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_UPDATED",
            resource_id=target_user_id,
            payload={"changed_fields": list(fields.keys())},
        )

        logger.info(f"User {target_user_id} updated by {caller_id}")
        return self._to_response(updated)

    # ── DELETE /users/:id (soft deactivate) ───────────────────────────────────

    async def deactivate_user(
        self, target_user_id: str, org_id: str, caller_id: str
    ) -> None:
        """
        Soft-deactivates a user (is_active=False).
        Cannot deactivate own account — prevents self-lockout.
        """
        if target_user_id == caller_id:
            raise ForbiddenException("You cannot deactivate your own account")

        target = await self._user_repo.find_by_id(target_user_id, org_id=org_id)
        if not target:
            raise NotFoundException("User", target_user_id)

        if not target.is_active:
            raise ConflictException("User is already deactivated")

        if target.role in ("admin", "super_admin"):
            await self._ensure_another_active_admin(org_id, excluding_user_id=target_user_id)

        await self._user_repo.set_active(target_user_id, False)

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_DEACTIVATED",
            resource_id=target_user_id,
        )
        logger.info(f"User {target_user_id} deactivated by {caller_id}")

    async def set_password_as_admin(
        self,
        *,
        target_user_id: str,
        org_id: str,
        caller_id: str,
        new_password: str,
    ) -> None:
        """Admin sets another user's password (no current-password check)."""
        if target_user_id == caller_id:
            raise ForbiddenException(
                "Use the account security settings to change your own password"
            )
        target = await self._user_repo.find_by_id(target_user_id, org_id=org_id)
        if not target:
            raise NotFoundException("User", target_user_id)

        from app.core.security import hash_password

        await self._user_repo.update_password(target_user_id, hash_password(new_password))
        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_PASSWORD_SET",
            resource_id=target_user_id,
        )
        logger.info(f"Password for user {target_user_id} set by admin {caller_id}")

    # ── DELETE /users/:id/permanent (hard delete) ─────────────────────────────

    async def delete_user_permanent(
        self, target_user_id: str, org_id: str, caller_id: str
    ) -> None:
        """Permanently removes a user document from the database."""
        if target_user_id == caller_id:
            raise ForbiddenException("You cannot delete your own account")

        target = await self._user_repo.find_by_id(target_user_id, org_id=org_id)
        if not target:
            raise NotFoundException("User", target_user_id)

        if target.role in ("admin", "super_admin"):
            await self._ensure_another_active_admin(org_id, excluding_user_id=target_user_id)

        from bson import ObjectId

        oid = ObjectId(target_user_id) if ObjectId.is_valid(target_user_id) else target_user_id
        org_filter = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id
        await self._user_repo._collection.delete_one({"_id": oid, "org_id": org_filter})

        # Best-effort: revoke project assignments for this user in the org.
        try:
            await self._db.user_projects.update_many(
                {
                    "user_id": target_user_id,
                    "$or": [{"org_id": org_id}, {"orgId": org_id}, {"org_id": org_filter}],
                },
                {"$set": {"is_active": False}},
            )
        except Exception as exc:
            logger.warning(f"Could not revoke assignments for deleted user {target_user_id}: {exc!r}")

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_DELETED_PERMANENT",
            resource_id=target_user_id,
        )
        logger.info(f"User {target_user_id} permanently deleted by {caller_id}")

    @staticmethod
    def _assignable_roles(caller_role: str) -> set[str]:
        base = {"manager", "field_engineer", "user", "reviewer", "viewer", "admin"}
        if caller_role == "super_admin":
            return base | {"super_admin"}
        # Org admin may mint admin/manager/engineer — never super_admin
        return base

    async def _ensure_another_active_admin(self, org_id: str, *, excluding_user_id: str) -> None:
        from bson import ObjectId

        org_key = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id
        excl = ObjectId(excluding_user_id) if ObjectId.is_valid(excluding_user_id) else excluding_user_id
        count = await self._user_repo._collection.count_documents(
            {
                "org_id": org_key,
                "role": {"$in": ["admin", "super_admin"]},
                "is_active": True,
                "_id": {"$ne": excl},
            }
        )
        if count < 1:
            raise ForbiddenException(
                "Cannot remove or demote the last active administrator for this organization"
            )

    @staticmethod
    def _to_response(user: UserDocument) -> UserResponse:
        return UserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
            designation=getattr(user, 'designation', None),
            avatar_url=user.avatar_url,
            last_login=user.last_login,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    @staticmethod
    def _to_list_response(user: UserDocument) -> UserListResponse:
        return UserListResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            is_active=user.is_active,
            designation=getattr(user, 'designation', None),
            avatar_url=user.avatar_url,
            last_login=user.last_login,
            created_at=user.created_at,
        )

    async def _write_audit_log(
        self,
        org_id: str,
        actor_id: str,
        action: str,
        resource_id: str,
        payload: Optional[dict] = None,
    ) -> None:
        await write_security_audit(
            self._db,
            org_id=org_id,
            actor_id=actor_id,
            action=action,
            resource_type="user",
            resource_id=resource_id,
            payload=payload,
        )
