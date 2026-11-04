"""A generic PUT must never let the client re-assign a record to another organization."""
import pytest

from app.api.v1.endpoints import workflow


class _Coll:
    def __init__(self):
        self.update = None

    async def find_one_and_update(self, flt, update, return_document=None):
        self.filter, self.update = flt, update
        return {"_id": flt["_id"], "orgId": flt["orgId"], **update["$set"]}


class _Db(dict):
    def __missing__(self, key):
        self[key] = _Coll()
        return self[key]


class _Ctx:
    org_id = "org-mine"


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["orgId", "org_id", "_id"])
async def test_patch_ignores_client_supplied_ownership_fields(key):
    db = _Db()
    await workflow._patch(db, "projects", "p1", {"name": "Renamed", key: "org-OTHER"}, _Ctx())
    coll = db["projects"]
    assert coll.filter["orgId"] == "org-mine"          # still scoped to the caller's org
    assert key not in coll.update["$set"]              # the ownership field was dropped
    assert coll.update["$set"]["name"] == "Renamed"    # ordinary fields still apply
