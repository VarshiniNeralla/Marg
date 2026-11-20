"""Recycle bin: everything deleted from the app can be restored, and deleting still works exactly as before."""
import pytest
from bson import ObjectId

from app.services import recycle_bin
from tests.conftest import ORG_ID, _make_user_doc, auth_headers, make_access_token


async def _manager(mock_db):
    """An administrator (the role that may delete captures, tours and pins)."""
    uid = str(ObjectId())
    await mock_db.users.insert_one(_make_user_doc(uid, ORG_ID, role="admin", email="bin_admin@test.com", name="Bin Admin"))
    return uid, auth_headers(make_access_token(uid, ORG_ID, role="admin"))


async def _capture_on_pin(mock_db, cid="c_bin_1", pin_id="pin_bin_1"):
    await mock_db.captures.insert_one({
        "_id": cid, "id": cid, "orgId": ORG_ID, "roomId": "r_bin", "roomName": "Master Bedroom", "floorLabel": "Floor 4",
        "uploadedByUserId": "u1", "uploadedBy": "Tester", "mediaAssets": [{"processedPanoramaUrl": "/media/x/y.jpg"}],
    })
    await mock_db.capture_pins.insert_one({
        "_id": pin_id, "id": pin_id, "orgId": ORG_ID, "projectId": "p1", "floorId": "f1", "floorPlanId": "fp1",
        "roomId": "r_bin", "sequenceNumber": 1, "captureIds": [cid, "c_other"],
    })


class TestDeleteStillWorksAndIsRecoverable:
    @pytest.mark.asyncio
    async def test_deleting_a_capture_keeps_a_full_copy_and_the_pin_link(self, client, mock_db):
        _, headers = await _manager(mock_db)
        await _capture_on_pin(mock_db)
        resp = await client.delete("/api/v1/captures/c_bin_1", headers=headers)
        assert resp.status_code == 200
        # deleting behaves as before
        assert await mock_db.captures.find_one({"_id": "c_bin_1"}) is None
        assert (await mock_db.capture_pins.find_one({"_id": "pin_bin_1"}))["captureIds"] == ["c_other"]
        # ...and the full record is in the bin, with who deleted it and which pin it was on
        items = await recycle_bin.list_items(mock_db, ORG_ID, kind="capture")
        assert len(items) == 1
        item = items[0]
        assert item["docId"] == "c_bin_1" and item["pinIds"] == ["pin_bin_1"]
        assert item["doc"]["roomName"] == "Master Bedroom" and item["doc"]["floorLabel"] == "Floor 4"
        assert item["deletedByName"] and item["deletedBy"] and item["expiresAt"] > item["deletedAt"]

    @pytest.mark.asyncio
    async def test_restore_brings_back_the_record_and_its_pin_link_without_overwriting(self, client, mock_db):
        _, headers = await _manager(mock_db)
        await _capture_on_pin(mock_db)
        await client.delete("/api/v1/captures/c_bin_1", headers=headers)
        entry = (await recycle_bin.list_items(mock_db, ORG_ID))[0]

        assert await recycle_bin.restore(mock_db, entry) == "restored"
        back = await mock_db.captures.find_one({"_id": "c_bin_1"})
        assert back and back["roomName"] == "Master Bedroom" and back["mediaAssets"][0]["processedPanoramaUrl"] == "/media/x/y.jpg"
        assert set((await mock_db.capture_pins.find_one({"_id": "pin_bin_1"}))["captureIds"]) == {"c_bin_1", "c_other"}
        # restoring twice never duplicates or overwrites
        assert await recycle_bin.restore(mock_db, entry) == "already_present"
        assert (await mock_db.capture_pins.find_one({"_id": "pin_bin_1"}))["captureIds"].count("c_bin_1") == 1
        assert await mock_db.captures.count_documents({"_id": "c_bin_1"}) == 1
        # a restored item leaves the "waiting" list but stays in the bin
        assert await recycle_bin.list_items(mock_db, ORG_ID) == []
        assert len(await recycle_bin.list_items(mock_db, ORG_ID, include_restored=True)) == 1

    @pytest.mark.asyncio
    async def test_restore_never_overwrites_a_newer_record(self, mock_db):
        await _capture_on_pin(mock_db)
        entry_id = await recycle_bin.archive(mock_db, kind="capture", doc=await mock_db.captures.find_one({"_id": "c_bin_1"}), org_id=ORG_ID, pin_ids=["pin_bin_1"])
        await mock_db.captures.update_one({"_id": "c_bin_1"}, {"$set": {"roomName": "Edited since"}})
        entry = await mock_db[recycle_bin.COLLECTION].find_one({"_id": ObjectId(entry_id)})
        assert await recycle_bin.restore(mock_db, entry) == "already_present"
        assert (await mock_db.captures.find_one({"_id": "c_bin_1"}))["roomName"] == "Edited since"

    @pytest.mark.asyncio
    async def test_deleting_a_tour_keeps_a_copy_and_can_restore_it(self, client, mock_db):
        _, headers = await _manager(mock_db)
        await mock_db.tours.insert_one({"_id": "tour_bin_1", "id": "tour_bin_1", "orgId": ORG_ID, "steps": [{"captureId": "c1"}, {"captureId": "c2"}], "status": "published"})
        resp = await client.delete("/api/v1/tours/tour_bin_1", headers=headers)
        assert resp.status_code == 200
        assert await mock_db.tours.find_one({"_id": "tour_bin_1"}) is None
        entry = (await recycle_bin.list_items(mock_db, ORG_ID, kind="tour"))[0]
        assert await recycle_bin.restore(mock_db, entry) == "restored"
        assert len((await mock_db.tours.find_one({"_id": "tour_bin_1"}))["steps"]) == 2

    @pytest.mark.asyncio
    async def test_deleting_something_already_gone_still_succeeds_and_adds_nothing(self, client, mock_db):
        _, headers = await _manager(mock_db)
        resp = await client.delete("/api/v1/tours/tour_that_is_gone", headers=headers)
        assert resp.status_code == 200 and "already deleted" in resp.text
        assert await recycle_bin.list_items(mock_db, ORG_ID) == []

    @pytest.mark.asyncio
    async def test_delete_is_refused_if_the_copy_cannot_be_stored(self, client, mock_db, monkeypatch):
        """Safety first: no copy, no delete. The record is still there, and a retry later works."""
        _, headers = await _manager(mock_db)
        await _capture_on_pin(mock_db)

        async def boom(*a, **k):
            raise RuntimeError("bin unavailable")

        monkeypatch.setattr(recycle_bin, "archive", boom)
        try:
            resp = await client.delete("/api/v1/captures/c_bin_1", headers=headers)
            assert resp.status_code >= 500
        except RuntimeError:
            pass  # the test client re-raises server errors
        assert await mock_db.captures.find_one({"_id": "c_bin_1"}) is not None
        assert "c_bin_1" in (await mock_db.capture_pins.find_one({"_id": "pin_bin_1"}))["captureIds"]

    @pytest.mark.asyncio
    async def test_deleting_a_pin_copies_its_captures_first(self, client, mock_db):
        _, headers = await _manager(mock_db)
        await _capture_on_pin(mock_db, cid="c_pin_a", pin_id="pin_del_1")
        resp = await client.delete("/api/v1/pins/pin_del_1", headers=headers)
        assert resp.status_code == 200
        assert await mock_db.captures.find_one({"_id": "c_pin_a"}) is None
        items = await recycle_bin.list_items(mock_db, ORG_ID, kind="capture")
        assert "c_pin_a" in [i["docId"] for i in items]
