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


def _job(job_id, *, org=ORG, floor="f1", status="processing", background=True, by=None, completed_ago=None, created_ago=0):
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    return {
        "_id": job_id, "orgId": org, "floorId": floor, "analyzedBy": by, "status": status,
        "runInBackground": background, "notifiedAt": None, "floorLabel": f"Label {job_id}",
        "createdAt": now - timedelta(minutes=created_ago), "heartbeatAt": now,
        "completedAt": (now - timedelta(minutes=completed_ago)) if completed_ago is not None else None,
    }


@pytest.mark.asyncio
async def test_listing_shows_running_and_recently_finished_background_jobs_only(db, service):
    admin = await _add_user(db, "admin")
    await db[COLLECTION_JOBS].insert_many([
        _job("running", status="processing", by=admin, created_ago=1),
        _job("queued", status="pending", created_ago=2),
        _job("just-done", status="completed", completed_ago=10, created_ago=15),
        _job("old-done", status="completed", completed_ago=60 * 5, created_ago=60 * 5 + 3),   # 5h ago: hidden
        _job("foreground", background=False, status="processing"),                            # not a background run
        _job("other-org", org=OTHER_ORG, status="processing"),                                # other organisation
    ])
    jobs = await service.list_background_jobs(org_id=ORG)
    assert [j["jobId"] for j in jobs] == ["running", "queued", "just-done"]  # newest first
    running = jobs[0]
    assert running["status"] == "processing" and running["runInBackground"] is True
    assert running["floorLabel"] == "Label running"
    assert running["startedByName"] == "admin"          # looked up from the users collection
    assert jobs[1]["startedByName"] is None             # unknown requester is not an error


@pytest.mark.asyncio
async def test_listing_marks_a_dead_background_job_failed_instead_of_running_forever(db, service):
    from datetime import datetime, timedelta, timezone

    doc = _job("zombie", status="processing", created_ago=120)
    doc["heartbeatAt"] = datetime.now(timezone.utc) - timedelta(hours=2)
    await db[COLLECTION_JOBS].insert_one(doc)
    jobs = await service.list_background_jobs(org_id=ORG)
    assert [(j["jobId"], j["status"]) for j in jobs] == [("zombie", "failed")]


@pytest.mark.asyncio
async def test_floor_label_is_resolved_when_the_job_is_queued(db, service):
    await db["projects"].insert_one({"_id": "p1", "orgId": ORG, "name": "Tower Heights"})
    await db["towers"].insert_one({"_id": "t1", "orgId": ORG, "projectId": "p1", "name": "Tower A"})
    await db["floors"].insert_one({"_id": FLOOR, "orgId": ORG, "towerId": "t1", "label": "Floor 7"})
    job = await service.start_analyze(org_id=ORG, floor_id=FLOOR, analyzed_by=REQUESTER, background=True)
    assert job["floorLabel"] == "Tower Heights · Tower A · Floor 7"
    stored = await db[COLLECTION_JOBS].find_one({"_id": job["jobId"]})
    assert stored["floorLabel"] == "Tower Heights · Tower A · Floor 7"


@pytest.mark.asyncio
async def test_unknown_floor_still_queues_with_no_label(db, service):
    job = await service.start_analyze(org_id=ORG, floor_id="no-such-floor", analyzed_by=REQUESTER, background=True)
    assert job["floorLabel"] is None and job["status"] == "pending"


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
