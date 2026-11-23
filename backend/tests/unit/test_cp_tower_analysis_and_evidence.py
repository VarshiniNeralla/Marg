"""Tower-only analysis run, floor location in the scope view, and the evidence cap."""
from __future__ import annotations

import pytest
from mongomock_motor import AsyncMongoMockClient

from app.core.exceptions import BadRequestException
from app.services import construction_progress_analyze_job_service as floor_job_mod
from app.services.construction_progress_project_job_service import (
    COLLECTION_PROJECT_JOBS,
    ConstructionProgressProjectJobService,
)
from app.services.construction_progress_providers.evidence_selection import (
    MAX_EVIDENCE,
    Observation,
    resolve_observations,
)
from app.services.construction_progress_scope_service import ConstructionProgressScopeService
from tests.unit.test_cp_project_analysis import ORG, REQUESTER, _fake_analysis, _world


@pytest.fixture
def db():
    return AsyncMongoMockClient()["cp_tower_test"]


@pytest.fixture
def jobs(db, monkeypatch):
    svc = ConstructionProgressProjectJobService(db)
    monkeypatch.setattr(svc, "_dispatch", lambda job_id: None)
    return svc


@pytest.mark.asyncio
async def test_tower_run_covers_only_that_towers_floors(db, jobs, monkeypatch):
    await _world(db)  # Tower A: f1, f2 have photos, f3 none. Tower B: f4, f5 have photos.
    calls: list[str] = []
    _fake_analysis(monkeypatch, calls=calls)

    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER, tower_id="tA")
    assert job["towerId"] == "tA" and job["towerName"] == "Tower A"
    assert job["floorsTotal"] == 3 and job["floorsQueued"] == 2 and job["floorsSkippedNoPhotos"] == 1

    await jobs.run_job(job["jobId"])
    assert calls == ["f1", "f2"]  # nothing from Tower B
    status = await jobs.get_status(org_id=ORG, project_id="p1", job_id=job["jobId"])
    assert status["state"] == "completed" and status["floorsDone"] == 2


@pytest.mark.asyncio
async def test_whole_project_run_is_unchanged_and_has_no_tower(db, jobs):
    await _world(db)
    job = await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    assert job["towerId"] == "" and job["floorsQueued"] == 4


@pytest.mark.asyncio
async def test_a_tower_of_another_project_is_refused(db, jobs):
    await _world(db)
    with pytest.raises(BadRequestException):
        await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER, tower_id="tX")
    with pytest.raises(BadRequestException):
        await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER, tower_id="does-not-exist")
    assert await db[COLLECTION_PROJECT_JOBS].count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_tower_with_no_photographed_floor_is_refused(db, jobs):
    await _world(db)
    await db["towers"].insert_one({"_id": "tC", "orgId": ORG, "projectId": "p1", "name": "Tower C"})
    await db["floors"].insert_one({"_id": "fc", "orgId": ORG, "towerId": "tC", "label": "Floor 1"})
    with pytest.raises(BadRequestException):
        await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER, tower_id="tC")


@pytest.mark.asyncio
async def test_a_running_tower_job_blocks_a_second_job_for_the_project(db, jobs):
    from app.core.exceptions import AppException

    await _world(db)
    await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER, tower_id="tA")
    with pytest.raises(AppException) as exc:
        await jobs.start(org_id=ORG, project_id="p1", analyzed_by=REQUESTER)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_scope_view_carries_the_floors_tower_and_project(db):
    await _world(db)
    view = await ConstructionProgressScopeService(db).get_scope_view(ORG, "f4")
    assert view["towerId"] == "tB" and view["projectId"] == "p1"
    unknown = await ConstructionProgressScopeService(db).get_scope_view(ORG, "nope")
    assert unknown["towerId"] == "" and unknown["projectId"] == ""
    assert unknown["activityIds"]  # still the default list


def test_evidence_keeps_every_supporting_capture_up_to_the_cap():
    obs = [Observation(capture_id=f"c{i}", pct=60.0, conf=80.0, evidence="x") for i in range(8)]
    r = resolve_observations(obs)
    assert len(r["evidence_ids"]) == 8  # used to stop at 3
    many = [Observation(capture_id=f"m{i}", pct=60.0, conf=80.0, evidence="x") for i in range(MAX_EVIDENCE + 5)]
    assert len(resolve_observations(many)["evidence_ids"]) == MAX_EVIDENCE
    assert MAX_EVIDENCE > 3


def test_floor_job_module_is_importable_for_the_fake_analysis_helper():
    assert hasattr(floor_job_mod, "ConstructionProgressService")
