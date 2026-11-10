"""POST /floor-plans saves the plan and returns at once; the minutes-long room scan runs in the background."""
import asyncio
import time

import pytest

from app.services import room_map_service as rms
from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_saving_a_floor_plan_does_not_wait_for_the_room_scan(client, admin_token, monkeypatch):
    scans: list[tuple] = []

    async def slow_scan(self, *, floor_plan_id, org_id, image_url, force=False):
        scans.append((org_id, floor_plan_id))
        await asyncio.sleep(3.0)           # stands in for 1.5-3.5 minutes of vision calls
        return {"_id": floor_plan_id, "flats": []}

    monkeypatch.setattr(rms.RoomMapService, "_ensure_room_map_impl", slow_scan)

    payload = {
        "id": "fp-speed-1", "projectId": "p1", "towerId": "t1", "floorId": "f1", "floorLabel": "Floor 1",
        "mediaAssets": [{"original_url": "/media/x/plan.png", "format": "pdf", "pages": 1}],
    }
    started = time.perf_counter()
    resp = await client.post("/api/v1/floor-plans", json=payload, headers=auth_headers(admin_token))
    elapsed = time.perf_counter() - started

    assert resp.status_code == 201, resp.text
    assert elapsed < 1.5, f"save took {elapsed:.1f}s - it is waiting for the room scan again"
    assert resp.json()["data"]["id"] == "fp-speed-1"

    await asyncio.sleep(0.1)
    assert scans, "the room scan was not started in the background"
    for task in list(rms._BACKGROUND_SCANS):
        task.cancel()
