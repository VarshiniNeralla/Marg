"""HTTP: activity scope routes and the project-wide analysis routes (roles, project scoping, 409, overview)."""
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from bson import ObjectId

from app.services.construction_progress_project_job_service import ConstructionProgressProjectJobService
from app.services.construction_progress_scope_service import all_core_ids
from tests.conftest import (
    ORG_ID,
    OTHER_ORG_ID,
    _make_user_doc,
    auth_headers,
    make_access_token,
)

BASE = "/api/v1/construction-progress"
MANAGER_ID = str(ObjectId())
SCREED = "flat.floor_screed_1"
PAINT = "flat.paint_40"


@pytest_asyncio.fixture
async def world(seeded_db, monkeypatch):
    # Never spawn the real background task from the endpoint.
    monkeypatch.setattr(ConstructionProgressProjectJobService, "_dispatch", lambda self, job_id: None)
    db = seeded_db
    await db.projects.insert_many([
        {"_id": "p1", "orgId": ORG_ID, "name": "Project One"},
        {"_id": "p2", "orgId": ORG_ID, "name": "Project Two"},
        {"_id": "pz", "orgId": ORG_ID, "name": "Old", "archived": True},
        {"_id": "pf", "orgId": OTHER_ORG_ID, "name": "Foreign"},
    ])
    await db.towers.insert_many([
        {"_id": "tA", "orgId": ORG_ID, "projectId": "p1", "name": "Tower A"},
        {"_id": "tX", "orgId": ORG_ID, "projectId": "p2", "name": "Tower X"},
        {"_id": "tZ", "orgId": ORG_ID, "projectId": "pz", "name": "Tower Z"},
    ])
    await db.floors.insert_many([
        {"_id": "f1", "orgId": ORG_ID, "towerId": "tA", "label": "Floor 1"},
        {"_id": "f2", "orgId": ORG_ID, "towerId": "tA", "label": "Floor 2"},
        {"_id": "fx", "orgId": ORG_ID, "towerId": "tX", "label": "Floor 1"},
    ])
    await db.captures.insert_one({"_id": "c1", "orgId": ORG_ID})
    await db.capture_pins.insert_one({"_id": "pin1", "orgId": ORG_ID, "floorId": "f1", "captureIds": ["c1"]})
    await db.users.insert_one(
        _make_user_doc(MANAGER_ID, ORG_ID, role="manager", email="manager@test.com", name="Manager")
    )
    # The manager is assigned to p1 only.
    await db.user_projects.insert_one({
        "org_id": ObjectId(ORG_ID), "user_id": ObjectId(MANAGER_ID), "project_id": "p1", "is_active": True,
    })
    return db


@pytest.fixture
def manager_token():
    return make_access_token(MANAGER_ID, ORG_ID, role="manager")


# ── scope ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_scope_defaults_to_all_core_with_catalog(client, world, admin_token):
    resp = await client.get(f"{BASE}/floors/f1/scope", headers=auth_headers(admin_token))
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["floorId"] == "f1" and data["isDefault"] is True
    assert data["activityIds"] == all_core_ids()
    assert data["updatedAt"] is None and data["updatedBy"] is None
    assert [c["activityId"] for c in data["catalog"]] == all_core_ids()
    assert set(data["catalog"][0]) == {"activityId", "name", "section", "description", "applicableRooms", "core"}


@pytest.mark.asyncio
async def test_put_scope_saves_and_get_reads_it_back(client, world, admin_token):
    resp = await client.put(
        f"{BASE}/floors/f1/scope",
        json={"activityIds": [PAINT, SCREED]},  # applyTo defaults to "floor"
        headers=auth_headers(admin_token),
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["activityIds"] == [SCREED, PAINT] and data["isDefault"] is False and data["updatedBy"]
    again = await client.get(f"{BASE}/floors/f1/scope", headers=auth_headers(admin_token))
    assert again.json()["data"]["activityIds"] == [SCREED, PAINT]
    other = await client.get(f"{BASE}/floors/f2/scope", headers=auth_headers(admin_token))
    assert other.json()["data"]["isDefault"] is True


@pytest.mark.asyncio
async def test_put_scope_validation_errors_are_400(client, world, admin_token):
    h = auth_headers(admin_token)
    for body in (
        {"activityIds": []},
        {"activityIds": ["flat.putty_1st_coat_25"]},
        {"activityIds": [SCREED], "applyTo": "galaxy"},
    ):
        resp = await client.put(f"{BASE}/floors/f1/scope", json=body, headers=h)
        assert resp.status_code == 400, body
    assert (await client.put(f"{BASE}/floors/f1/scope", json={}, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_put_scope_apply_to_tower_and_project(client, world, admin_token):
    h = auth_headers(admin_token)
    await client.put(f"{BASE}/floors/f1/scope", json={"activityIds": [SCREED], "applyTo": "tower"}, headers=h)
    assert (await client.get(f"{BASE}/floors/f2/scope", headers=h)).json()["data"]["activityIds"] == [SCREED]
    assert (await client.get(f"{BASE}/floors/fx/scope", headers=h)).json()["data"]["isDefault"] is True
    await client.put(f"{BASE}/floors/f1/scope", json={"activityIds": [PAINT], "applyTo": "project"}, headers=h)
    assert (await client.get(f"{BASE}/floors/f2/scope", headers=h)).json()["data"]["activityIds"] == [PAINT]
    assert (await client.get(f"{BASE}/floors/fx/scope", headers=h)).json()["data"]["isDefault"] is True


@pytest.mark.asyncio
async def test_scope_roles_and_project_boundary(client, world, manager_token, user_token):
    ok = await client.put(
        f"{BASE}/floors/f1/scope", json={"activityIds": [SCREED]}, headers=auth_headers(manager_token),
    )
    assert ok.status_code == 200  # an assigned manager may change it
    # a floor of a project the manager is not assigned to
    assert (await client.get(f"{BASE}/floors/fx/scope", headers=auth_headers(manager_token))).status_code == 403
    assert (await client.put(
        f"{BASE}/floors/fx/scope", json={"activityIds": [SCREED]}, headers=auth_headers(manager_token),
    )).status_code == 403
    # plain users (field engineers) and anonymous callers cannot write or read
    assert (await client.put(
        f"{BASE}/floors/f1/scope", json={"activityIds": [SCREED]}, headers=auth_headers(user_token),
    )).status_code == 403
    assert (await client.get(f"{BASE}/floors/f1/scope", headers=auth_headers(user_token))).status_code == 403
    assert (await client.get(f"{BASE}/floors/f1/scope")).status_code in (401, 403)


# ── project analysis ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_project_analysis_returns_202_with_counts(client, world, admin_token):
    resp = await client.post(f"{BASE}/projects/p1/analyze", headers=auth_headers(admin_token))
    assert resp.status_code == 202
    data = resp.json()["data"]
    assert data["jobId"] and data["state"] == "queued"
    assert (data["floorsTotal"], data["floorsQueued"], data["floorsSkippedNoPhotos"]) == (2, 1, 1)
    assert data["projectId"] == "p1"


@pytest.mark.asyncio
async def test_second_start_while_running_is_409_with_the_running_job(client, world, admin_token):
    h = auth_headers(admin_token)
    first = (await client.post(f"{BASE}/projects/p1/analyze", headers=h)).json()["data"]
    resp = await client.post(f"{BASE}/projects/p1/analyze", headers=h)
    assert resp.status_code == 409
    body = resp.json()
    assert body["success"] is False and body["detail"]["job"]["jobId"] == first["jobId"]
    assert await world.construction_progress_project_jobs.count_documents({}) == 1


@pytest.mark.asyncio
async def test_start_refuses_unknown_archived_foreign_and_photoless_projects(client, world, admin_token):
    h = auth_headers(admin_token)
    for pid in ("nope", "pz", "pf"):  # unknown, archived, another organisation's
        assert (await client.post(f"{BASE}/projects/{pid}/analyze", headers=h)).status_code == 404, pid
    assert (await client.post(f"{BASE}/projects/p2/analyze", headers=h)).status_code == 400  # no photos anywhere


@pytest.mark.asyncio
async def test_project_routes_enforce_roles_and_assignment(client, world, manager_token, user_token):
    mh = auth_headers(manager_token)
    # assigned manager: allowed
    assert (await client.post(f"{BASE}/projects/p1/analyze", headers=mh)).status_code == 202
    assert (await client.get(f"{BASE}/projects/p1/overview", headers=mh)).status_code == 200
    # unassigned project: forbidden on every project route
    assert (await client.post(f"{BASE}/projects/p2/analyze", headers=mh)).status_code == 403
    assert (await client.get(f"{BASE}/projects/p2/analyze/status", headers=mh)).status_code == 403
    assert (await client.get(f"{BASE}/projects/p2/analyze/status/x", headers=mh)).status_code == 403
    assert (await client.get(f"{BASE}/projects/p2/overview", headers=mh)).status_code == 403
    # field engineers (plain users) and anonymous callers
    uh = auth_headers(user_token)
    assert (await client.post(f"{BASE}/projects/p1/analyze", headers=uh)).status_code == 403
    assert (await client.get(f"{BASE}/projects/p1/overview", headers=uh)).status_code == 403
    assert (await client.get(f"{BASE}/projects/p1/overview")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_status_endpoints(client, world, admin_token):
    h = auth_headers(admin_token)
    empty = await client.get(f"{BASE}/projects/p1/analyze/status", headers=h)
    assert empty.status_code == 200 and empty.json().get("data") is None
    job = (await client.post(f"{BASE}/projects/p1/analyze", headers=h)).json()["data"]

    latest = (await client.get(f"{BASE}/projects/p1/analyze/status", headers=h)).json()["data"]
    assert latest["jobId"] == job["jobId"] and latest["state"] == "queued"
    for key in ("startedAt", "finishedAt", "floorsTotal", "floorsDone", "floorsFailed", "current", "errors"):
        assert key in latest
    one = await client.get(f"{BASE}/projects/p1/analyze/status/{job['jobId']}", headers=h)
    assert one.status_code == 200 and one.json()["data"]["jobId"] == job["jobId"]
    assert (await client.get(f"{BASE}/projects/p1/analyze/status/missing", headers=h)).status_code == 404


@pytest.mark.asyncio
async def test_overview_endpoint_shape_and_last_run(client, world, admin_token):
    h = auth_headers(admin_token)
    await world.construction_progress_snapshots.insert_one({
        "orgId": ORG_ID, "projectId": "p1", "towerId": "tA", "floorId": "f1",
        "snapshotDate": datetime(2026, 11, 1, tzinfo=timezone.utc), "overallProgressPct": 0.0,
        "flatProgress": [{
            "flatName": "Flat 01", "roomsRequired": 1,
            "rooms": [{"roomName": "Living", "capturesCount": 1, "pinNumbers": [1], "activities": [
                {"activityId": SCREED, "activityName": "Screed", "completionPct": 100.0, "assessmentStatus": "completed"},
            ]}],
        }],
        "activityScope": [SCREED],
    })
    await client.post(f"{BASE}/projects/p1/analyze", headers=h)
    resp = await client.get(f"{BASE}/projects/p1/overview", headers=h)
    assert resp.status_code == 200
    ov = resp.json()["data"]
    assert set(ov) == {"projectId", "projectName", "generatedAt", "lastRun", "totals", "towers", "floors",
                       "activities", "timeline"}
    assert ov["projectName"] == "Project One" and ov["lastRun"]["state"] == "queued"
    t = ov["totals"]
    assert (t["floors"], t["completed"], t["noPhotos"]) == (2, 1, 1)  # scope [screed] only, screed 100 -> floor done
    assert t["progressPct"] == 50.0  # mean of 100 and the photo-less floor's 0
    floors = {f["floorId"]: f for f in ov["floors"]}
    assert floors["f1"]["status"] == "completed" and floors["f1"]["scopeSize"] == 1
    assert floors["f2"]["status"] == "no_photos"
    assert ov["towers"][0]["towerName"] == "Tower A"
    assert [a["activityId"] for a in ov["activities"]] == [SCREED]
    # read-only: nothing new was written by the GET
    assert await world.construction_progress_project_jobs.count_documents({}) == 1


@pytest.mark.asyncio
async def test_overview_404_for_archived_unknown_and_foreign_projects(client, world, admin_token):
    h = auth_headers(admin_token)
    for pid in ("nope", "pz", "pf"):
        assert (await client.get(f"{BASE}/projects/{pid}/overview", headers=h)).status_code == 404, pid
