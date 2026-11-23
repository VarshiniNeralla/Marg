"""Project-wide analysis: job lifecycle with a fake provider, and the read-only overview rollup."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

from app.core.exceptions import AppException, BadRequestException, NotFoundException
from app.services import construction_progress_analyze_job_service as floor_job_mod
from app.services import construction_progress_service as cps
from app.services.construction_progress_project_job_service import (
    COLLECTION_PROJECT_JOBS,
    STATE_COMPLETED,
    STATE_FAILED,
    STATE_PARTIAL,
    STATE_QUEUED,
    STATE_RUNNING,
    ConstructionProgressProjectJobService,
)
from app.services.construction_progress_project_service import ConstructionProgressProjectService
from app.services.construction_progress_scope_service import ConstructionProgressScopeService, all_core_ids

ORG = str(ObjectId())
REQUESTER = "user-requester"
SCREED = "flat.floor_screed_1"
PAINT = "flat.paint_40"


@pytest.fixture
def db():
    return AsyncMongoMockClient()["cp_project_test"]


async def _world(db):
    """Project p1: Tower A (f1 completed, f2 in progress, f3 no photos), Tower B (f4 photos but never analysed,
    f5 analysed with nothing done). Plus another project and an archived one that must never leak in."""
    await db["projects"].insert_many([
        {"_id": "p1", "orgId": ORG, "name": "Project One"},
        {"_id": "p2", "orgId": ORG, "name": "Project Two"},
        {"_id": "pz", "orgId": ORG, "name": "Old", "archived": True},
    ])
    await db["towers"].insert_many([
        {"_id": "tA", "orgId": ORG, "projectId": "p1", "name": "Tower A"},
        {"_id": "tB", "orgId": ORG, "projectId": "p1", "name": "Tower B"},
        {"_id": "tX", "orgId": ORG, "projectId": "p2", "name": "Tower X"},
    ])
    await db["floors"].insert_many([
        {"_id": "f1", "orgId": ORG, "towerId": "tA", "label": "Floor 1"},
        {"_id": "f2", "orgId": ORG, "towerId": "tA", "label": "Floor 2"},
        {"_id": "f3", "orgId": ORG, "towerId": "tA", "label": "Floor 10"},
        {"_id": "f4", "orgId": ORG, "towerId": "tB", "label": "Floor 1"},
        {"_id": "f5", "orgId": ORG, "towerId": "tB", "label": "Floor 2"},
        {"_id": "fx", "orgId": ORG, "towerId": "tX", "label": "Floor 1"},
    ])
    for fid in ("f1", "f2", "f4", "f5", "fx"):
        await db["captures"].insert_one({"_id": f"cap-{fid}", "orgId": ORG})
        await db["capture_pins"].insert_one(
            {"_id": f"pin-{fid}", "orgId": ORG, "floorId": fid, "captureIds": [f"cap-{fid}"]}
        )
    # A pin that points at a deleted capture does not give f3 photos.
    await db["capture_pins"].insert_one({"_id": "pin-f3", "orgId": ORG, "floorId": "f3", "captureIds": ["gone"]})


def _act(aid, pct):
    return {"activityId": aid, "activityName": aid, "completionPct": pct, "confidencePct": 80,
            "assessmentStatus": "completed" if pct >= 100 else ("in_progress" if pct > 0 else "not_started")}


def _snapshot(floor_id, acts, day, scope=None, tower="tA"):
    doc = {
        "orgId": ORG, "projectId": "p1", "towerId": tower, "floorId": floor_id,
        "snapshotDate": day, "overallProgressPct": 99.0,  # stale on purpose: the overview must recalculate
        "summaryCards": {"lastInspection": day},
        "flatProgress": [{
            "flatName": "Flat 01", "roomsRequired": 1,
            "rooms": [{"roomName": "Living", "capturesCount": 1, "pinNumbers": [1], "activities": acts}],
        }],
    }
    if scope is not None:
        doc["activityScope"] = scope
    return doc


async def _snapshots(db):
    all_ids = cps._core_applicable_ids("Flat 01", "Living")
    d1 = datetime(2026, 11, 1, tzinfo=timezone.utc)
    d2 = datetime(2026, 11, 10, tzinfo=timezone.utc)
    await db["construction_progress_snapshots"].insert_many([
        _snapshot("f1", [_act(i, 100.0) for i in all_ids], d1),
        _snapshot("f2", [_act(SCREED, 100.0)], d1),
        _snapshot("f2", [_act(SCREED, 100.0)], d2),  # newest wins
        _snapshot("f5", [_act(SCREED, 0.0)], d2, tower="tB"),
    ])
    return len(all_ids)


# ── overview ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_overview_unknown_other_org_and_archived_projects_are_none(db):
    await _world(db)
    svc = ConstructionProgressProjectService(db)
    assert await svc.get_overview(ORG, "nope") is None
    assert await svc.get_overview(ORG, "pz") is None  # archived
    assert await svc.get_overview("other-org", "p1") is None


@pytest.mark.asyncio
async def test_overview_shape_statuses_and_totals_with_mixed_floors(db):
    await _world(db)
    n_all = await _snapshots(db)
    ov = await ConstructionProgressProjectService(db).get_overview(ORG, "p1")

    assert ov["projectId"] == "p1" and ov["projectName"] == "Project One"
    assert ov["lastRun"] is None and ov["generatedAt"].endswith("Z")
    by_id = {f["floorId"]: f for f in ov["floors"]}
    assert set(by_id) == {"f1", "f2", "f3", "f4", "f5"}  # another project's floor never appears
    assert [f["floorId"] for f in ov["floors"]] == ["f1", "f2", "f3", "f4", "f5"]  # tower, then natural floor order
    assert by_id["f1"]["status"] == "completed" and by_id["f1"]["progressPct"] == 100.0
    assert by_id["f2"]["status"] == "in_progress"
    assert by_id["f2"]["progressPct"] == round(100.0 / n_all, 1)  # recalculated, not the stale stored 99
    assert by_id["f3"]["status"] == "no_photos" and by_id["f3"]["progressPct"] == 0.0
    assert by_id["f4"]["status"] == "not_analysed" and by_id["f4"]["capturesCount"] == 1
    assert by_id["f5"]["status"] == "not_started"

    # Every row carries the documented keys.
    keys = {"floorId", "floorName", "towerId", "towerName", "status", "progressPct", "estimatePct",
            "coveragePct", "flatsTotal", "flatsCompleted", "roomsTotal", "roomsPhotographed",
            "capturesCount", "lastAnalysedAt", "lastInspection", "scopeSize", "needsReview"}
    assert keys <= set(by_id["f1"]) and keys <= set(by_id["f3"])
    assert by_id["f1"]["flatsTotal"] == 1 and by_id["f1"]["flatsCompleted"] == 1
    assert by_id["f1"]["roomsTotal"] == 1 and by_id["f1"]["roomsPhotographed"] == 1
    assert by_id["f1"]["lastAnalysedAt"].startswith("2026-11-01")
    assert by_id["f3"]["lastAnalysedAt"] is None and by_id["f3"]["estimatePct"] is None

    t = ov["totals"]
    assert (t["floors"], t["analysed"]) == (5, 3)
    assert (t["completed"], t["inProgress"], t["notStarted"], t["noPhotos"], t["notAnalysed"]) == (1, 1, 1, 1, 1)
    # Project total = mean of EVERY floor's overall %, floors without a snapshot count as 0.
    expected = round((100.0 + round(100.0 / n_all, 1) + 0 + 0 + 0) / 5, 1)
    assert t["progressPct"] == expected
    assert t["estimatePct"] is not None  # mean over analysed floors only
    assert t["roomsTotal"] == 3 and t["roomsPhotographed"] == 3
    assert t["awaitingEvidence"] <= t["notStarted"]
    assert {"coveragePct", "activitiesAssessed", "needsReview"} <= set(t)

    towers = {x["towerId"]: x for x in ov["towers"]}
    assert towers["tA"]["floors"] == 3 and towers["tA"]["completed"] == 1
    assert towers["tA"]["noPhotos"] == 1 and towers["tA"]["inProgress"] == 1
    assert towers["tB"]["floors"] == 2 and towers["tB"]["notStarted"] == 2
    assert towers["tA"]["progressPct"] == round((100.0 + round(100.0 / n_all, 1)) / 3, 1)
    assert [x["towerName"] for x in ov["towers"]] == ["Tower A", "Tower B"]


@pytest.mark.asyncio
async def test_overview_numbers_equal_the_dashboard_for_each_floor(db):
    await _world(db)
    await _snapshots(db)
    ov = await ConstructionProgressProjectService(db).get_overview(ORG, "p1")
    dashboard = await cps.ConstructionProgressService(db, provider=object()).get_latest_snapshot(ORG, "f2")
    row = next(f for f in ov["floors"] if f["floorId"] == "f2")
    assert row["progressPct"] == dashboard["overallProgressPct"]


@pytest.mark.asyncio
async def test_overview_is_read_only(db):
    await _world(db)
    await _snapshots(db)
    before = await db["construction_progress_snapshots"].find({}).to_list(length=50)
    await ConstructionProgressProjectService(db).get_overview(ORG, "p1")
    after = await db["construction_progress_snapshots"].find({}).to_list(length=50)
    assert before == after
    assert await db["construction_progress_scope"].count_documents({}) == 0
    assert await db[COLLECTION_PROJECT_JOBS].count_documents({}) == 0


@pytest.mark.asyncio
async def test_overview_with_no_snapshots_counts_everything_as_zero_and_reports_it(db):
    await _world(db)
    ov = await ConstructionProgressProjectService(db).get_overview(ORG, "p1")
    t = ov["totals"]
    assert t["progressPct"] == 0.0 and t["analysed"] == 0 and t["estimatePct"] is None
    assert t["notAnalysed"] == 4 and t["noPhotos"] == 1
    assert ov["activities"] == [] and ov["timeline"] == []


@pytest.mark.asyncio
async def test_overview_scope_size_and_scoped_denominators(db):
    await _world(db)
    await db["construction_progress_snapshots"].insert_one(
        _snapshot("f1", [_act(SCREED, 100.0), _act(PAINT, 50.0)], datetime(2026, 11, 1, tzinfo=timezone.utc),
                  scope=[SCREED, PAINT])
    )
    await ConstructionProgressScopeService(db).set_scope(ORG, "f2", [SCREED], updated_by="u")
    ov = await ConstructionProgressProjectService(db).get_overview(ORG, "p1")
    by_id = {f["floorId"]: f for f in ov["floors"]}
    assert by_id["f1"]["scopeSize"] == 2 and by_id["f1"]["progressPct"] == 75.0
    assert by_id["f2"]["scopeSize"] == 1  # no snapshot yet: the floor's saved selection
    assert by_id["f4"]["scopeSize"] == len(all_core_ids())  # default scope


@pytest.mark.asyncio
async def test_overview_activity_rollup_and_timeline(db):
    await _world(db)
    n_all = await _snapshots(db)
    ov = await ConstructionProgressProjectService(db).get_overview(ORG, "p1")
    acts = {a["activityId"]: a for a in ov["activities"]}
    # f1 + f2 + f5 observed screed (100, 100, 0): mean over floors that observed it.
    assert acts[SCREED]["floorsObserved"] == 3 and acts[SCREED]["progressPct"] == round(200 / 3, 1)
    assert acts[SCREED]["name"] == "Screed Works"
    # Paint was observed only on the completed floor.
    assert acts[PAINT]["floorsObserved"] == 1 and acts[PAINT]["progressPct"] == 100.0
    assert acts[PAINT]["coveragePct"] == round(100.0 * 1 / 3, 1)
    assert set(acts[SCREED]) == {"activityId", "name", "progressPct", "coveragePct", "floorsObserved"}

    tl = ov["timeline"]
    assert [p["date"] for p in tl] == ["2026-11-01", "2026-11-10"]
    # Day 1: f1 100 + f2 screed-only; the last point equals the current project total.
    assert tl[-1]["progressPct"] == ov["totals"]["progressPct"]
    # Earlier points use what was stored at analysis time (f1 is presented at its current 100, f2's day-1 value is
    # the stored 99), every other floor counting 0.
    assert tl[0]["progressPct"] == round((100.0 + 99.0) / 5, 1)


# ── project job lifecycle ────────────────────────────────────────────────────

@pytest.fixture
def jobs(db, monkeypatch):
    svc = ConstructionProgressProjectJobService(db)
    monkeypatch.setattr(svc, "_dispatch", lambda job_id: None)  # tests run the job themselves
    return svc


def _fake_analysis(monkeypatch, *, fail_floors=(), calls=None):
    async def analyze_floor(self, org_id, floor_id, as_of=None, analyzed_by=None):
        if calls is not None:
            calls.append(floor_id)
        if floor_id in fail_floors:
            raise RuntimeError(f"vision model unavailable for {floor_id}")
        return {"snapshotId": f"snap-{floor_id}", "projectName": "Project One", "floorName": floor_id,
                "overallProgressPct": 10.0}

    monkeypatch.setattr(floor_job_mod.ConstructionProgressService, "analyze_floor", analyze_floor)


async def _add_user(db, role):
    res = await db["users"].insert_one({"org_id": ObjectId(ORG), "role": role, "is_active": True, "name": role})
    return str(res.inserted_id)


@pytest.mark.asyncio
async def test_start_reports_floors_queued_and_skipped_without_photos(db, jobs):
    await _world(db)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    assert job["state"] == STATE_QUEUED
    assert job["floorsTotal"] == 5 and job["floorsQueued"] == 4 and job["floorsSkippedNoPhotos"] == 1
    assert job["floorsDone"] == 0 and job["floorsFailed"] == 0 and job["current"] is None and job["errors"] == []
    assert job["jobId"] and job["startedAt"] is None and job["finishedAt"] is None


@pytest.mark.asyncio
async def test_start_unknown_archived_and_photoless_projects_are_refused(db, jobs):
    await _world(db)
    with pytest.raises(NotFoundException):
        await jobs.start(org_id=ORG, project_id="nope", analyzed_by=REQUESTER)
    with pytest.raises(NotFoundException):
        await jobs.start(org_id=ORG, project_id="pz", analyzed_by=REQUESTER)
    await db["towers"].insert_one({"_id": "tE", "orgId": ORG, "projectId": "p3", "name": "T"})
    await db["projects"].insert_one({"_id": "p3", "orgId": ORG, "name": "Empty"})
    with pytest.raises(BadRequestException):
        await jobs.start(org_id=ORG, project_id="p3", analyzed_by=REQUESTER)


@pytest.mark.asyncio
async def test_second_start_while_running_is_a_409_carrying_the_running_job(db, jobs):
    await _world(db)
    first = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    with pytest.raises(AppException) as exc:
        await jobs.start(org_id=ORG, project_id="p1", analyzed_by="someone-else")
    assert exc.value.status_code == 409
    assert exc.value.extra_detail["job"]["jobId"] == first["jobId"]
    assert await db[COLLECTION_PROJECT_JOBS].count_documents({}) == 1
    # Another project is unaffected.
    await db["capture_pins"].insert_one({"_id": "pin-x2", "orgId": ORG, "floorId": "fx", "captureIds": ["cap-fx"]})
    other = await jobs.start(org_id=ORG, project_id="p2", analyzed_by=REQUESTER)
    assert other["projectId"] == "p2"


@pytest.mark.asyncio
async def test_lifecycle_completed_runs_each_photographed_floor_in_order_and_notifies_once(db, jobs, monkeypatch):
    await _world(db)
    calls: list[str] = []
    _fake_analysis(monkeypatch, calls=calls)
    admin = await _add_user(db, "admin")
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)

    await jobs.run_job(job["jobId"])
    await jobs.run_job(job["jobId"])  # a second run is a no-op (already claimed / finished)

    assert calls == ["f1", "f2", "f4", "f5"]  # photographed floors only, project order, no f3
    status = await jobs.get_status(org_id=ORG, project_id="p1", job_id=job["jobId"])
    assert status["state"] == STATE_COMPLETED
    assert status["floorsDone"] == 4 and status["floorsFailed"] == 0 and status["errors"] == []
    assert status["current"] is None and status["startedAt"] and status["finishedAt"]
    # Each floor went through the single-floor job machinery (own job record each).
    assert await db["construction_progress_analyze_jobs"].count_documents({"status": "completed"}) == 4

    notes = await db["notifications"].find({}).to_list(length=20)
    assert {n["recipientUserId"] for n in notes} == {REQUESTER, admin}
    assert all(n["type"] == floor_job_mod.NOTIF_COMPLETE and n["link"].endswith("/p1") for n in notes)
    # latest-status read (no job id) returns the finished run, and a new run may start now
    assert (await jobs.get_status(org_id=ORG, project_id="p1"))["jobId"] == job["jobId"]
    again = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    assert again["jobId"] != job["jobId"]


@pytest.mark.asyncio
async def test_progress_is_visible_while_running(db, jobs, monkeypatch):
    await _world(db)
    seen: list[dict] = []

    async def analyze_floor(self, org_id, floor_id, as_of=None, analyzed_by=None):
        seen.append(await jobs.get_status(org_id=ORG, project_id="p1"))
        return {"snapshotId": "s", "overallProgressPct": 1.0}

    monkeypatch.setattr(floor_job_mod.ConstructionProgressService, "analyze_floor", analyze_floor)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    await jobs.run_job(job["jobId"])
    assert [s["state"] for s in seen] == [STATE_RUNNING] * 4
    assert [s["current"]["floorId"] for s in seen] == ["f1", "f2", "f4", "f5"]
    assert seen[0]["current"]["floorName"] == "Floor 1"
    assert [s["floorsDone"] for s in seen] == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_one_failing_floor_makes_the_run_partial_and_the_rest_still_run(db, jobs, monkeypatch):
    await _world(db)
    calls: list[str] = []
    _fake_analysis(monkeypatch, fail_floors={"f2"}, calls=calls)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    await jobs.run_job(job["jobId"])
    status = await jobs.get_status(org_id=ORG, project_id="p1", job_id=job["jobId"])
    assert calls == ["f1", "f2", "f4", "f5"]
    assert status["state"] == STATE_PARTIAL
    assert (status["floorsDone"], status["floorsFailed"]) == (3, 1)
    assert [e["floorId"] for e in status["errors"]] == ["f2"]
    assert "vision model unavailable" in status["errors"][0]["message"]
    note = await db["notifications"].find_one({})
    assert note["type"] == floor_job_mod.NOTIF_COMPLETE and "1 failed" in note["body"]


@pytest.mark.asyncio
async def test_every_floor_failing_marks_the_run_failed(db, jobs, monkeypatch):
    await _world(db)
    _fake_analysis(monkeypatch, fail_floors={"f1", "f2", "f4", "f5"})
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    await jobs.run_job(job["jobId"])
    status = await jobs.get_status(org_id=ORG, project_id="p1", job_id=job["jobId"])
    assert status["state"] == STATE_FAILED and status["floorsFailed"] == 4 and status["floorsDone"] == 0
    assert (await db["notifications"].find_one({}))["type"] == floor_job_mod.NOTIF_FAILED


@pytest.mark.asyncio
async def test_status_for_an_unknown_job_or_a_never_analysed_project_is_none(db, jobs):
    await _world(db)
    assert await jobs.get_status(org_id=ORG, project_id="p1") is None
    assert await jobs.get_status(org_id=ORG, project_id="p1", job_id="nope") is None
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    # a job id never leaks across projects or organisations
    assert await jobs.get_status(org_id=ORG, project_id="p2", job_id=job["jobId"]) is None
    assert await jobs.get_status(org_id="other", project_id="p1", job_id=job["jobId"]) is None


@pytest.mark.asyncio
async def test_restart_resumes_and_skips_floors_that_were_already_done(db, jobs, monkeypatch):
    await _world(db)
    calls: list[str] = []
    _fake_analysis(monkeypatch, calls=calls)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    await db[COLLECTION_PROJECT_JOBS].update_one(
        {"_id": job["jobId"]},
        {"$set": {"state": STATE_RUNNING, "doneFloorIds": ["f1", "f2"], "floorsDone": 2}},
    )
    await jobs.recover_orphaned_jobs()  # re-queues (dispatch is stubbed out in this fixture)
    assert (await jobs.get_status(org_id=ORG, project_id="p1"))["state"] == STATE_QUEUED
    await jobs.run_job(job["jobId"])
    assert calls == ["f4", "f5"]
    status = await jobs.get_status(org_id=ORG, project_id="p1", job_id=job["jobId"])
    assert status["state"] == STATE_COMPLETED and status["floorsDone"] == 4


@pytest.mark.asyncio
async def test_a_stalled_job_is_failed_and_frees_the_project(db, jobs, monkeypatch):
    await _world(db)
    _fake_analysis(monkeypatch)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    await db[COLLECTION_PROJECT_JOBS].update_one(
        {"_id": job["jobId"]},
        {"$set": {"state": STATE_RUNNING, "heartbeatAt": datetime.now(timezone.utc) - timedelta(hours=2)}},
    )
    status = await jobs.get_status(org_id=ORG, project_id="p1")
    assert status["state"] == STATE_FAILED and "timed out" in status["errors"][0]["message"]
    again = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)  # not a 409
    assert again["state"] == STATE_QUEUED
