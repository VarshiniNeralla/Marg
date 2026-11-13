"""A capture may only point at a project/tower of the caller's own organization.

Regression: a stale offline write queue from one company replayed under another company's login created that
company's captures (109 of them) inside the other company's database, pointing at a project that does not exist
there. The server now refuses such writes, whatever the client sends.
"""
import pytest

from tests.conftest import ADMIN_USER_ID, ORG_ID, auth_headers, make_access_token


async def _post(client, token, body):
    return await client.post("/api/v1/captures", headers=auth_headers(token), json=body)


@pytest.mark.asyncio
async def test_capture_for_a_project_that_does_not_exist_here_is_refused_and_not_stored(client, mock_db):
    token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
    resp = await _post(client, token, {"id": "c_foreign", "projectId": "p_from_another_company", "mediaAssets": []})
    assert resp.status_code == 422
    assert "does not exist in your organization" in resp.text
    assert await mock_db.captures.find_one({"$or": [{"_id": "c_foreign"}, {"id": "c_foreign"}]}) is None


@pytest.mark.asyncio
async def test_capture_for_a_tower_that_does_not_exist_here_is_refused(client, mock_db):
    await mock_db.projects.insert_one({"_id": "p_own", "id": "p_own", "orgId": ORG_ID, "name": "Own"})
    token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
    resp = await _post(client, token, {"id": "c_t", "projectId": "p_own", "towerId": "t_foreign", "mediaAssets": []})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_a_project_of_another_organization_does_not_count(client, mock_db):
    await mock_db.projects.insert_one({"_id": "p_other", "id": "p_other", "orgId": "some-other-org", "name": "Theirs"})
    token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
    resp = await _post(client, token, {"id": "c_x", "projectId": "p_other", "mediaAssets": []})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_capture_for_own_project_and_tower_is_saved(client, mock_db):
    await mock_db.projects.insert_one({"_id": "p_own", "id": "p_own", "orgId": ORG_ID, "name": "Own"})
    await mock_db.towers.insert_one({"_id": "t_own", "id": "t_own", "orgId": ORG_ID, "projectId": "p_own", "name": "T1"})
    token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
    resp = await _post(client, token, {"id": "c_ok", "projectId": "p_own", "towerId": "t_own", "mediaAssets": []})
    assert resp.status_code == 201
    assert await mock_db.captures.find_one({"_id": "c_ok"}) is not None


@pytest.mark.asyncio
async def test_capture_without_any_project_reference_still_works(client):
    token = make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")
    resp = await _post(client, token, {"id": "c_plain", "roomId": "r1", "mediaAssets": []})
    assert resp.status_code != 422
