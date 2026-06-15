from fastapi import APIRouter, Depends, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.dependencies import OrgContext, get_db, get_org_context, require_admin, require_super_admin
from app.models.user import UserDocument
from app.schemas.auth import ApiResponse
from app.schemas.organization import (
    CreateOrganizationRequest,
    OrganizationMeResponse,
    OrganizationResponse,
    UpdateOrganizationRequest,
)
from app.services.organization_service import OrganizationService

router = APIRouter(prefix="/organizations", tags=["Organizations"])


@router.post(
    "",
    response_model=ApiResponse[OrganizationResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create a new organization (super_admin only)",
)
async def create_organization(
    payload: CreateOrganizationRequest,
    caller: UserDocument = Depends(require_super_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[OrganizationResponse]:
    """
    Creates a new tenant organization.
    Only platform super_admins may call this endpoint.
    The org's owner_email must already exist in the users collection.
    """
    service = OrganizationService(db)
    org = await service.create(payload, creator_id=caller.id)
    return ApiResponse(success=True, data=org, message="Organization created")


@router.get(
    "/me",
    response_model=ApiResponse[OrganizationMeResponse],
    summary="Get caller's organization with live stats",
)
async def get_my_organization(
    caller: OrgContext = Depends(get_org_context),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[OrganizationMeResponse]:
    """
    Returns the organization the caller belongs to, including live counters
    (total_users, total_projects). Scoped to the org embedded in the JWT.
    """
    service = OrganizationService(db)
    org = await service.get_me(caller.org_id)
    return ApiResponse(success=True, data=org)


@router.put(
    "/me",
    response_model=ApiResponse[OrganizationResponse],
    summary="Update caller's organization settings (admin only)",
)
async def update_my_organization(
    payload: UpdateOrganizationRequest,
    caller: UserDocument = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ApiResponse[OrganizationResponse]:
    """
    Patches name, logo_url, or settings on the caller's organization.
    Only org admins and super_admins may call this.
    All fields are optional — omitting a field leaves it unchanged.
    """
    service = OrganizationService(db)
    org = await service.update(str(caller.org_id), payload, actor_id=caller.id)
    return ApiResponse(success=True, data=org, message="Organization updated")
