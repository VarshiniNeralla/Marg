"""
System-role permission matrix — the SERVER-SIDE source of truth for what each
system role may do on each module.

This mirrors the frontend matrix in `frontend/src/utils/permissions.ts` exactly.
The frontend gates the UI; this module enforces the same rules on the API so a
crafted request (or a stolen low-privilege token) cannot perform an action the
UI would never offer. Keep the two matrices in sync.

Scope note: this is SYSTEM-role enforcement (users.role), the outer gate. The
finer project-scoped RBAC (user_projects) remains available via RBACService for
endpoints that carry a project_id; this matrix closes the broad hole where every
authenticated user could write/delete any entity in their org regardless of role.
"""
from typing import Optional

from fastapi import Depends

from app.core.dependencies import OrgContext, get_org_context
from app.core.exceptions import ForbiddenException

# ── Action / module vocabulary (mirrors the frontend) ─────────────────────────
Action = str   # 'view'|'create'|'edit'|'delete'|'approve'|'reject'|'publish'|'upload'|'assign'
Module = str

_PERMISSIONS: dict[str, dict[Module, set[Action]]] = {
    "super_admin": {
        "users":         {"view", "create", "edit", "delete", "assign"},
        "projects":      {"view", "create", "edit", "delete", "assign"},
        "towers":        {"view", "create", "edit", "delete"},
        "floors":        {"view", "create", "edit", "delete"},
        "flats":         {"view", "create", "edit", "delete"},
        "rooms":         {"view", "create", "edit", "delete"},
        "captures":      {"view", "create", "edit", "delete", "approve", "reject", "upload"},
        "tours":         {"view", "create", "edit", "delete", "publish"},
        "floorPlans":    {"view", "create", "edit", "delete", "upload"},
        "defects":       {"view", "create", "edit", "delete"},
        "analytics":     {"view"},
        "settings":      {"view", "edit"},
        "organizations": {"view", "edit"},
        "auditLogs":     {"view"},
        "notifications": {"view", "create", "edit", "delete"},
    },
    "admin": {
        "users":         {"view", "create", "edit", "delete", "assign"},
        "projects":      {"view", "create", "edit", "delete", "assign"},
        "towers":        {"view", "create", "edit", "delete"},
        "floors":        {"view", "create", "edit", "delete"},
        "flats":         {"view", "create", "edit", "delete"},
        "rooms":         {"view", "create", "edit", "delete"},
        "captures":      {"view", "create", "edit", "delete", "approve", "reject", "upload"},
        "tours":         {"view", "create", "edit", "delete", "publish"},
        "floorPlans":    {"view", "create", "edit", "delete", "upload"},
        "defects":       {"view", "create", "edit", "delete"},
        "analytics":     {"view"},
        "settings":      {"view", "edit"},
        "organizations": {"view", "edit"},
        "auditLogs":     {"view"},
        "notifications": {"view", "create", "edit", "delete"},
    },
    "manager": {
        "projects":      {"view"},
        "towers":        {"view"},
        "floors":        {"view"},
        "flats":         {"view"},
        "rooms":         {"view"},
        "captures":      {"view", "approve", "reject"},
        "tours":         {"view", "publish"},
        "floorPlans":    {"view"},
        "defects":       {"view", "create", "edit"},
        "analytics":     {"view"},
        "notifications": {"view", "create", "edit", "delete"},
    },
    # 'reviewer' is treated like a manager for capture review in the product.
    "reviewer": {
        "projects":      {"view"},
        "towers":        {"view"},
        "floors":        {"view"},
        "flats":         {"view"},
        "rooms":         {"view"},
        "captures":      {"view", "approve", "reject"},
        "tours":         {"view"},
        "floorPlans":    {"view"},
        "defects":       {"view", "create", "edit"},
        "analytics":     {"view"},
        "notifications": {"view", "create", "edit", "delete"},
    },
    "field_engineer": {
        "projects":      {"view"},
        "towers":        {"view"},
        "floors":        {"view"},
        "flats":         {"view"},
        # pins/rooms are created AND renamed/resequenced as part of the capture
        # + pin-delete workflow, so field engineers need create+edit+delete here.
        "rooms":         {"view", "create", "edit", "delete"},
        "captures":      {"view", "upload", "create", "edit", "delete"},
        "floorPlans":    {"view", "create", "upload", "edit"},
        # Field engineers publish floor-plan walkthroughs from /publish-tours
        # (a FieldEngineerRoute) and can delete a walkthrough from /tours (the
        # delete control there is not role-gated), so they need full tour CRUD.
        # NOTE: this intentionally diverges from the stale frontend matrix, which
        # lists tours:[] for field_engineer but is contradicted by the actual UI.
        "tours":         {"view", "create", "publish", "edit", "delete"},
        "defects":       {"view"},
        "notifications": {"view", "create", "edit", "delete"},
    },
    # Generic low-privilege authenticated user / viewer: read-only.
    "user": {
        "projects": {"view"}, "towers": {"view"}, "floors": {"view"}, "flats": {"view"},
        "rooms": {"view"}, "captures": {"view"}, "tours": {"view"}, "floorPlans": {"view"},
        "defects": {"view"}, "analytics": {"view"}, "notifications": {"view", "edit", "delete"},
    },
    "viewer": {
        "projects": {"view"}, "towers": {"view"}, "floors": {"view"}, "flats": {"view"},
        "rooms": {"view"}, "captures": {"view"}, "tours": {"view"}, "floorPlans": {"view"},
        "defects": {"view"}, "analytics": {"view"}, "notifications": {"view"},
    },
}


def can(role: Optional[str], module: Module, action: Action) -> bool:
    """Returns True if the system role permits the action on the module."""
    if not role:
        return False
    return action in _PERMISSIONS.get(role, {}).get(module, set())


def require_permission(module: Module, action: Action):
    """
    FastAPI dependency factory enforcing a system-role permission.

    Usage:
        @router.delete("/projects/{project_id}")
        async def delete_project(..., _=Depends(require_permission("projects", "delete"))):
    """
    async def _check(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        if not can(ctx.role, module, action):
            raise ForbiddenException(
                f"Your role ('{ctx.role}') is not permitted to {action} {module}."
            )
        return ctx

    return _check
