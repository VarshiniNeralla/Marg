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
            assignments, _ = await self._up_repo.list_by_user(
                user_id=user_id, org_id=org_id, active_only=True
            )
            for a in assignments:
                # Fetch project name — denormalised join
                proj_doc = await self._db.projects.find_one(
                    {"_id": ObjectId(a.project_id) if ObjectId.is_valid(a.project_id) else a.project_id},
                    {"name": 1},
                )
                proj_name = proj_doc["name"] if proj_doc else "Unknown Project"
                assigned_projects.append(AssignedProjectBrief(
                    project_id=a.project_id,
                    project_name=proj_name,
                    project_role=a.project_role,
                    assigned_at=a.assigned_at,
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
        - An admin cannot demote their own role (self-demotion prevention).
        """
        payload.validate_role()

        # Verify target exists in this org
        target = await self._user_repo.find_by_id(target_user_id, org_id=org_id)
        if not target:
            raise NotFoundException("User", target_user_id)

        is_self = caller_id == target_user_id
        is_admin = caller_role in ("admin", "super_admin")

        # Non-admins can only update their own profile
        if not is_admin and not is_self:
            raise ForbiddenException("You can only update your own profile")

        # Non-admins cannot set role or is_active
        if payload.has_admin_fields() and not is_admin:
            raise ForbiddenException("Only administrators can change role or active status")

        # Prevent admin from demoting their own role
        if is_self and payload.role is not None and payload.role != target.role:
            if target.role in ("admin", "super_admin"):
                raise ForbiddenException(
                    "Administrators cannot change their own role. "
                    "Ask another admin to do this."
                )

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

        await self._user_repo.set_active(target_user_id, False)

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_DEACTIVATED",
            resource_id=target_user_id,
        )
        logger.info(f"User {target_user_id} deactivated by {caller_id}")

    # ── Private helpers ───────────────────────────────────────────────────────

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

        await self._user_repo._collection.delete_one({"_id": ObjectId(target_user_id) if ObjectId.is_valid(target_user_id) else target_user_id})

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="USER_DELETED_PERMANENT",
            resource_id=target_user_id,
        )
        logger.info(f"User {target_user_id} permanently deleted by {caller_id}")

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
        try:
            await self._db.audit_logs.insert_one({
                "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
                "actor_id": ObjectId(actor_id) if ObjectId.is_valid(actor_id) else actor_id,
                "action": action,
                "resource_type": "user",
                "resource_id": ObjectId(resource_id) if ObjectId.is_valid(resource_id) else resource_id,
                "payload": payload or {},
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as exc:
            logger.error(f"Audit log write failed [{action}]: {exc}")
