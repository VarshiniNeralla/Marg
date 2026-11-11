"""GET /construction-progress/analyze/background: who may see which background analyses."""
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from bson import ObjectId

from tests.conftest import (
    ADMIN_USER_ID,
    ORG_ID,
    OTHER_ORG_ID,
    _make_user_doc,
    auth_headers,
    make_access_token,
)

URL = "/api/v1/construction-progress/analyze/background"
MANAGER_ID = str(ObjectId())


def _job(job_id, floor_id, org=ORG_ID, status="processing"):
    now = datetime.now(timezone.utc)
    return {
        "_id": job_id, "orgId": org, "floorId": floor_id, "analyzedBy": ADMIN_USER_ID, "status": status,
        "runInBackground": True, "notifiedAt": None, "floorLabel": f"Label {floor_id}",
        "createdAt": now, "heartbeatAt": now, "completedAt": None,
    }


@pytest_asyncio.fixture
async def world(seeded_db):
    """Two projects, one floor in each, a background job on each floor (plus one in another org)."""
    for pid in ("p1", "p2"):
        await seeded_db.projects.insert_one({"_id": pid, "orgId": ORG_ID, "name": f"Project {pid}"})
        await seeded_db.towers.insert_one({"_id": f"t-{pid}", "orgId": ORG_ID, "projectId": pid, "name": "Tower"})
    await seeded_db.floors.insert_one({"_id": "fA", "orgId": ORG_ID, "towerId": "t-p1", "label": "Floor A"})
    await seeded_db.floors.insert_one({"_id": "fB", "orgId": ORG_ID, "towerId": "t-p2", "label": "Floor B"})
    await seeded_db.construction_progress_analyze_jobs.insert_many([
        _job("job-a", "fA"), _job("job-b", "fB"), _job("job-other-org", "fZ", org=OTHER_ORG_ID),
    ])
    await seeded_db.users.insert_one(
        _make_user_doc(MANAGER_ID, ORG_ID, role="manager", email="manager@test.com", name="Manager")
    )
    # The manager is assigned to project p1 only.
    await seeded_db.user_projects.insert_one({
        "org_id": ObjectId(ORG_ID), "user_id": ObjectId(MANAGER_ID), "project_id": "p1", "is_active": True,
    })
    return seeded_db


@pytest.mark.asyncio
async def test_admin_sees_every_background_analysis_in_their_org_and_none_from_other_orgs(client, world, admin_token):
    resp = await client.get(URL, headers=auth_headers(admin_token))
    assert resp.status_code == 200
    jobs = resp.json()["data"]
    assert sorted(j["jobId"] for j in jobs) == ["job-a", "job-b"]
    assert all(j["runInBackground"] and j["status"] == "processing" for j in jobs)
    assert {j["floorLabel"] for j in jobs} == {"Label fA", "Label fB"}
    assert all(j["startedByName"] == "Admin User" for j in jobs)


@pytest.mark.asyncio
async def test_project_scoped_manager_only_sees_floors_in_their_projects(client, world):
    token = make_access_token(MANAGER_ID, ORG_ID, role="manager")
    resp = await client.get(URL, headers=auth_headers(token))
    assert resp.status_code == 200
    assert [j["jobId"] for j in resp.json()["data"]] == ["job-a"]


@pytest.mark.asyncio
async def test_manager_with_no_project_assignments_sees_nothing(client, world):
    await world.user_projects.delete_many({})
    token = make_access_token(MANAGER_ID, ORG_ID, role="manager")
    resp = await client.get(URL, headers=auth_headers(token))
    assert resp.status_code == 200 and resp.json()["data"] == []


@pytest.mark.asyncio
async def test_regular_users_and_anonymous_callers_are_refused(client, world, user_token):
    assert (await client.get(URL, headers=auth_headers(user_token))).status_code == 403
    assert (await client.get(URL)).status_code in (401, 403)
