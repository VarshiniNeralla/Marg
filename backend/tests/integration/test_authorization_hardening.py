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

    @pytest.mark.asyncio
    async def test_field_engineer_snapshot_backfills_legacy_capture_and_tour_owner_ids(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(
                fe_id,
                ORG_ID,
                role="field_engineer",
                email="varshini@test.com",
                name="Varshini",
            )
        )
        await mock_db.captures.insert_one({
            "_id": "c_legacy_varshini",
            "id": "c_legacy_varshini",
            "orgId": ORG_ID,
            "projectId": "p1",
            "roomId": "r1",
            "uploadedBy": "Varshini",
            "uploaded_by": "Varshini",
        })
        await mock_db.tours.insert_one({
            "_id": "t_legacy_varshini",
            "id": "t_legacy_varshini",
            "orgId": ORG_ID,
            "projectId": "p1",
            "captureId": "c_legacy_varshini",
            "status": "published",
            "floorPlanId": "fp1",
            "steps": [{"pinId": "pin1", "captureId": "c_legacy_varshini", "sequenceNumber": 1, "label": "Stop 1", "panoramaUrl": None}],
            "uploadedBy": "Varshini",
            "uploaded_by": "Varshini",
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.get("/api/v1/workflow/snapshot", headers=auth_headers(token))
        assert resp.status_code == 200

        data = resp.json()["data"]
        assert any(c["id"] == "c_legacy_varshini" for c in data["captures"])
        assert any(t["id"] == "t_legacy_varshini" for t in data["tours"])

        stored_capture = await mock_db.captures.find_one({"_id": "c_legacy_varshini"})
        stored_tour = await mock_db.tours.find_one({"_id": "t_legacy_varshini"})
        assert stored_capture["uploadedByUserId"] == fe_id
        assert stored_capture["uploaded_by_user_id"] == fe_id
        assert stored_tour["uploadedByUserId"] == fe_id
        assert stored_tour["uploaded_by_user_id"] == fe_id

    @pytest.mark.asyncio
    async def test_field_engineer_snapshot_claims_legacy_tour_from_owned_capture(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(
                fe_id,
                ORG_ID,
                role="field_engineer",
                email="varshini@myhomeconstructions.com",
                name="Varshini",
            )
        )
        await mock_db.captures.insert_one({
            "_id": "c_varshini_owned",
            "id": "c_varshini_owned",
            "orgId": ORG_ID,
            "projectId": "p1",
            "roomId": "r1",
            "uploadedByUserId": fe_id,
            "uploaded_by_user_id": fe_id,
            "uploadedBy": "Varshini",
            "uploaded_by": "Varshini",
        })
        await mock_db.tours.insert_one({
            "_id": "t_legacy_mislabeled",
            "id": "t_legacy_mislabeled",
            "orgId": ORG_ID,
            "projectId": "p1",
            "captureId": "c_varshini_owned",
            "status": "published",
            "floorPlanId": "fp1",
            "steps": [{"pinId": "pin1", "captureId": "c_varshini_owned", "sequenceNumber": 1, "label": "Stop 1", "panoramaUrl": None}],
            "uploadedBy": "You",
            "uploaded_by": "You",
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.get("/api/v1/workflow/snapshot", headers=auth_headers(token))
        assert resp.status_code == 200

        data = resp.json()["data"]
        assert any(t["id"] == "t_legacy_mislabeled" for t in data["tours"])

        stored_tour = await mock_db.tours.find_one({"_id": "t_legacy_mislabeled"})
        assert stored_tour["uploadedByUserId"] == fe_id
        assert stored_tour["uploaded_by_user_id"] == fe_id

    @pytest.mark.asyncio
    async def test_field_engineer_snapshot_hides_audit_logs_and_other_capture_ids(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        other_id = str(ObjectId())
        await mock_db.users.insert_many([
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe@test.com", name="Field Eng"),
            _make_user_doc(other_id, ORG_ID, role="field_engineer", email="other@test.com", name="Other Eng"),
        ])
        await mock_db.captures.insert_many([
            {"_id": "c_own", "id": "c_own", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": fe_id},
            {"_id": "c_other", "id": "c_other", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": other_id},
        ])
        await mock_db.capture_pins.insert_one({
            "_id": "pin_shared",
            "id": "pin_shared",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "sequenceNumber": 1,
            "captureIds": ["c_own", "c_other"],
        })
        await mock_db.audit_logs.insert_one({
            "_id": "audit1",
            "id": "audit1",
            "orgId": ORG_ID,
            "projectId": "p1",
            "action": "CAPTURE_UPLOAD",
            "actorId": other_id,
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.get("/api/v1/workflow/snapshot", headers=auth_headers(token))
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["auditLogs"] == []
        assert len(data["capturePins"]) == 1
        assert data["capturePins"][0]["captureIds"] == ["c_own"]

    @pytest.mark.asyncio
    async def test_field_engineer_list_pins_hides_other_capture_ids(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        other_id = str(ObjectId())
        await mock_db.users.insert_many([
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe2@test.com", name="Field Eng 2"),
            _make_user_doc(other_id, ORG_ID, role="field_engineer", email="other2@test.com", name="Other Eng 2"),
        ])
        await mock_db.captures.insert_many([
            {"_id": "c_own2", "id": "c_own2", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": fe_id},
            {"_id": "c_other2", "id": "c_other2", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": other_id},
        ])
        await mock_db.capture_pins.insert_one({
            "_id": "pin_shared2",
            "id": "pin_shared2",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "sequenceNumber": 1,
            "captureIds": ["c_own2", "c_other2"],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.get("/api/v1/floor-plans/fp1/pins", headers=auth_headers(token))
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["captureIds"] == ["c_own2"]

    @pytest.mark.asyncio
    async def test_field_engineer_cannot_create_tour_from_other_engineer_capture(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        other_id = str(ObjectId())
        await mock_db.users.insert_many([
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe3@test.com", name="Field Eng 3"),
            _make_user_doc(other_id, ORG_ID, role="field_engineer", email="other3@test.com", name="Other Eng 3"),
        ])
        await mock_db.captures.insert_one({
            "_id": "c_other_tour",
            "id": "c_other_tour",
            "orgId": ORG_ID,
            "projectId": "p1",
            "roomId": "r1",
            "uploadedByUserId": other_id,
            "mediaAssets": [{"processed_panorama_url": "https://example.com/pano.jpg", "thumbnail_url": "https://example.com/thumb.jpg"}],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/tours",
            headers=auth_headers(token),
            json={"id": "t_bad", "projectId": "p1", "floorPlanId": "fp1", "captureId": "c_other_tour"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_field_engineer_cannot_create_tour_with_other_engineer_step_capture(self, client, mock_db):
        """Walkthrough steps[] must respect capture ownership — not only top-level captureId."""
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        other_id = str(ObjectId())
        await mock_db.users.insert_many([
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe5@test.com", name="Field Eng 5"),
            _make_user_doc(other_id, ORG_ID, role="field_engineer", email="other5@test.com", name="Other Eng 5"),
        ])
        await mock_db.captures.insert_many([
            {
                "_id": "c_own_step",
                "id": "c_own_step",
                "orgId": ORG_ID,
                "projectId": "p1",
                "roomId": "r1",
                "uploadedByUserId": fe_id,
                "processingStatus": "reviewed",
                "mediaAssets": [{"processed_panorama_url": "https://example.com/own.jpg"}],
            },
            {
                "_id": "c_other_step",
                "id": "c_other_step",
                "orgId": ORG_ID,
                "projectId": "p1",
                "roomId": "r2",
                "uploadedByUserId": other_id,
                "processingStatus": "reviewed",
                "mediaAssets": [{"processed_panorama_url": "https://example.com/other.jpg"}],
            },
        ])

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/tours",
            headers=auth_headers(token),
            json={
                "id": "t_bad_steps",
                "projectId": "p1",
                "floorPlanId": "fp1",
                "captureId": "c_own_step",
                "status": "published",
                "steps": [
                    {
                        "captureId": "c_own_step",
                        "pinId": "pin1",
                        "sequenceNumber": 1,
                        "panoramaUrl": "https://example.com/own.jpg",
                    },
                    {
                        "captureId": "c_other_step",
                        "pinId": "pin2",
                        "sequenceNumber": 2,
                        "panoramaUrl": "https://example.com/other.jpg",
                    },
                ],
            },
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_tour_rejects_processing_capture_in_steps(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe6@test.com", name="Field Eng 6"),
        )
        await mock_db.captures.insert_one({
            "_id": "c_processing",
            "id": "c_processing",
            "orgId": ORG_ID,
            "projectId": "p1",
            "roomId": "r1",
            "uploadedByUserId": fe_id,
            "processingStatus": "processing",
            "mediaAssets": [{"processing_status": "processing"}],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/tours",
            headers=auth_headers(token),
            json={
                "id": "t_proc",
                "projectId": "p1",
                "floorPlanId": "fp1",
                "captureId": "c_processing",
                "status": "published",
                "steps": [
                    {
                        "captureId": "c_processing",
                        "pinId": "pin1",
                        "sequenceNumber": 1,
                        "panoramaUrl": "https://example.com/pending.jpg",
                    },
                ],
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_tour_rejects_published_walkthrough_without_panorama_url(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe7@test.com", name="Field Eng 7"),
        )
        await mock_db.captures.insert_one({
            "_id": "c_ready",
            "id": "c_ready",
            "orgId": ORG_ID,
            "projectId": "p1",
            "roomId": "r1",
            "uploadedByUserId": fe_id,
            "processingStatus": "reviewed",
            "mediaAssets": [{"processed_panorama_url": "https://example.com/pano.jpg"}],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/tours",
            headers=auth_headers(token),
            json={
                "id": "t_no_pano",
                "projectId": "p1",
                "floorPlanId": "fp1",
                "captureId": "c_ready",
                "status": "published",
                "steps": [
                    {
                        "captureId": "c_ready",
                        "pinId": "pin1",
                        "sequenceNumber": 1,
                    },
                ],
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_tour_accepts_valid_multi_step_walkthrough(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe8@test.com", name="Field Eng 8"),
        )
        await mock_db.captures.insert_many([
            {
                "_id": "c_a",
                "id": "c_a",
                "orgId": ORG_ID,
                "projectId": "p1",
                "roomId": "r1",
                "uploadedByUserId": fe_id,
                "processingStatus": "reviewed",
                "mediaAssets": [{"processed_panorama_url": "https://example.com/a.jpg"}],
            },
            {
                "_id": "c_b",
                "id": "c_b",
                "orgId": ORG_ID,
                "projectId": "p1",
                "roomId": "r2",
                "uploadedByUserId": fe_id,
                "processingStatus": "reviewed",
                "mediaAssets": [{"processed_panorama_url": "https://example.com/b.jpg"}],
            },
        ])

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.post(
            "/api/v1/tours",
            headers=auth_headers(token),
            json={
                "id": "t_ok",
                "projectId": "p1",
                "floorPlanId": "fp1",
                "captureId": "c_a",
                "status": "published",
                "steps": [
                    {
                        "captureId": "c_a",
                        "pinId": "pin1",
                        "sequenceNumber": 1,
                        "panoramaUrl": "https://example.com/a.jpg",
                    },
                    {
                        "captureId": "c_b",
                        "pinId": "pin2",
                        "sequenceNumber": 2,
                        "panoramaUrl": "https://example.com/b.jpg",
                    },
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.json()["data"]
        assert data["id"] == "t_ok"
        assert len(data.get("steps") or []) == 2

    @pytest.mark.asyncio
    async def test_field_engineer_cannot_delete_pin_with_other_engineer_capture(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        other_id = str(ObjectId())
        await mock_db.users.insert_many([
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe4@test.com", name="Field Eng 4"),
            _make_user_doc(other_id, ORG_ID, role="field_engineer", email="other4@test.com", name="Other Eng 4"),
        ])
        await mock_db.captures.insert_many([
            {"_id": "c_own4", "id": "c_own4", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": fe_id},
            {"_id": "c_other4", "id": "c_other4", "orgId": ORG_ID, "projectId": "p1", "roomId": "r1", "uploadedByUserId": other_id},
        ])
        await mock_db.capture_pins.insert_one({
            "_id": "pin_delete_blocked",
            "id": "pin_delete_blocked",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "roomId": "r1",
            "sequenceNumber": 1,
            "captureIds": ["c_own4", "c_other4"],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.delete("/api/v1/pins/pin_delete_blocked", headers=auth_headers(token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_field_engineer_cannot_delete_empty_capture_pin(self, client, mock_db):
        """Site Engineers may click/upload on points — never remove the points themselves via DELETE /pins."""
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe_pin_del@test.com", name="Field Eng")
        )
        await mock_db.capture_pins.insert_one({
            "_id": "pin_empty_delete",
            "id": "pin_empty_delete",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "roomId": "r1",
            "sequenceNumber": 1,
            "captureIds": [],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        resp = await client.delete("/api/v1/pins/pin_empty_delete", headers=auth_headers(token))
        assert resp.status_code == 403
        still = await mock_db.capture_pins.find_one({"_id": "pin_empty_delete"})
        assert still is not None

    @pytest.mark.asyncio
    async def test_deleting_capture_keeps_empty_pin(self, client, mock_db):
        """Deleting media unlinks the timeline but leaves the capture point on the plan."""
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe_cap_pin@test.com", name="Field Eng")
        )
        await mock_db.captures.insert_one({
            "_id": "c_last_on_pin",
            "id": "c_last_on_pin",
            "orgId": ORG_ID,
            "uploadedBy": fe_id,
            "engineer": "Field Eng",
            "roomId": "r_last",
        })
        await mock_db.capture_pins.insert_one({
            "_id": "pin_last_cap",
            "id": "pin_last_cap",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "roomId": "r_last",
            "sequenceNumber": 1,
            "captureIds": ["c_last_on_pin"],
        })
        await mock_db.captures.insert_one({
            "_id": "c_multi_a",
            "id": "c_multi_a",
            "orgId": ORG_ID,
            "uploadedBy": fe_id,
            "engineer": "Field Eng",
            "roomId": "r_multi",
        })
        await mock_db.captures.insert_one({
            "_id": "c_multi_b",
            "id": "c_multi_b",
            "orgId": ORG_ID,
            "uploadedBy": fe_id,
            "engineer": "Field Eng",
            "roomId": "r_multi",
        })
        await mock_db.capture_pins.insert_one({
            "_id": "pin_multi_cap",
            "id": "pin_multi_cap",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "roomId": "r_multi",
            "sequenceNumber": 2,
            "captureIds": ["c_multi_a", "c_multi_b"],
        })

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        headers = auth_headers(token)

        last = await client.delete("/api/v1/captures/c_last_on_pin", headers=headers)
        assert last.status_code == 200
        kept = await mock_db.capture_pins.find_one({"_id": "pin_last_cap"})
        assert kept is not None
        assert kept.get("captureIds") == []

        one = await client.delete("/api/v1/captures/c_multi_a", headers=headers)
        assert one.status_code == 200
        multi = await mock_db.capture_pins.find_one({"_id": "pin_multi_cap"})
        assert multi is not None
        assert multi.get("captureIds") == ["c_multi_b"]

    @pytest.mark.asyncio
    async def test_manager_can_delete_capture_pin(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        mgr_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(mgr_id, ORG_ID, role="manager", email="mgr_pin_del@test.com", name="Site Manager")
        )
        await mock_db.capture_pins.insert_one({
            "_id": "pin_mgr_delete",
            "id": "pin_mgr_delete",
            "orgId": ORG_ID,
            "projectId": "p1",
            "floorId": "f1",
            "floorPlanId": "fp1",
            "roomId": "r1",
            "sequenceNumber": 1,
            "captureIds": [],
        })

        token = make_access_token(mgr_id, ORG_ID, role="manager")
        resp = await client.delete("/api/v1/pins/pin_mgr_delete", headers=auth_headers(token))
        assert resp.status_code == 200
        gone = await mock_db.capture_pins.find_one({"_id": "pin_mgr_delete"})
        assert gone is None

    @pytest.mark.asyncio
    async def test_field_engineer_cannot_start_or_poll_progress_analysis(self, client, mock_db):
        from bson import ObjectId
        from tests.conftest import _make_user_doc

        fe_id = str(ObjectId())
        await mock_db.users.insert_one(
            _make_user_doc(fe_id, ORG_ID, role="field_engineer", email="fe5@test.com", name="Field Eng 5")
        )

        token = make_access_token(fe_id, ORG_ID, role="field_engineer")
        start = await client.post(
            "/api/v1/progress-analysis",
            headers=auth_headers(token),
            json={
                "beforeTimelineId": "c1",
                "afterTimelineId": "c2",
                "beforeImage": "https://example.com/before.jpg",
                "afterImage": "https://example.com/after.jpg",
                "beforeDate": "2024-01-01T00:00:00Z",
                "afterDate": "2024-02-01T00:00:00Z",
                "projectName": "P1",
                "tower": "T1",
                "floor": "F1",
                "pinName": "Pin 1",
                "captureType": "360",
            },
        )
        poll = await client.get("/api/v1/progress-analysis/job123", headers=auth_headers(token))
        assert start.status_code == 403
        assert poll.status_code == 403
