"""Uploading a floor plan must not wait for the minutes-long room scan, and concurrent scans must share one run."""
import asyncio
import time

import pytest

from app.services import room_map_service as rms


@pytest.fixture(autouse=True)
def _clean_registries():
    rms._ROOM_MAP_INFLIGHT.clear()
    rms._BACKGROUND_SCANS.clear()
    yield
    rms._ROOM_MAP_INFLIGHT.clear()
    rms._BACKGROUND_SCANS.clear()


def _patch_impl(monkeypatch, delay=0.2, result=None):
    calls = []

    async def fake_impl(self, *, floor_plan_id, org_id, image_url, force=False):
        calls.append((org_id, floor_plan_id, force))
        await asyncio.sleep(delay)
        return result if result is not None else {"_id": floor_plan_id, "flats": []}

    monkeypatch.setattr(rms.RoomMapService, "_ensure_room_map_impl", fake_impl)
    return calls


@pytest.mark.asyncio
async def test_scheduling_returns_immediately_and_the_scan_still_completes(monkeypatch):
    calls = _patch_impl(monkeypatch, delay=0.3)
    t0 = time.perf_counter()
    task = rms.schedule_room_map_extraction(object(), floor_plan_id="fp1", org_id="o1", image_url="/media/x.pdf")
    assert time.perf_counter() - t0 < 0.05            # the upload request is not held for the scan
    assert not task.done()
    assert await task == {"_id": "fp1", "flats": []}
    assert calls == [("o1", "fp1", False)]
    await asyncio.sleep(0)
    assert not rms._BACKGROUND_SCANS and not rms._ROOM_MAP_INFLIGHT   # cleaned up afterwards


@pytest.mark.asyncio
async def test_a_second_caller_joins_the_running_scan_instead_of_starting_another(monkeypatch):
    calls = _patch_impl(monkeypatch, delay=0.2)
    svc = rms.RoomMapService(object())
    a = asyncio.ensure_future(svc.ensure_room_map(floor_plan_id="fp1", org_id="o1", image_url="u"))
    await asyncio.sleep(0.02)
    b = await svc.ensure_room_map(floor_plan_id="fp1", org_id="o1", image_url="u")      # e.g. a floor analysis
    assert b == await a
    assert len(calls) == 1                                                              # one expensive scan, not two


@pytest.mark.asyncio
async def test_different_plans_and_different_orgs_scan_independently(monkeypatch):
    calls = _patch_impl(monkeypatch, delay=0.1)
    svc = rms.RoomMapService(object())
    await asyncio.gather(
        svc.ensure_room_map(floor_plan_id="fp1", org_id="o1", image_url="u"),
        svc.ensure_room_map(floor_plan_id="fp2", org_id="o1", image_url="u"),
        svc.ensure_room_map(floor_plan_id="fp1", org_id="o2", image_url="u"),
    )
    assert len(calls) == 3


@pytest.mark.asyncio
async def test_a_caller_that_goes_away_does_not_cancel_the_scan(monkeypatch):
    calls = _patch_impl(monkeypatch, delay=0.2)
    svc = rms.RoomMapService(object())
    waiter = asyncio.ensure_future(svc.ensure_room_map(floor_plan_id="fp1", org_id="o1", image_url="u"))
    await asyncio.sleep(0.02)
    inner = rms._ROOM_MAP_INFLIGHT[("o1", "fp1")]
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert not inner.cancelled()
    assert (await inner)["_id"] == "fp1"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_a_failed_scan_is_logged_not_raised(monkeypatch):
    async def boom(self, **kw):
        raise RuntimeError("model down")

    monkeypatch.setattr(rms.RoomMapService, "_ensure_room_map_impl", boom)
    task = rms.schedule_room_map_extraction(object(), floor_plan_id="fp1", org_id="o1", image_url="u")
    with pytest.raises(RuntimeError):
        await task
    await asyncio.sleep(0)
    assert not rms._BACKGROUND_SCANS and not rms._ROOM_MAP_INFLIGHT
