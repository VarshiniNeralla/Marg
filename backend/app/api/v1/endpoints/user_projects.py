from fastapi import APIRouter, Depends, Path, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.dependencies import OrgContext, get_db, get_org_context, require_project_role
from app.schemas.auth import ApiResponse
from app.schemas.user_project import (
    AssignmentResponse,
    CreateAssignmentRequest,
    UpdateAssignmentRequest,
)
from app.services.user_project_service import UserProjectService

router = APIRouter(prefix="/projects", tags=["Project Assignments"])


@router.post(
    "/{project_id}/assignments",
    response_model=ApiResponse[AssignmentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Assign a user to a project (project admin or org admin)",
)
async def assign_user_to_project(
    payload: CreateAssignmentRequest,
    project_id: str = Path(...),
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _role: str = Depends(require_project_role("admin")),
) -> ApiResponse[AssignmentResponse]:
    """
    Assigns a user to a project with a given project role.

    Rules:
    - Target user must belong to the same org as the caller.
    - User cannot be assigned twice to the same project (active constraint).
    - Requires at least project-admin role (or system admin).
    """
    service = UserProjectService(db)
    assignment = await service.assign_user(
        project_id=project_id,
        org_id=caller.org_id,
        payload=payload,
        assigned_by=caller.user_id,
    )
    return ApiResponse(success=True, data=assignment, message="User assigned to project")


@router.get(
    "/{project_id}/assignments",
    response_model=ApiResponse[dict],
    summary="List all active assignments for a project",
)
async def list_project_assignments(
    project_id: str = Path(...),
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _role: str = Depends(require_project_role("viewer")),
) -> ApiResponse[dict]:
    """
    Returns all active user assignments for the project.
    Any project member (viewer+) may view the roster.
    """
    service = UserProjectService(db)
    assignments, total = await service.list_assignments(
        project_id=project_id,
        org_id=caller.org_id,
        skip=skip,
        limit=limit,
    )
    return ApiResponse(
        success=True,
        data={
            "items": [a.model_dump() for a in assignments],
            "total": total,
            "skip": skip,
            "limit": limit,
        },
    )


@router.put(
    "/{project_id}/assignments/{assignment_id}",
    response_model=ApiResponse[AssignmentResponse],
    summary="Update the project role on an assignment (project admin or org admin)",
)
async def update_assignment(
    payload: UpdateAssignmentRequest,
    project_id: str = Path(...),
    assignment_id: str = Path(...),
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _role: str = Depends(require_project_role("admin")),
) -> ApiResponse[AssignmentResponse]:
    """
    Changes the project_role on an existing active assignment.
    Requires project-admin or org-admin.
    """
    service = UserProjectService(db)
    assignment = await service.update_assignment(
        assignment_id=assignment_id,
        org_id=caller.org_id,
        payload=payload,
        caller_id=caller.user_id,
    )
    return ApiResponse(success=True, data=assignment, message="Assignment updated")


@router.delete(
    "/{project_id}/assignments/{assignment_id}",
    response_model=ApiResponse[None],
    status_code=status.HTTP_200_OK,
    summary="Revoke a user's project assignment (project admin or org admin)",
)
async def revoke_assignment(
    project_id: str = Path(...),
    assignment_id: str = Path(...),
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
    _role: str = Depends(require_project_role("admin")),
) -> ApiResponse[None]:
    """
    Soft-revokes a project assignment.
    The record is retained with is_active=False — it is never hard-deleted.
    A revoked user may be re-assigned (creates a new record, preserving history).
    """
    service = UserProjectService(db)
    await service.revoke_assignment(
        assignment_id=assignment_id,
        org_id=caller.org_id,
        caller_id=caller.user_id,
    )
    return ApiResponse(success=True, data=None, message="Assignment revoked")
