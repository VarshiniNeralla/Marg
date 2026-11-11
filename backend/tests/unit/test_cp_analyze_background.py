"""Floor progress analysis: "Run in background" notifications and restart recovery."""
import asyncio

import pytest
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from app.services import construction_progress_analyze_job_service as svc_mod
from app.services.construction_progress_analyze_job_service import (
    COLLECTION_JOBS,
    COLLECTION_NOTIFICATIONS,
    NOTIF_COMPLETE,
    NOTIF_FAILED,
    ConstructionProgressAnalyzeJobService,
)

ORG = str(ObjectId())
OTHER_ORG = str(ObjectId())
FLOOR = "floor-7"
REQUESTER = "user-requester"


@pytest.fixture
def db():
    return AsyncMongoMockClient()["cp_background_test"]


@pytest.fixture
def service(db, monkeypatch):
    svc = ConstructionProgressAnalyzeJobService(db)
    # Never run the real analysis or spawn tasks from start_analyze.
    monkeypatch.setattr(svc, "_dispatch", lambda job_id: None)
    return svc


async def _add_user(db, role, org=ORG, active=True):
    res = await db["users"].insert_one(
        {"org_id": ObjectId(org), "role": role, "is_active": active, "name": role}
    )
    return str(res.inserted_id)


def _fake_analysis(monkeypatch, *, fail=False):
    async def analyze_floor(self, org_id, floor_id, as_of=None, analyzed_by=None):
        if fail:
            raise RuntimeError("vision model unavailable")
        return {
            "snapshotId": "snap-1", "projectName": "Tower Heights", "towerName": "Tower A",
            "floorName": "Floor 7", "overallProgressPct": 42.4,
        }

    monkeypatch.setattr(svc_mod.ConstructionProgressService, "analyze_floor", analyze_floor)


async def _notifications(db):
    return await db[COLLECTION_NOTIFICATIONS].find({}).to_list(length=50)


@pytest.mark.asyncio
async def test_background_completion_notifies_requester_and_admins_once(db, service, monkeypatch):
    _fake_analysis(monkeypatch)
    admin = await _add_user(db, "admin")
    super_admin = await _add_user(db, "super_admin")
    await _add_user(db, "manager")               # other managers are not told
    await _add_user(db, "admin", active=False)    # inactive admins are not told
    await _add_user(db, "admin", org=OTHER_ORG)   # other organisations are never told

    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER, background=True)
    assert job["runInBackground"] is True
    await service._run_job(job["jobId"])
    await service._run_job(job["jobId"])  # a second run must not notify again

    notes = await _notifications(db)
    assert {n["recipientUserId"] for n in notes} == {REQUESTER, admin, super_admin}
    for n in notes:
        assert n["type"] == NOTIF_COMPLETE
        assert n["read"] is False
        assert n["orgId"] == ORG
        assert n["link"] == f"/construction-progress/{FLOOR}"
        assert "Tower Heights" in n["body"] and "Floor 7" in n["body"] and "42%" in n["body"]
        # Every owner alias the notification endpoints filter on is present.
        assert n["recipientUserId"] == n["recipient_user_id"] == n["userId"] == n["user_id"]


@pytest.mark.asyncio
async def test_requester_who_is_also_admin_gets_one_notification(db, service, monkeypatch):
    _fake_analysis(monkeypatch)
    admin = await _add_user(db, "admin")
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=admin, background=True)
    await service._run_job(job["jobId"])
    notes = await _notifications(db)
    assert [n["recipientUserId"] for n in notes] == [admin]


@pytest.mark.asyncio
async def test_foreground_runs_do_not_notify(db, service, monkeypatch):
    _fake_analysis(monkeypatch)
    await _add_user(db, "admin")
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER)
    assert job["runInBackground"] is False
    await service._run_job(job["jobId"])
    assert await _notifications(db) == []


@pytest.mark.asyncio
async def test_failure_sends_a_failed_notification(db, service, monkeypatch):
    _fake_analysis(monkeypatch, fail=True)
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER, background=True)
    await service._run_job(job["jobId"])
    stored = await db[COLLECTION_JOBS].find_one({"_id": job["jobId"]})
    assert stored["status"] == "failed"
    notes = await _notifications(db)
    assert [n["type"] for n in notes] == [NOTIF_FAILED]
    assert "could not be completed" in notes[0]["body"]


@pytest.mark.asyncio
async def test_continue_in_background_after_start_still_notifies(db, service, monkeypatch):
    _fake_analysis(monkeypatch)
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER)  # foreground
    marked = await service.mark_background(org_id=ORG, floor_id=FLOOR, job_id=job["jobId"])
    assert marked["runInBackground"] is True
    await service._run_job(job["jobId"])
    assert len(await _notifications(db)) == 1


@pytest.mark.asyncio
async def test_continue_in_background_after_it_already_finished_notifies_immediately(db, service, monkeypatch):
    _fake_analysis(monkeypatch)
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER)
    await service._run_job(job["jobId"])
    assert await _notifications(db) == []
    await service.mark_background(org_id=ORG, floor_id=FLOOR, job_id=job["jobId"])
    notes = await _notifications(db)
    assert len(notes) == 1 and notes[0]["type"] == NOTIF_COMPLETE


@pytest.mark.asyncio
async def test_mark_background_is_scoped_to_org_and_floor(db, service):
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER)
    assert await service.mark_background(org_id=OTHER_ORG, floor_id=FLOOR, job_id=job["jobId"]) is None
    assert await service.mark_background(org_id=ORG, floor_id="another-floor", job_id=job["jobId"]) is None
    stored = await db[COLLECTION_JOBS].find_one({"_id": job["jobId"]})
    assert stored["runInBackground"] is False


@pytest.mark.asyncio
async def test_joining_a_running_job_in_background_mode_upgrades_it(db, service):
    first = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER)
    second = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by="someone-else", background=True)
    assert second["jobId"] == first["jobId"] and second["runInBackground"] is True
    stored = await db[COLLECTION_JOBS].find_one({"_id": first["jobId"]})
    assert stored["runInBackground"] is True


@pytest.mark.asyncio
async def test_orphaned_jobs_are_re_dispatched_after_a_restart(db, monkeypatch):
    svc = ConstructionProgressAnalyzeJobService(db)
    dispatched = []
    monkeypatch.setattr(svc, "_dispatch", lambda job_id: dispatched.append(job_id))
    await db[COLLECTION_JOBS].insert_many([
        {"_id": "was-running", "orgId": ORG, "floorId": "f1", "status": "processing"},
        {"_id": "was-queued", "orgId": ORG, "floorId": "f2", "status": "pending"},
        {"_id": "finished", "orgId": ORG, "floorId": "f3", "status": "completed"},
    ])
    await svc.recover_orphaned_jobs()
    assert sorted(dispatched) == ["was-queued", "was-running"]
    assert (await db[COLLECTION_JOBS].find_one({"_id": "was-running"}))["status"] == "pending"
    assert (await db[COLLECTION_JOBS].find_one({"_id": "finished"}))["status"] == "completed"


@pytest.mark.asyncio
async def test_a_notification_failure_never_fails_the_analysis(db, service, monkeypatch):
    _fake_analysis(monkeypatch)

    async def boom(*a, **k):
        raise RuntimeError("mongo is down")

    monkeypatch.setattr(service, "_recipient_ids", boom)
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER, background=True)
    await service._run_job(job["jobId"])
    assert (await db[COLLECTION_JOBS].find_one({"_id": job["jobId"]}))["status"] == "completed"


@pytest.mark.asyncio
async def test_stale_background_job_notifies_its_requester(db, service):
    from datetime import datetime, timedelta, timezone

    old = datetime.now(timezone.utc) - timedelta(hours=2)
    await db[COLLECTION_JOBS].insert_one({
        "_id": "stale", "orgId": ORG, "floorId": FLOOR, "analyzedBy": REQUESTER, "status": "processing",
        "heartbeatAt": old, "runInBackground": True, "notifiedAt": None,
    })
    await service._fail_stale_jobs(org_id=ORG, floor_id=FLOOR)
    notes = await _notifications(db)
    assert [n["type"] for n in notes] == [NOTIF_FAILED]
