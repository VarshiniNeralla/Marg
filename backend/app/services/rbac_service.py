from enum import Enum
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.user_project import PROJECT_ROLES
from app.repositories.user_project import UserProjectRepository


# ── Permission definitions ────────────────────────────────────────────────────

class Permission(str, Enum):
    """
    Exhaustive list of actions that can be permission-checked in the system.
    Using an Enum (not raw strings) means a typo is a compile-time error,
    not a silent always-pass or always-fail at runtime.
    """
    # Captures
    CAPTURE_READ    = "capture:read"
    CAPTURE_UPLOAD  = "capture:upload"
    CAPTURE_APPROVE = "capture:approve"
    CAPTURE_DELETE  = "capture:delete"

    # Rooms / hierarchy (write operations)
    ROOM_READ       = "room:read"
    ROOM_WRITE      = "room:write"

    # Project management
    PROJECT_READ    = "project:read"
    PROJECT_WRITE   = "project:write"

    # User management (project-scoped)
    USER_ASSIGN     = "user:assign"

    # Analytics
    ANALYTICS_READ  = "analytics:read"


# ── Permission matrix ─────────────────────────────────────────────────────────
# Maps project_role → set of permitted actions.
# Roles are cumulative upward: each role adds to the previous.

_PROJECT_ROLE_PERMISSIONS: dict[str, frozenset[Permission]] = {
    "viewer": frozenset({
        Permission.CAPTURE_READ,
        Permission.ROOM_READ,
        Permission.PROJECT_READ,
    }),
    "contributor": frozenset({
        Permission.CAPTURE_READ,
        Permission.CAPTURE_UPLOAD,
        Permission.ROOM_READ,
        Permission.PROJECT_READ,
    }),
    "manager": frozenset({
        Permission.CAPTURE_READ,
        Permission.CAPTURE_UPLOAD,
        Permission.CAPTURE_APPROVE,
        Permission.ROOM_READ,
        Permission.ROOM_WRITE,
        Permission.PROJECT_READ,
        Permission.ANALYTICS_READ,
    }),
    "admin": frozenset({
        Permission.CAPTURE_READ,
        Permission.CAPTURE_UPLOAD,
        Permission.CAPTURE_APPROVE,
        Permission.CAPTURE_DELETE,
        Permission.ROOM_READ,
        Permission.ROOM_WRITE,
        Permission.PROJECT_READ,
        Permission.PROJECT_WRITE,
        Permission.USER_ASSIGN,
        Permission.ANALYTICS_READ,
    }),
}

# System-level admin has all permissions on all projects within their org.
_SYSTEM_ADMIN_PERMISSIONS: frozenset[Permission] = frozenset(Permission)


# ── Role ordering for comparison ──────────────────────────────────────────────
_ROLE_ORDER = {role: idx for idx, role in enumerate(PROJECT_ROLES)}
# viewer=0, contributor=1, manager=2, admin=3


def role_gte(role: str, minimum: str) -> bool:
    """Returns True if role is greater than or equal to minimum in the hierarchy."""
    return _ROLE_ORDER.get(role, -1) >= _ROLE_ORDER.get(minimum, 999)


# ── RBAC Service ─────────────────────────────────────────────────────────────

class RBACService:
    """
    Stateless permission evaluation service.

    Two-level check flow (from architecture blueprint):
    1. Is the user authenticated and in the correct org? (JWT / dependency layer)
    2. Does system role permit this class of operation?
       - system admin → all permissions within org, skip project-role check
       - system user  → resolve project role from user_projects collection
    3. Does the resolved project role include the required permission?

    The service is designed to be instantiated per-request (injected with db).
    """

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._up_repo = UserProjectRepository(db)

    # ── Primary check API ─────────────────────────────────────────────────────

    async def check(
        self,
        user_id: str,
        org_id: str,
        system_role: str,
        permission: Permission,
        project_id: Optional[str] = None,
    ) -> bool:
        """
        Returns True if the user has the given permission, False otherwise.
        Callers that want to raise ForbiddenException should use assert_permitted().
        """
        # System admin has all permissions within their org — no project-role needed.
        if system_role in ("admin", "super_admin"):
            return True

        # For non-admin users, a project_id is required to resolve the project role.
        if not project_id:
            return False

        project_role = await self._up_repo.get_project_role(
            user_id=user_id,
            project_id=project_id,
            org_id=org_id,
        )

        if not project_role:
            return False  # User has no active assignment to this project

        allowed = _PROJECT_ROLE_PERMISSIONS.get(project_role, frozenset())
        return permission in allowed

    async def assert_permitted(
        self,
        user_id: str,
        org_id: str,
        system_role: str,
        permission: Permission,
        project_id: Optional[str] = None,
    ) -> None:
        """
        Like check(), but raises ForbiddenException instead of returning False.
        Use this in service methods that must abort on insufficient permissions.
        """
        allowed = await self.check(
            user_id=user_id,
            org_id=org_id,
            system_role=system_role,
            permission=permission,
            project_id=project_id,
        )
        if not allowed:
            from app.core.exceptions import ForbiddenException
            raise ForbiddenException(
                f"Permission '{permission.value}' required for this operation"
            )

    async def get_project_role(
        self, user_id: str, project_id: str, org_id: str, system_role: str
    ) -> Optional[str]:
        """
        Returns the effective project role string for a user.
        System admins are always treated as project 'admin'.
        Returns None if the user has no access.
        """
        if system_role in ("admin", "super_admin"):
            return "admin"
        return await self._up_repo.get_project_role(
            user_id=user_id,
            project_id=project_id,
            org_id=org_id,
        )

    # ── Bulk helpers ──────────────────────────────────────────────────────────

    async def get_accessible_project_ids(
        self, user_id: str, org_id: str, system_role: str
    ) -> Optional[list[str]]:
        """
        Returns the list of project IDs accessible to this user.
        Returns None for system admins (meaning: ALL projects in the org).
        Returns an explicit list for regular users.
        This avoids loading all projects when computing access for admins.
        """
        if system_role in ("admin", "super_admin"):
            return None  # Sentinel: caller should apply no project filter
        return await self._up_repo.get_accessible_project_ids(
            user_id=user_id, org_id=org_id
        )

    # ── Static helpers (no DB required) ──────────────────────────────────────

    @staticmethod
    def get_permissions_for_role(project_role: str) -> frozenset[Permission]:
        """Returns the permission set for a given project role."""
        return _PROJECT_ROLE_PERMISSIONS.get(project_role, frozenset())

    @staticmethod
    def is_valid_project_role(role: str) -> bool:
        return role in PROJECT_ROLES
