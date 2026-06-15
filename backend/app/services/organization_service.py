from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import ConflictException, NotFoundException, ValidationException
from app.models.organization import OrgSettings, OrganizationDocument
from app.repositories.organization import OrganizationRepository
from app.repositories.user import UserRepository
from app.schemas.organization import (
    CreateOrganizationRequest,
    OrganizationMeResponse,
    OrganizationResponse,
    OrgStatsSchema,
    UpdateOrganizationRequest,
)


class OrganizationService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._org_repo = OrganizationRepository(db)
        self._user_repo = UserRepository(db)
        self._db = db

    # ── Create (super_admin only) ─────────────────────────────────────────────

    async def create(
        self, payload: CreateOrganizationRequest, creator_id: str
    ) -> OrganizationResponse:
        """
        Creates a new organisation. Validates name+slug uniqueness globally.
        Called only by super_admin — enforced at the endpoint dependency level.
        """
        if await self._org_repo.slug_exists(payload.slug):
            raise ConflictException(f"Slug '{payload.slug}' is already taken")
        if await self._org_repo.name_exists(payload.name):
            raise ConflictException(f"Organization name '{payload.name}' is already taken")

        # Resolve owner by email if provided
        owner = await self._user_repo.find_by_email(payload.owner_email)
        if not owner:
            raise NotFoundException("User", payload.owner_email)

        settings = OrgSettings()
        if payload.settings:
            if payload.settings.max_projects is not None:
                settings.max_projects = payload.settings.max_projects
            if payload.settings.max_users is not None:
                settings.max_users = payload.settings.max_users
            if payload.settings.storage_limit_gb is not None:
                settings.storage_limit_gb = payload.settings.storage_limit_gb

        org = OrganizationDocument(
            name=payload.name,
            slug=payload.slug.lower(),
            plan=payload.plan,
            owner_id=owner.id,
            settings=settings,
        )

        org_id = await self._org_repo.create(org)
        org.id = org_id

        await self._write_audit_log(
            org_id=org_id,
            actor_id=creator_id,
            action="ORG_CREATED",
            resource_id=org_id,
        )

        logger.info(f"Organization created: {org.slug} (id={org_id})")
        return self._to_response(org)

    # ── GET /organizations/me ─────────────────────────────────────────────────

    async def get_me(self, org_id: str) -> OrganizationMeResponse:
        """
        Returns the caller's organization with live stats.
        Stats are lightweight count queries — safe to run per-request at this scale.
        """
        org = await self._org_repo.find_by_id(org_id)
        if not org:
            raise NotFoundException("Organization")

        # Live stats: count documents in related collections
        total_users = await self._db.users.count_documents(
            {"org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id, "is_active": True}
        )
        total_projects = await self._db.projects.count_documents(
            {"org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id}
        )

        return OrganizationMeResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            plan=org.plan,
            status=org.status,
            logo_url=org.logo_url,
            settings=org.settings.model_dump(),
            stats=OrgStatsSchema(
                total_projects=total_projects,
                total_users=total_users,
            ),
            created_at=org.created_at,
            updated_at=org.updated_at,
        )

    # ── PUT /organizations/me ─────────────────────────────────────────────────

    async def update(
        self, org_id: str, payload: UpdateOrganizationRequest, actor_id: str
    ) -> OrganizationResponse:
        org = await self._org_repo.find_by_id(org_id)
        if not org:
            raise NotFoundException("Organization")

        fields: dict = {"updated_at": datetime.now(timezone.utc)}

        if payload.name is not None:
            if payload.name != org.name and await self._org_repo.name_exists(payload.name):
                raise ConflictException(f"Organization name '{payload.name}' is already taken")
            fields["name"] = payload.name

        if payload.logo_url is not None:
            fields["logo_url"] = payload.logo_url

        if payload.settings is not None:
            # Patch the existing settings object (partial update)
            current = org.settings.model_dump()
            if payload.settings.max_projects is not None:
                current["max_projects"] = payload.settings.max_projects
            if payload.settings.max_users is not None:
                current["max_users"] = payload.settings.max_users
            if payload.settings.storage_limit_gb is not None:
                current["storage_limit_gb"] = payload.settings.storage_limit_gb
            fields["settings"] = current

        updated = await self._org_repo.update_settings(org_id, fields)
        if not updated:
            raise NotFoundException("Organization")

        await self._write_audit_log(
            org_id=org_id, actor_id=actor_id, action="ORG_UPDATED", resource_id=org_id
        )
        return self._to_response(updated)

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _to_response(org: OrganizationDocument) -> OrganizationResponse:
        return OrganizationResponse(
            id=org.id,
            name=org.name,
            slug=org.slug,
            plan=org.plan,
            status=org.status,
            logo_url=org.logo_url,
            settings=org.settings.model_dump(),
            created_at=org.created_at,
            updated_at=org.updated_at,
        )

    async def _write_audit_log(
        self, org_id: str, actor_id: str, action: str, resource_id: str
    ) -> None:
        try:
            await self._db.audit_logs.insert_one({
                "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
                "actor_id": ObjectId(actor_id) if ObjectId.is_valid(actor_id) else actor_id,
                "action": action,
                "resource_type": "organization",
                "resource_id": ObjectId(resource_id) if ObjectId.is_valid(resource_id) else resource_id,
                "payload": {},
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as exc:
            logger.error(f"Audit log write failed [{action}]: {exc}")
