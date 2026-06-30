"""
Regression tests for the production-readiness authorization hardening:

  C1 — /auth/register must NOT let an anonymous caller self-assign a privileged
       role (super_admin/admin). The role is forced to "user".
  C2 — /workflow write/delete endpoints must enforce the system-role permission
       matrix: a low-privilege ("user"/"viewer") token cannot create or delete
       projects, towers, captures, tours, etc.

These guard against re-introducing the privilege-escalation and missing-RBAC
holes found in the audit.
"""
import pytest

from tests.conftest import (
    ADMIN_USER_ID,
    ORG_ID,
    REGULAR_USER_ID,
    auth_headers,
    make_access_token,
)


# ── C1: registration cannot escalate role ─────────────────────────────────────

class TestRegisterNoRoleEscalation:
    @pytest.mark.asyncio
    async def test_anonymous_register_ignores_requested_admin_role(self, client):
        """An anonymous registration requesting role=super_admin must come back
        as a plain 'user' (or be rejected) — never an elevated role."""
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Sneaky User",
                "email": "sneaky@test.com",
                "password": "SecurePass1!",
                "org_slug": "test-org",
                "role": "super_admin",
            },
        )
        # 201 when the seeded org exists; 400 if the mock didn't seed the slug.
        assert resp.status_code in (201, 400)
        if resp.status_code == 201:
            data = resp.json()["data"]
            assert data["role"] == "user", "anonymous register must not honor a privileged role"

    @pytest.mark.asyncio
    async def test_anonymous_register_ignores_requested_admin_role_admin(self, client):
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Sneaky Two",
                "email": "sneaky2@test.com",
                "password": "SecurePass1!",
                "org_slug": "test-org",
                "role": "admin",
            },
        )
        assert resp.status_code in (201, 400)
        if resp.status_code == 201:
            assert resp.json()["data"]["role"] == "user"


# ── C2: workflow RBAC enforcement ─────────────────────────────────────────────

class TestWorkflowRBAC:
    @pytest.mark.asyncio
    async def test_low_privilege_user_cannot_create_project(self, client):
        token = make_access_token(REGULAR_USER_ID, ORG_ID, role="user")
        resp = await client.post(
            "/api/v1/projects",
            headers=auth_headers(token),
            json={"id": "p_evil", "name": "Hacked Project"},
        )
        assert resp.status_code == 403, "a 'user' must not be able to create projects"

    @pytest.mark.asyncio
    async def test_low_privilege_user_cannot_delete_project(self, client):
        token = make_access_token(REGULAR_USER_ID, ORG_ID, role="user")
        resp = await client.delete(
            "/api/v1/projects/anything",
            headers=auth_headers(token),
        )
        assert resp.status_code == 403, "a 'user' must not be able to delete projects"

    @pytest.mark.asyncio
    async def test_viewer_cannot_delete_tour(self, client):
        token = make_access_token(REGULAR_USER_ID, ORG_ID, role="viewer")
        resp = await client.delete(
            "/api/v1/tours/anything",
            headers=auth_headers(token),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_can_reach_project_create(self, client):
        """An admin must pass the RBAC gate (the create itself may 200/201)."""
        token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
        resp = await client.post(
            "/api/v1/projects",
            headers=auth_headers(token),
            json={"id": "p_admin_ok", "name": "Legit Project"},
        )
        assert resp.status_code != 403, "admin must not be forbidden from creating projects"

    @pytest.mark.asyncio
    async def test_field_engineer_can_create_capture(self, client, mock_db):
        """Field engineers must retain capture-create (core workflow).

        Role is resolved server-side from the DB user (not the token claim), so
        we seed a real field_engineer rather than just minting a token. This also
        documents the secure behavior: a forged role claim is ignored."""
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe@test.com", name="Field Eng")
        )
        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/captures",
            headers=auth_headers(token),
            json={"id": "c_fe_ok", "roomId": "r1", "mediaAssets": []},
        )
        assert resp.status_code != 403, "field_engineer must keep capture-create permission"

    @pytest.mark.asyncio
    async def test_forged_role_claim_is_ignored(self, client):
        """A token claiming role=admin for a DB 'user' must NOT grant admin — the
        server trusts the DB role, not the JWT claim."""
        forged = make_access_token(REGULAR_USER_ID, ORG_ID, role="admin")
        resp = await client.delete(
            "/api/v1/projects/anything",
            headers=auth_headers(forged),
        )
        assert resp.status_code == 403, "forged admin role claim must be ignored"

    @pytest.mark.asyncio
    async def test_reads_remain_open_to_authenticated_users(self, client):
        """GET endpoints stay accessible to any authenticated org member."""
        token = make_access_token(REGULAR_USER_ID, ORG_ID, role="user")
        resp = await client.get("/api/v1/projects", headers=auth_headers(token))
        assert resp.status_code == 200
