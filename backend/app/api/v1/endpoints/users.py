from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.dependencies import (
    OrgContext,
    get_current_user,
    get_db,
    get_org_context,
    require_admin,
)
from pydantic import BaseModel, Field

from app.models.user import UserDocument
from app.schemas.auth import ApiResponse
from app.schemas.user import UpdateUserRequest, UserDetailResponse, UserListResponse, UserResponse
from app.services.auth_service import AuthService
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Users"])


class SetUserProjectsRequest(BaseModel):
    project_ids: list[str] = Field(default_factory=list)


@router.get(
    "",
    response_model=ApiResponse[dict],
    summary="List users in the caller's organization (admin only)",
)
async def list_users(
    caller: UserDocument = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    role: Optional[str] = Query(default=None, description="Filter by system role"),
    is_active: Optional[bool] = Query(default=None),
) -> ApiResponse[dict]:
    service = UserService(db)
    users, total = await service.list_users(
        org_id=str(caller.org_id),
        skip=skip,
        limit=limit,
        role=role,
        is_active=is_active,
    )
    return ApiResponse(
        success=True,
        data={
            "items": [u.model_dump() for u in users],
            "total": total,
            "skip": skip,
            "limit": limit,
        },
    )


@router.get(
    "/me",
    response_model=ApiResponse[UserDetailResponse],
    summary="Get the currently authenticated user's full profile",
)
async def get_me(
    current_user: UserDocument = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[UserDetailResponse]:
    service = UserService(db)
    user = await service.get_user(
        user_id=current_user.id,
        org_id=str(current_user.org_id),
        include_projects=True,
    )
    return ApiResponse(success=True, data=user)


@router.get(
    "/{user_id}",
    response_model=ApiResponse[UserDetailResponse],
    summary="Get a specific user by ID (admin only)",
)
async def get_user(
    user_id: str,
    caller: UserDocument = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[UserDetailResponse]:
    service = UserService(db)
    user = await service.get_user(
        user_id=user_id,
        org_id=str(caller.org_id),
        include_projects=True,
    )
    return ApiResponse(success=True, data=user)


@router.put(
    "/{user_id}",
    response_model=ApiResponse[UserResponse],
    summary="Update a user's profile",
)
async def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[UserResponse]:
    service = UserService(db)
    user = await service.update_user(
        target_user_id=user_id,
        org_id=caller.org_id,
        caller_id=caller.user_id,
        caller_role=caller.role,
        payload=payload,
    )
    return ApiResponse(success=True, data=user, message="User updated")


@router.put(
    "/{user_id}/projects",
    response_model=ApiResponse[dict],
    summary="Set a user's project assignments (admin only)",
)
async def set_user_projects(
    user_id: str,
    payload: SetUserProjectsRequest,
    caller: UserDocument = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[dict]:
    """
    Replaces the user's active project assignments with the provided set.
    Assignments not in the new set are revoked; new ones are created.
    """
    service = AuthService(db)
    assigned = await service.set_user_project_assignments(
        user_id=user_id,
        org_id=str(caller.org_id),
        project_ids=payload.project_ids,
        assigned_by=caller.id,
    )
    return ApiResponse(
        success=True,
        data={"assigned_project_ids": assigned},
        message="Project assignments updated",
    )


@router.delete(
    "/{user_id}",
    response_model=ApiResponse[None],
    status_code=status.HTTP_200_OK,
    summary="Permanently delete a user (admin only)",
)
async def delete_user(
    user_id: str,
    caller: UserDocument = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[None]:
    service = UserService(db)
    await service.delete_user_permanent(
        target_user_id=user_id,
        org_id=str(caller.org_id),
        caller_id=caller.id,
    )
    return ApiResponse(success=True, data=None, message="User permanently deleted")
