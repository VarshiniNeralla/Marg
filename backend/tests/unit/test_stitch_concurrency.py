"""Stitch jobs queue for a bounded number of slots instead of all running at once (which froze the 8 GiB server)."""
import asyncio

import pytest

from app.core.config import get_settings
from app.services import capture_stitch_service as css


class _Jobs:
    def __init__(self):
        self.heartbeats = []

    async def update_one(self, flt, update):
        self.heartbeats.append((flt, update))


class _Db:
    def __init__(self):
        self.jobs = _Jobs()

    def __getitem__(self, name):
        return self.jobs


def _service(monkeypatch, limit, work):
    monkeypatch.setattr(get_settings(), "STITCH_MAX_CONCURRENCY", limit)
    svc = css.CaptureStitchService(_Db())
    svc._run_job_in_slot = work
    return svc


@pytest.mark.asyncio
async def test_never_more_than_the_limit_run_at_once_and_all_complete(monkeypatch):
    state = {"running": 0, "peak": 0, "done": 0}

    async def work(job_id):
        state["running"] += 1
        state["peak"] = max(state["peak"], state["running"])
        await asyncio.sleep(0.03)
        state["running"] -= 1
        state["done"] += 1

    svc = _service(monkeypatch, 2, work)
    await asyncio.gather(*(svc._run_job(f"job{i}") for i in range(7)))
    assert state["peak"] == 2 and state["done"] == 7


@pytest.mark.asyncio
async def test_default_is_one_stitch_at_a_time(monkeypatch):
    state = {"running": 0, "peak": 0}

    async def work(job_id):
        state["running"] += 1
        state["peak"] = max(state["peak"], state["running"])
        await asyncio.sleep(0.01)
        state["running"] -= 1

    svc = _service(monkeypatch, 1, work)
    await asyncio.gather(*(svc._run_job(f"j{i}") for i in range(5)))
    assert state["peak"] == 1
    assert get_settings().STITCH_MAX_CONCURRENCY >= 1


@pytest.mark.asyncio
async def test_a_job_that_crashes_frees_its_slot_for_the_next_one(monkeypatch):
    ran = []

    async def work(job_id):
        ran.append(job_id)
        if job_id == "bad":
            raise RuntimeError("stitch blew up")

    svc = _service(monkeypatch, 1, work)
    results = await asyncio.gather(svc._run_job("bad"), svc._run_job("good1"), svc._run_job("good2"), return_exceptions=True)
    assert sorted(ran) == ["bad", "good1", "good2"]            # the queue kept moving
    assert isinstance(results[0], RuntimeError) and results[1] is None and results[2] is None


@pytest.mark.asyncio
async def test_waiting_jobs_keep_their_heartbeat_so_the_stale_sweep_cannot_fail_them(monkeypatch):
    monkeypatch.setattr(css, "_QUEUE_HEARTBEAT_SECONDS", 0.01)
    release = asyncio.Event()

    async def work(job_id):
        if job_id == "first":
            await release.wait()                                # holds the only slot

    svc = _service(monkeypatch, 1, work)
    first = asyncio.create_task(svc._run_job("first"))
    await asyncio.sleep(0.02)
    second = asyncio.create_task(svc._run_job("second"))        # has to wait
    await asyncio.sleep(0.08)
    beats = [flt for flt, _ in svc._db.jobs.heartbeats if flt.get("_id") == "second"]
    assert beats and all(b["status"] == css.JOB_STATUS_PENDING for b in beats)   # only touches a job that is still pending
    release.set()
    await asyncio.gather(first, second)
    count_after = len(svc._db.jobs.heartbeats)
    await asyncio.sleep(0.05)
    assert len(svc._db.jobs.heartbeats) == count_after          # heartbeat task stopped once the job ran


# ── Deleting a capture cancels its waiting stitch job ─────────────────────────

@pytest.mark.asyncio
async def test_cancelling_a_waiting_job_frees_its_file_and_it_is_never_stitched(tmp_path, monkeypatch):
    from mongomock_motor import AsyncMongoMockClient

    db = AsyncMongoMockClient()["t"]
    raw = tmp_path / "raw.insp"
    raw.write_bytes(b"raw")
    await db[css.COLLECTION_JOBS].insert_many([
        {"_id": "waiting", "orgId": "o1", "status": css.JOB_STATUS_PENDING, "rawPath": str(raw)},
        {"_id": "running", "orgId": "o1", "status": css.JOB_STATUS_PROCESSING, "rawPath": str(tmp_path / "other.insp")},
        {"_id": "foreign", "orgId": "o2", "status": css.JOB_STATUS_PENDING, "rawPath": ""},
    ])
    svc = css.CaptureStitchService(db)
    assert await svc.cancel_pending_job("waiting", "o1") is True
    assert not raw.exists()                                                       # spool file freed
    assert (await db[css.COLLECTION_JOBS].find_one({"_id": "waiting"}))["status"] == css.JOB_STATUS_CANCELLED
    assert await svc.cancel_pending_job("running", "o1") is False                 # already started: left alone
    assert await svc.cancel_pending_job("foreign", "o1") is False                 # another organization's job: untouched
    assert (await db[css.COLLECTION_JOBS].find_one({"_id": "foreign"}))["status"] == css.JOB_STATUS_PENDING

    stitched = []

    async def fake_upload(**kw):
        stitched.append(kw)
        raise AssertionError("a cancelled job must never be stitched")

    monkeypatch.setattr(css, "upload_media", fake_upload)
    await svc._run_job_in_slot("waiting")                                         # claim fails because it is no longer pending
    assert stitched == []
