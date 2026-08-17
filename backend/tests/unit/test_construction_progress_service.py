"""Unit tests for ConstructionProgressService.purge_snapshots_citing_capture —
the fix for stale progress snapshots that keep citing evidence from captures
deleted elsewhere (pin delete, room delete, cleanup). Uses the same
in-memory fake Motor-like db style as test_drishti_context_service.py."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services.construction_progress_service import ConstructionProgressService


class _FakeFindCursor:
    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _DeleteResult:
    def __init__(self, deleted_count: int) -> None:
        self.deleted_count = deleted_count


class _FakeSnapshotCollection:
    """Matches only what purge_snapshots_citing_capture actually calls:
    find({...}, {"_id": 1}) to locate stale docs, then delete_many by id."""

    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs
        self.last_delete_filter: dict | None = None

    def find(self, query, projection=None):
        org_id = query["orgId"]
        cid = query["flatProgress.rooms.activities.evidenceCaptureIds"]

        def _cites(doc: dict) -> bool:
            if doc.get("orgId") != org_id:
                return False
            for flat in doc.get("flatProgress", []):
                for room in flat.get("rooms", []):
                    for act in room.get("activities", []):
                        if cid in (act.get("evidenceCaptureIds") or []):
                            return True
            return False

        matched = [{"_id": d["_id"]} for d in self._docs if _cites(d)]
        return _FakeFindCursor(matched)

    async def delete_many(self, query):
        self.last_delete_filter = query
        ids = set(query["_id"]["$in"])
        before = len(self._docs)
        self._docs = [d for d in self._docs if d["_id"] not in ids]
        return _DeleteResult(before - len(self._docs))


def _snapshot(snap_id, org_id, floor_id, evidence_ids):
    return {
        "_id": snap_id,
        "orgId": org_id,
        "floorId": floor_id,
        "overallProgressPct": 4.1,
        "flatProgress": [{
            "flatName": "Flat 01",
            "rooms": [{
                "roomName": "Bedroom-1",
                "activities": [{"activityName": "Painting", "evidenceCaptureIds": evidence_ids}],
            }],
        }],
    }


@pytest.fixture
def db_with_snapshots():
    def _make(docs: list[dict]):
        coll = _FakeSnapshotCollection(docs)
        db = MagicMock()
        db.__getitem__.side_effect = lambda name: coll
        return db, coll
    return _make


class TestPurgeSnapshotsCitingCapture:
    @pytest.mark.asyncio
    async def test_purges_snapshot_citing_the_deleted_capture(self, db_with_snapshots):
        docs = [_snapshot("snap1", "org1", "floorA", ["c100"])]
        db, coll = db_with_snapshots(docs)
        service = ConstructionProgressService(db, provider=MagicMock())

        removed = await service.purge_snapshots_citing_capture("org1", "c100")

        assert removed == 1
        assert coll._docs == []

    @pytest.mark.asyncio
    async def test_leaves_snapshots_citing_other_captures_untouched(self, db_with_snapshots):
        docs = [_snapshot("snap1", "org1", "floorA", ["c999"])]
        db, coll = db_with_snapshots(docs)
        service = ConstructionProgressService(db, provider=MagicMock())

        removed = await service.purge_snapshots_citing_capture("org1", "c100")

        assert removed == 0
        assert len(coll._docs) == 1

    @pytest.mark.asyncio
    async def test_scoped_to_org_even_if_capture_id_matches_another_org(self, db_with_snapshots):
        # Regression guard: a snapshot in a DIFFERENT org citing the same
        # capture id string must never be purged by this org's delete.
        docs = [_snapshot("snap1", "org2", "floorA", ["c100"])]
        db, coll = db_with_snapshots(docs)
        service = ConstructionProgressService(db, provider=MagicMock())

        removed = await service.purge_snapshots_citing_capture("org1", "c100")

        assert removed == 0
        assert len(coll._docs) == 1

    @pytest.mark.asyncio
    async def test_empty_capture_id_is_a_noop(self, db_with_snapshots):
        docs = [_snapshot("snap1", "org1", "floorA", ["c100"])]
        db, coll = db_with_snapshots(docs)
        service = ConstructionProgressService(db, provider=MagicMock())

        removed = await service.purge_snapshots_citing_capture("org1", "")

        assert removed == 0
        assert len(coll._docs) == 1

    @pytest.mark.asyncio
    async def test_only_the_stale_snapshot_is_removed_others_survive(self, db_with_snapshots):
        docs = [
            _snapshot("snap_stale", "org1", "floorA", ["c100"]),
            _snapshot("snap_fresh", "org1", "floorB", ["c200"]),
        ]
        db, coll = db_with_snapshots(docs)
        service = ConstructionProgressService(db, provider=MagicMock())

        removed = await service.purge_snapshots_citing_capture("org1", "c100")

        assert removed == 1
        remaining_ids = {d["_id"] for d in coll._docs}
        assert remaining_ids == {"snap_fresh"}
