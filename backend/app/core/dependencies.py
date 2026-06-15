from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Cookie, Depends, Header, Path
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.core.security import decode_access_token
from app.db.mongodb import get_db
from app.models.user import UserDocument
from app.models.user_project import PROJECT_ROLES
from app.repositories.user import UserRepository
from app.repositories.user_project import UserProjectRepository
from app.services.rbac_service import RBACService, role_gte


# ── Token extraction ──────────────────────────────────────────────────────────

def _extract_bearer_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization:
        raise UnauthorizedException("Authorization header missing")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise UnauthorizedException("Authorization header must be 'Bearer <token>'")
    return parts[1]


# ── Current user resolution ───────────────────────────────────────────────────

async def get_current_user(
    token: Annotated[str, Depends(_extract_bearer_token)],
    db: Annotated[AsyncIOMotorDatabase, Depends(get_db)],
) -> UserDocument:
    """
    Resolves the currently authenticated user from the JWT.
    Always fetches from DB to catch deactivation without waiting for token expiry.
    """
    payload = decode_access_token(token)

    user_id: Optional[str] = payload.get("sub")
    org_id: Optional[str] = payload.get("org")

    if not user_id or not org_id:
        raise UnauthorizedException("Malformed token claims")

    user_repo = UserRepository(db)
    user = await user_repo.find_by_id(user_id, org_id=org_id)

    if not user:
        raise UnauthorizedException("User not found")
    if not user.is_active:
        from app.core.exceptions import AccountInactiveException
        raise AccountInactiveException()

    return user


# ── System-role guards ────────────────────────────────────────────────────────

async def require_admin(
    current_user: Annotated[UserDocument, Depends(get_current_user)],
) -> UserDocument:
    """Requires system role admin or super_admin."""
    if current_user.role not in ("admin", "super_admin"):
        raise ForbiddenException("Administrator access required")
    return current_user


async def require_super_admin(
    current_user: Annotated[UserDocument, Depends(get_current_user)],
) -> UserDocument:
    if current_user.role != "super_admin":
        raise ForbiddenException("Platform administrator access required")
    return current_user


# ── Refresh token extraction ──────────────────────────────────────────────────

def get_refresh_token_from_cookie(
    refresh_token: Optional[str] = Cookie(default=None, alias="refresh_token"),
) -> str:
    if not refresh_token:
        raise UnauthorizedException("Refresh token cookie missing")
    return refresh_token


# ── Org context dataclass ─────────────────────────────────────────────────────

@dataclass
class OrgContext:
    """
    Bundles the caller's identity into a single object.
    Injected into service calls so services never touch the JWT directly.
    Contains everything needed to enforce org isolation:
      user_id  — who is acting
      org_id   — which org they belong to (from JWT, never from request)
      role     — their system role
    """
    user_id: str
    org_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "super_admin")


async def get_org_context(
    current_user: Annotated[UserDocument, Depends(get_current_user)],
) -> OrgContext:
    """Extracts OrgContext from the resolved user. Use as a Depends() shorthand."""
    return OrgContext(
        user_id=current_user.id,
        org_id=str(current_user.org_id),
        role=current_user.role,
    )


# ── Project-scoped guards (two-level RBAC) ────────────────────────────────────

async def require_project_access(
    project_id: str,
    db: AsyncIOMotorDatabase,
    current_user: UserDocument,
) -> str:
    """
    Resolves the caller's effective project role.
    System admins automatically receive 'admin' project role.
    Regular users must have an active user_projects entry.
    Returns the project_role string.
    Raises ForbiddenException if the user has no access.

    NOTE: This is a helper function, not a Depends() — call it explicitly
    in endpoints that need project-scoped access. Use the factory below
    when a minimum role level is required.
    """
    rbac = RBACService(db)
    project_role = await rbac.get_project_role(
        user_id=current_user.id,
        project_id=project_id,
        org_id=str(current_user.org_id),
        system_role=current_user.role,
    )
    if not project_role:
        raise ForbiddenException("You do not have access to this project")
    return project_role


def require_project_role(minimum_role: str):
    """
    Factory that returns a FastAPI dependency enforcing a minimum project role.

    Usage in endpoint:
        @router.get("/{project_id}/...")
        async def endpoint(
            project_id: str = Path(...),
            current_user: CurrentUser = ...,
            db: DB = ...,
            _role: str = Depends(require_project_role("contributor")),
        ):

    minimum_role: viewer | contributor | manager | admin
    """
    if minimum_role not in PROJECT_ROLES:
        raise ValueError(f"Invalid minimum_role: {minimum_role}")

    async def _check(
        project_id: str = Path(...),
        current_user: UserDocument = Depends(get_current_user),
        db: AsyncIOMotorDatabase = Depends(get_db),
    ) -> str:
        effective_role = await require_project_access(project_id, db, current_user)
        if not role_gte(effective_role, minimum_role):
            raise ForbiddenException(
                f"This operation requires at least '{minimum_role}' role on this project. "
                f"Your current role is '{effective_role}'."
            )
        return effective_role

    return _check


# ── Typed shorthand aliases ───────────────────────────────────────────────────

CurrentUser = Annotated[UserDocument, Depends(get_current_user)]
AdminUser = Annotated[UserDocument, Depends(require_admin)]
SuperAdminUser = Annotated[UserDocument, Depends(require_super_admin)]
RefreshTokenCookie = Annotated[str, Depends(get_refresh_token_from_cookie)]
DB = Annotated[AsyncIOMotorDatabase, Depends(get_db)]
CallerContext = Annotated[OrgContext, Depends(get_org_context)]
