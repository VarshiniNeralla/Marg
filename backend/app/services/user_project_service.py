from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.models.user_project import UserProjectDocument
from app.repositories.user import UserRepository
from app.repositories.user_project import UserProjectRepository
from app.schemas.user_project import (
    AssignmentResponse,
    CreateAssignmentRequest,
    UpdateAssignmentRequest,
)


class UserProjectService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._up_repo = UserProjectRepository(db)
        self._user_repo = UserRepository(db)
        self._db = db

    # ── POST /projects/:projectId/assignments ─────────────────────────────────

    async def assign_user(
        self,
        project_id: str,
        org_id: str,
        payload: CreateAssignmentRequest,
        assigned_by: str,
    ) -> AssignmentResponse:
        """
        Assigns a user to a project with a project-scoped role.

        Three invariants:
        1. Target user must exist in the same org (cross-org assignment blocked).
        2. No duplicate active assignment for the same user+project.
        3. Project must exist in the same org (validated by org_id filter).
        """
        # 1. Verify target user belongs to this org
        target_user = await self._user_repo.find_by_id(payload.user_id, org_id=org_id)
        if not target_user:
            raise NotFoundException("User", payload.user_id)

        # 2. Verify project exists in this org
        proj_doc = await self._db.projects.find_one({
            "_id": ObjectId(project_id) if ObjectId.is_valid(project_id) else project_id,
            "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
        })
        if not proj_doc:
            raise NotFoundException("Project", project_id)

        # 3. Duplicate check
        if await self._up_repo.active_assignment_exists(payload.user_id, project_id, org_id):
            raise ConflictException(
                f"User '{target_user.name}' already has an active assignment on this project. "
                "Revoke the existing assignment before re-assigning."
            )

        assignment = UserProjectDocument(
            org_id=org_id,
            user_id=payload.user_id,
            project_id=project_id,
            project_role=payload.project_role,
            assigned_by=assigned_by,
            notes=payload.notes,
        )

        assignment_id = await self._up_repo.create(assignment)
        assignment.id = assignment_id

        await self._write_audit_log(
            org_id=org_id,
            actor_id=assigned_by,
            action="USER_ASSIGNED",
            resource_id=assignment_id,
            payload={
                "user_id": payload.user_id,
                "project_id": project_id,
                "project_role": payload.project_role,
            },
        )

        logger.info(
            f"User {payload.user_id} assigned to project {project_id} "
            f"as '{payload.project_role}' by {assigned_by}"
        )

        return AssignmentResponse(
            id=assignment_id,
            user_id=payload.user_id,
            user_name=target_user.name,
            user_email=target_user.email,
            user_avatar=target_user.avatar_url,
            project_id=project_id,
            project_role=payload.project_role,
            assigned_by=assigned_by,
            assigned_at=assignment.assigned_at,
            is_active=True,
            notes=payload.notes,
            created_at=assignment.created_at,
        )

    # ── GET /projects/:projectId/assignments ──────────────────────────────────

    async def list_assignments(
        self,
        project_id: str,
        org_id: str,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[AssignmentResponse], int]:
        assignments, total = await self._up_repo.list_by_project(
            project_id=project_id,
            org_id=org_id,
            active_only=True,
            skip=skip,
            limit=limit,
        )

        result = []
        for a in assignments:
            user = await self._user_repo.find_by_id(a.user_id, org_id=org_id)
            if not user:
                continue  # User was hard-deleted (edge case — should not happen)
            result.append(self._to_response(a, user.name, user.email, user.avatar_url))

        return result, total

    # ── PUT /projects/:projectId/assignments/:assignmentId ────────────────────

    async def update_assignment(
        self,
        assignment_id: str,
        org_id: str,
        payload: UpdateAssignmentRequest,
        caller_id: str,
    ) -> AssignmentResponse:
        assignment = await self._up_repo.find_by_id_and_org(assignment_id, org_id)
        if not assignment or not assignment.is_active:
            raise NotFoundException("Assignment", assignment_id)

        updated = await self._up_repo.update_role(
            assignment_id, payload.project_role, org_id
        )
        if not updated:
            raise NotFoundException("Assignment", assignment_id)

        user = await self._user_repo.find_by_id(updated.user_id, org_id=org_id)
        if not user:
            raise NotFoundException("User", updated.user_id)

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="ASSIGNMENT_ROLE_UPDATED",
            resource_id=assignment_id,
            payload={"new_role": payload.project_role},
        )

        return self._to_response(updated, user.name, user.email, user.avatar_url)

    # ── DELETE /projects/:projectId/assignments/:assignmentId ─────────────────

    async def revoke_assignment(
        self,
        assignment_id: str,
        org_id: str,
        caller_id: str,
    ) -> None:
        """
        Soft-revokes the assignment. The record is retained with is_active=False
        for audit trail purposes — it is never hard-deleted.
        """
        revoked = await self._up_repo.revoke(
            assignment_id=assignment_id,
            revoked_by=caller_id,
            org_id=org_id,
        )
        if not revoked:
            raise NotFoundException("Assignment", assignment_id)

        await self._write_audit_log(
            org_id=org_id,
            actor_id=caller_id,
            action="ASSIGNMENT_REVOKED",
            resource_id=assignment_id,
        )
        logger.info(f"Assignment {assignment_id} revoked by {caller_id}")

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _to_response(
        a: UserProjectDocument,
        user_name: str,
        user_email: str,
        user_avatar: Optional[str],
    ) -> AssignmentResponse:
        return AssignmentResponse(
            id=a.id,
            user_id=a.user_id,
            user_name=user_name,
            user_email=user_email,
            user_avatar=user_avatar,
            project_id=a.project_id,
            project_role=a.project_role,
            assigned_by=a.assigned_by,
            assigned_at=a.assigned_at,
            is_active=a.is_active,
            revoked_at=a.revoked_at,
            notes=a.notes,
            created_at=a.created_at,
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
                "resource_type": "user_project",
                "resource_id": ObjectId(resource_id) if ObjectId.is_valid(resource_id) else resource_id,
                "payload": payload or {},
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as exc:
            logger.error(f"Audit log write failed [{action}]: {exc}")
