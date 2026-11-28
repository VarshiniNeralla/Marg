"""Recycle bin API: list (filter, sort, pages), restore, empty, who sees what, the 30-day purge."""
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.services import recycle_bin
from tests.conftest import ORG_ID, _make_user_doc, auth_headers, make_access_token

BIN = "/api/v1/recycle-bin"


async def _user(mock_db, role, email, name):
    uid = str(ObjectId())
    await mock_db.users.insert_one(_make_user_doc(uid, ORG_ID, role=role, email=email, name=name))
    return uid, auth_headers(make_access_token(uid, ORG_ID, role=role))


async def _assign(mock_db, uid, project_id):
    await mock_db.user_projects.insert_one(
        {"org_id": ObjectId(ORG_ID), "user_id": ObjectId(uid), "project_id": project_id, "is_active": True}
    )


async def _capture(mock_db, cid, room="Master Bedroom", project="p_a", owner="u1"):
    await mock_db.captures.insert_one({
        "_id": cid, "id": cid, "orgId": ORG_ID, "projectId": project, "roomName": room, "floorLabel": "Floor 4",
        "uploadedByUserId": owner, "uploadedBy": "Tester",
        "mediaAssets": [{"public_id": f"org/{cid}", "resource_type": "image"}],
    })


async def _bin(client, headers, **params):
    resp = await client.get(BIN, headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


class TestListing:
    @pytest.mark.asyncio
    async def test_everything_deleted_shows_up_with_a_name_a_place_and_30_days_left(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin One")
        await _capture(mock_db, "c1")
        await mock_db.tours.insert_one({"_id": "t1", "id": "t1", "orgId": ORG_ID, "projectId": "p_a", "title": "Floor 4 walk"})
        await mock_db.floor_plans.insert_one({"_id": "fp1", "id": "fp1", "orgId": ORG_ID, "projectId": "p_a", "floorLabel": "Floor 4"})
        await mock_db.projects.insert_one({"_id": "p_gone", "id": "p_gone", "orgId": ORG_ID, "name": "Old Tower"})
        for url in ("/api/v1/captures/c1", "/api/v1/tours/t1", "/api/v1/floor-plans/fp1", "/api/v1/projects/p_gone"):
            assert (await client.delete(url, headers=admin)).status_code == 200

        data = await _bin(client, admin)
        assert data["total"] == 4 and data["retentionDays"] == 30
        assert data["counts"] == {"all": 4, "capture": 1, "tour": 1, "floor_plan": 1, "project": 1}
        by_kind = {i["kind"]: i for i in data["items"]}
        assert by_kind["capture"]["title"] == "Master Bedroom" and by_kind["capture"]["subtitle"] == "Floor 4"
        assert by_kind["tour"]["title"] == "Floor 4 walk"
        assert by_kind["floor_plan"]["title"] == "Floor 4"
        assert by_kind["project"]["title"] == "Old Tower" and by_kind["project"]["id"] == "project:p_gone"
        assert all(i["daysLeft"] == 30 and i["deletedByName"] == "Admin One" for i in data["items"])

    @pytest.mark.asyncio
    async def test_filter_sort_and_pages(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin One")
        now = datetime.now(timezone.utc)
        for i, (title, age) in enumerate([("Kitchen", 1), ("Balcony", 5), ("Attic", 10), ("Garage", 3), ("Study", 7)]):
            await mock_db[recycle_bin.COLLECTION].insert_one({
                "kind": "capture", "sourceCollection": "captures", "docId": f"c{i}", "orgId": ORG_ID, "projectId": "p_a",
                "title": title, "subtitle": "", "deletedAt": now - timedelta(days=age), "deletedBy": "x", "deletedByName": "X",
                "restoredAt": None, "doc": {"_id": f"c{i}"},
            })
        await mock_db[recycle_bin.COLLECTION].insert_one({
            "kind": "tour", "sourceCollection": "tours", "docId": "t0", "orgId": ORG_ID, "projectId": "p_a", "title": "Walk",
            "subtitle": "", "deletedAt": now - timedelta(days=2), "deletedBy": "x", "restoredAt": None, "doc": {"_id": "t0"},
        })

        titles = lambda d: [i["title"] for i in d["items"]]  # noqa: E731
        assert titles(await _bin(client, admin, kind="capture", sort="newest"))[:2] == ["Kitchen", "Garage"]
        assert titles(await _bin(client, admin, kind="capture", sort="oldest"))[:2] == ["Attic", "Study"]
        assert titles(await _bin(client, admin, kind="capture", sort="expiring"))[0] == "Attic"  # purged soonest
        assert titles(await _bin(client, admin, kind="capture", sort="name")) == ["Attic", "Balcony", "Garage", "Kitchen", "Study"]
        assert (await _bin(client, admin, kind="tour"))["total"] == 1

        p1 = await _bin(client, admin, sort="name", pageSize=2, page=1)
        p3 = await _bin(client, admin, sort="name", pageSize=2, page=3)
        assert p1["total"] == 6 and p1["pages"] == 3 and len(p1["items"]) == 2
        assert len(p3["items"]) == 2 and p3["page"] == 3
        assert (await _bin(client, admin, pageSize=2, page=99))["page"] == 3  # out of range -> last page

    @pytest.mark.asyncio
    async def test_old_items_are_not_listed(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin One")
        await mock_db[recycle_bin.COLLECTION].insert_one({
            "kind": "capture", "sourceCollection": "captures", "docId": "old", "orgId": ORG_ID, "title": "Old",
            "deletedAt": datetime.now(timezone.utc) - timedelta(days=31), "restoredAt": None, "doc": {"_id": "old"},
        })
        assert (await _bin(client, admin))["total"] == 0


class TestWhoSeesWhat:
    @pytest.mark.asyncio
    async def test_field_engineer_sees_only_their_own_deletions_manager_sees_their_projects(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        fe_id, fe = await _user(mock_db, "field_engineer", "fe@t.com", "Field Eng")
        mgr_id, mgr = await _user(mock_db, "manager", "m@t.com", "Manager")
        await _assign(mock_db, mgr_id, "p_a")
        await _assign(mock_db, fe_id, "p_a")
        await _capture(mock_db, "c_fe", room="Mine", owner=fe_id)
        await _capture(mock_db, "c_admin_a", room="Admin A", project="p_a")
        await _capture(mock_db, "c_admin_b", room="Admin B", project="p_b")
        assert (await client.delete("/api/v1/captures/c_fe", headers=fe)).status_code == 200
        assert (await client.delete("/api/v1/captures/c_admin_a", headers=admin)).status_code == 200
        assert (await client.delete("/api/v1/captures/c_admin_b", headers=admin)).status_code == 200

        assert {i["title"] for i in (await _bin(client, admin))["items"]} == {"Mine", "Admin A", "Admin B"}
        assert {i["title"] for i in (await _bin(client, fe))["items"]} == {"Mine"}
        assert {i["title"] for i in (await _bin(client, mgr))["items"]} == {"Mine", "Admin A"}  # their project only

        # A field engineer cannot restore or purge somebody else's item.
        other = [i for i in (await _bin(client, admin))["items"] if i["title"] == "Admin A"][0]
        assert (await client.post(f"{BIN}/{other['id']}/restore", headers=fe)).status_code == 404
        assert await mock_db.captures.find_one({"_id": "c_admin_a"}) is None

    @pytest.mark.asyncio
    async def test_read_only_roles_are_refused(self, client, mock_db):
        _, viewer = await _user(mock_db, "viewer", "v@t.com", "Viewer")
        assert (await client.get(BIN, headers=viewer)).status_code == 403


class TestRestore:
    @pytest.mark.asyncio
    async def test_restoring_a_capture_brings_the_record_back_and_it_leaves_the_bin(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        await _capture(mock_db, "c1")
        await client.delete("/api/v1/captures/c1", headers=admin)
        item = (await _bin(client, admin))["items"][0]
        resp = await client.post(f"{BIN}/{item['id']}/restore", headers=admin)
        assert resp.status_code == 200 and resp.json()["data"]["outcome"] == "restored"
        back = await mock_db.captures.find_one({"_id": "c1"})
        assert back and back["roomName"] == "Master Bedroom" and back["restoredAt"]
        assert (await _bin(client, admin))["total"] == 0

    @pytest.mark.asyncio
    async def test_restoring_a_project_unarchives_it(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        await mock_db.projects.insert_one({"_id": "p1", "id": "p1", "orgId": ORG_ID, "name": "Apas", "status": "active"})
        assert (await client.put("/api/v1/projects/p1", json={"archived": True, "status": "draft"}, headers=admin)).status_code == 200
        stored = await mock_db.projects.find_one({"_id": "p1"})
        assert stored["archived"] is True and stored["deletedAt"] and stored["deletedByName"] == "Admin"
        item = (await _bin(client, admin))["items"][0]
        assert item["kind"] == "project" and item["title"] == "Apas"

        assert (await client.post(f"{BIN}/{item['id']}/restore", headers=admin)).status_code == 200
        back = await mock_db.projects.find_one({"_id": "p1"})
        assert back["archived"] is False and back["status"] == "active" and back["deletedAt"] is None
        assert (await _bin(client, admin))["total"] == 0

    @pytest.mark.asyncio
    async def test_archiving_twice_keeps_the_first_deletion_time(self, client, mock_db):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        await mock_db.projects.insert_one({"_id": "p1", "id": "p1", "orgId": ORG_ID, "name": "Apas"})
        await client.put("/api/v1/projects/p1", json={"archived": True}, headers=admin)
        first = (await mock_db.projects.find_one({"_id": "p1"}))["deletedAt"]
        await client.put("/api/v1/projects/p1", json={"archived": True, "deletedAt": "2000-01-01T00:00:00Z"}, headers=admin)
        assert (await mock_db.projects.find_one({"_id": "p1"}))["deletedAt"] == first  # a client cannot reset the clock

    @pytest.mark.asyncio
    async def test_restoring_a_floor_plan_brings_back_its_capture_points_and_its_image_was_kept(self, client, mock_db, monkeypatch):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        destroyed: list = []

        async def fake_destroy(assets, **kw):
            destroyed.extend(assets)

        monkeypatch.setattr("app.services.cloudinary_service.delete_media_assets", fake_destroy)
        await mock_db.floor_plans.insert_one({
            "_id": "fp1", "id": "fp1", "orgId": ORG_ID, "projectId": "p_a", "floorLabel": "Floor 2",
            "mediaAssets": [{"public_id": "org/plan1", "resource_type": "image"}],
        })
        await mock_db.capture_pins.insert_one({"_id": "pin1", "id": "pin1", "orgId": ORG_ID, "projectId": "p_a", "floorPlanId": "fp1", "sequenceNumber": 1, "captureIds": []})
        assert (await client.delete("/api/v1/pins/pin1", headers=admin)).status_code == 200
        assert (await client.delete("/api/v1/floor-plans/fp1", headers=admin)).status_code == 200
        assert destroyed == []  # the picture is kept while the plan sits in the bin

        data = await _bin(client, admin)
        assert [i["kind"] for i in data["items"]] == ["floor_plan"]  # the capture point is not listed on its own
        assert (await client.post(f"{BIN}/{data['items'][0]['id']}/restore", headers=admin)).status_code == 200
        assert await mock_db.floor_plans.find_one({"_id": "fp1"}) is not None
        assert await mock_db.capture_pins.find_one({"_id": "pin1"}) is not None


class TestEmptyAndPurge:
    @pytest.mark.asyncio
    async def test_emptying_deletes_only_what_the_person_can_see_and_destroys_the_files(self, client, mock_db, monkeypatch):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        fe_id, fe = await _user(mock_db, "field_engineer", "fe@t.com", "Field Eng")
        destroyed: list = []

        async def fake_destroy(assets, **kw):
            destroyed.extend(a["public_id"] for a in assets)

        monkeypatch.setattr("app.services.cloudinary_service.delete_media_assets", fake_destroy)
        await _capture(mock_db, "c_fe", owner=fe_id)
        await _capture(mock_db, "c_admin")
        await client.delete("/api/v1/captures/c_fe", headers=fe)
        await client.delete("/api/v1/captures/c_admin", headers=admin)
        assert destroyed == []  # kept while in the bin

        resp = await client.delete(BIN, headers=fe)
        assert resp.status_code == 200 and resp.json()["data"]["purged"] == 1
        assert destroyed == [f"org/c_fe"]
        assert (await _bin(client, fe))["total"] == 0
        assert (await _bin(client, admin))["total"] == 1  # the admin's own item is untouched

        resp = await client.delete(BIN, headers=admin)
        assert resp.json()["data"]["purged"] == 1 and destroyed == ["org/c_fe", "org/c_admin"]

    @pytest.mark.asyncio
    async def test_a_file_shared_with_a_live_capture_is_not_destroyed(self, client, mock_db, monkeypatch):
        _, admin = await _user(mock_db, "admin", "a@t.com", "Admin")
        destroyed: list = []

        async def fake_destroy(assets, **kw):
            destroyed.extend(a["public_id"] for a in assets)

        monkeypatch.setattr("app.services.cloudinary_service.delete_media_assets", fake_destroy)
        await _capture(mock_db, "c1")
        await mock_db.captures.insert_one({"_id": "c2", "id": "c2", "orgId": ORG_ID, "mediaAssets": [{"public_id": "org/c1"}]})
        await client.delete("/api/v1/captures/c1", headers=admin)
        await client.delete(BIN, headers=admin)
        assert destroyed == []  # c2 still shows the same picture

    @pytest.mark.asyncio
    async def test_items_older_than_30_days_are_purged_and_newer_ones_kept(self, mock_db, monkeypatch):
        async def fake_destroy(assets, **kw):
            return None

        monkeypatch.setattr("app.services.cloudinary_service.delete_media_assets", fake_destroy)
        now = datetime.now(timezone.utc)
        for cid, age in (("c_old", 31), ("c_new", 5)):
            await mock_db[recycle_bin.COLLECTION].insert_one({
                "kind": "capture", "sourceCollection": "captures", "docId": cid, "orgId": ORG_ID, "title": cid,
                "deletedAt": now - timedelta(days=age), "restoredAt": None, "doc": {"_id": cid, "mediaAssets": []},
            })
        await mock_db.projects.insert_many([
            {"_id": "p_old", "id": "p_old", "orgId": ORG_ID, "name": "Old", "archived": True, "deletedAt": now - timedelta(days=40)},
            {"_id": "p_new", "id": "p_new", "orgId": ORG_ID, "name": "New", "archived": True, "deletedAt": now - timedelta(days=2)},
            {"_id": "p_live", "id": "p_live", "orgId": ORG_ID, "name": "Live"},
        ])
        await mock_db.towers.insert_one({"_id": "t_old", "id": "t_old", "orgId": ORG_ID, "projectId": "p_old"})
        await mock_db.floors.insert_one({"_id": "f_old", "id": "f_old", "orgId": ORG_ID, "towerId": "t_old"})
        await mock_db.captures.insert_one({"_id": "cap_old", "orgId": ORG_ID, "projectId": "p_old"})

        assert await recycle_bin.purge_expired(mock_db) == 2
        left = [e["docId"] async for e in mock_db[recycle_bin.COLLECTION].find({})]
        assert left == ["c_new"]
        assert await mock_db.projects.find_one({"_id": "p_old"}) is None
        assert await mock_db.towers.find_one({"_id": "t_old"}) is None
        assert await mock_db.floors.find_one({"_id": "f_old"}) is None
        assert await mock_db.captures.find_one({"_id": "cap_old"}) is None
        assert await mock_db.projects.find_one({"_id": "p_new"}) is not None  # recent, still restorable
        assert await mock_db.projects.find_one({"_id": "p_live"}) is not None  # never deleted
