"""
Unit tests for RBACService, the Permission matrix, and role_gte().

These tests are pure unit tests — they use MagicMock/AsyncMock for the DB
and never hit a real database. The goal is to prove:
1. The permission matrix maps each project role to exactly the correct set.
2. role_gte() correctly respects the viewer < contributor < manager < admin order.
3. RBACService.check() lets system admins through unconditionally.
4. RBACService.check() resolves project role from DB for regular users.
5. RBACService.assert_permitted() raises ForbiddenException on failure.
6. RBACService.get_project_role() returns "admin" for system admins.
7. RBACService.get_accessible_project_ids() returns None for admins (sentinel).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.core.exceptions import ForbiddenException
from app.services.rbac_service import (
    Permission,
    RBACService,
    _PROJECT_ROLE_PERMISSIONS,
    role_gte,
)


# ── Permission matrix tests ───────────────────────────────────────────────────

class TestPermissionMatrix:
    def test_viewer_permissions(self):
        perms = _PROJECT_ROLE_PERMISSIONS["viewer"]
        assert Permission.CAPTURE_READ in perms
        assert Permission.ROOM_READ in perms
        assert Permission.PROJECT_READ in perms
        # viewer must NOT have write permissions
        assert Permission.CAPTURE_UPLOAD not in perms
        assert Permission.CAPTURE_APPROVE not in perms
        assert Permission.CAPTURE_DELETE not in perms
        assert Permission.ROOM_WRITE not in perms
        assert Permission.PROJECT_WRITE not in perms
        assert Permission.USER_ASSIGN not in perms
        assert Permission.ANALYTICS_READ not in perms

    def test_contributor_adds_upload(self):
        perms = _PROJECT_ROLE_PERMISSIONS["contributor"]
        assert Permission.CAPTURE_UPLOAD in perms
        assert Permission.CAPTURE_READ in perms
        # contributor still cannot approve or delete
        assert Permission.CAPTURE_APPROVE not in perms
        assert Permission.CAPTURE_DELETE not in perms
        assert Permission.ROOM_WRITE not in perms
        assert Permission.USER_ASSIGN not in perms

    def test_manager_adds_approve_and_analytics(self):
        perms = _PROJECT_ROLE_PERMISSIONS["manager"]
        assert Permission.CAPTURE_APPROVE in perms
        assert Permission.ROOM_WRITE in perms
        assert Permission.ANALYTICS_READ in perms
        # manager cannot delete captures or manage users
        assert Permission.CAPTURE_DELETE not in perms
        assert Permission.USER_ASSIGN not in perms
        assert Permission.PROJECT_WRITE not in perms

    def test_admin_has_all_permissions(self):
        perms = _PROJECT_ROLE_PERMISSIONS["admin"]
        for p in Permission:
            assert p in perms, f"admin should have {p}"

    def test_roles_are_strictly_cumulative(self):
        """Each role's permissions are a superset of the one below it."""
        viewer = _PROJECT_ROLE_PERMISSIONS["viewer"]
        contributor = _PROJECT_ROLE_PERMISSIONS["contributor"]
        manager = _PROJECT_ROLE_PERMISSIONS["manager"]
        admin = _PROJECT_ROLE_PERMISSIONS["admin"]

        assert viewer.issubset(contributor)
        assert contributor.issubset(manager)
        assert manager.issubset(admin)

    def test_unknown_role_returns_empty(self):
        from app.services.rbac_service import _PROJECT_ROLE_PERMISSIONS
        perms = _PROJECT_ROLE_PERMISSIONS.get("ghost_role", frozenset())
        assert len(perms) == 0


# ── role_gte() tests ──────────────────────────────────────────────────────────

class TestRoleGte:
    def test_equal_roles(self):
        for role in ("viewer", "contributor", "manager", "admin"):
            assert role_gte(role, role) is True

    def test_higher_than_minimum(self):
        assert role_gte("admin", "viewer") is True
        assert role_gte("admin", "contributor") is True
        assert role_gte("admin", "manager") is True
        assert role_gte("manager", "viewer") is True
        assert role_gte("manager", "contributor") is True
        assert role_gte("contributor", "viewer") is True

    def test_lower_than_minimum(self):
        assert role_gte("viewer", "contributor") is False
        assert role_gte("viewer", "manager") is False
        assert role_gte("viewer", "admin") is False
        assert role_gte("contributor", "manager") is False
        assert role_gte("contributor", "admin") is False
        assert role_gte("manager", "admin") is False

    def test_unknown_role_fails(self):
        assert role_gte("unknown_role", "viewer") is False

    def test_unknown_minimum_fails(self):
        # 999 is used for unknown minimum, so no role passes
        assert role_gte("admin", "unknown_minimum") is False


# ── RBACService unit tests ────────────────────────────────────────────────────

def _make_rbac_service(project_role_return: str = None) -> RBACService:
    """Creates an RBACService with a mocked UserProjectRepository."""
    mock_db = MagicMock()
    service = RBACService(mock_db)
    # Patch the internal repository
    service._up_repo = MagicMock()
    service._up_repo.get_project_role = AsyncMock(return_value=project_role_return)
    service._up_repo.get_accessible_project_ids = AsyncMock(return_value=["proj1", "proj2"])
    return service


class TestRBACServiceCheck:
    @pytest.mark.asyncio
    async def test_system_admin_bypasses_project_role(self):
        """System admins get True for any permission without a DB query."""
        service = _make_rbac_service(project_role_return=None)

        result = await service.check(
            user_id="u1", org_id="o1", system_role="admin",
            permission=Permission.CAPTURE_DELETE, project_id=None,
        )
        assert result is True
        # Confirm the DB was never consulted
        service._up_repo.get_project_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_super_admin_bypasses_project_role(self):
        service = _make_rbac_service(project_role_return=None)
        result = await service.check(
            user_id="u1", org_id="o1", system_role="super_admin",
            permission=Permission.USER_ASSIGN,
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_regular_user_without_project_id_denied(self):
        """A regular user with no project_id can never pass a permission check."""
        service = _make_rbac_service(project_role_return="admin")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_READ, project_id=None,
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_regular_user_with_no_assignment_denied(self):
        service = _make_rbac_service(project_role_return=None)
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_READ, project_id="proj1",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_viewer_can_read(self):
        service = _make_rbac_service(project_role_return="viewer")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_READ, project_id="proj1",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_viewer_cannot_upload(self):
        service = _make_rbac_service(project_role_return="viewer")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_UPLOAD, project_id="proj1",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_contributor_can_upload(self):
        service = _make_rbac_service(project_role_return="contributor")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_UPLOAD, project_id="proj1",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_contributor_cannot_approve(self):
        service = _make_rbac_service(project_role_return="contributor")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_APPROVE, project_id="proj1",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_manager_can_approve(self):
        service = _make_rbac_service(project_role_return="manager")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_APPROVE, project_id="proj1",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_manager_cannot_delete(self):
        service = _make_rbac_service(project_role_return="manager")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_DELETE, project_id="proj1",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_project_admin_can_delete(self):
        service = _make_rbac_service(project_role_return="admin")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_DELETE, project_id="proj1",
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_project_admin_can_assign_users(self):
        service = _make_rbac_service(project_role_return="admin")
        result = await service.check(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.USER_ASSIGN, project_id="proj1",
        )
        assert result is True


class TestRBACServiceAssertPermitted:
    @pytest.mark.asyncio
    async def test_raises_forbidden_on_failure(self):
        service = _make_rbac_service(project_role_return="viewer")
        with pytest.raises(ForbiddenException):
            await service.assert_permitted(
                user_id="u1", org_id="o1", system_role="user",
                permission=Permission.CAPTURE_DELETE, project_id="proj1",
            )

    @pytest.mark.asyncio
    async def test_does_not_raise_on_success(self):
        service = _make_rbac_service(project_role_return="admin")
        # Should not raise
        await service.assert_permitted(
            user_id="u1", org_id="o1", system_role="user",
            permission=Permission.CAPTURE_DELETE, project_id="proj1",
        )


class TestRBACServiceGetProjectRole:
    @pytest.mark.asyncio
    async def test_admin_always_returns_admin_role(self):
        service = _make_rbac_service(project_role_return=None)
        role = await service.get_project_role("u", "p", "o", system_role="admin")
        assert role == "admin"
        service._up_repo.get_project_role.assert_not_called()

    @pytest.mark.asyncio
    async def test_regular_user_fetches_from_db(self):
        service = _make_rbac_service(project_role_return="contributor")
        role = await service.get_project_role("u", "p", "o", system_role="user")
        assert role == "contributor"
        service._up_repo.get_project_role.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_assignment_returns_none(self):
        service = _make_rbac_service(project_role_return=None)
        role = await service.get_project_role("u", "p", "o", system_role="user")
        assert role is None


class TestRBACServiceGetAccessibleProjectIds:
    @pytest.mark.asyncio
    async def test_admin_returns_none_sentinel(self):
        service = _make_rbac_service()
        result = await service.get_accessible_project_ids("u", "o", system_role="admin")
        assert result is None  # None = "all projects"
        service._up_repo.get_accessible_project_ids.assert_not_called()

    @pytest.mark.asyncio
    async def test_regular_user_returns_project_list(self):
        service = _make_rbac_service()
        result = await service.get_accessible_project_ids("u", "o", system_role="user")
        assert isinstance(result, list)
        service._up_repo.get_accessible_project_ids.assert_called_once()
