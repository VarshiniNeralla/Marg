"""Unit tests for DrishtiContextService's rollup math and the
configured/captured/assessed capture-coverage distinction (spec section 13) —
using an in-memory fake Motor-like db, following the mocking style of
test_rbac_service.py."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.drishti_context_service import DrishtiContextService


class _FakeCursor:
    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs

    async def to_list(self, length=None):
        return self._docs


class _FakeAggregateCursor:
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


class _FakeCollection:
    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs

    def find(self, query=None):
        return _FakeCursor(self._docs)

    def aggregate(self, pipeline):
        # Group by floorId, keep the doc with the max snapshotDate per group —
        # good enough to emulate the real $sort+$group+$first pipeline for tests.
        match = pipeline[0]["$match"]
        floor_ids = set(match.get("floorId", {}).get("$in", []))
        filtered = [d for d in self._docs if d["floorId"] in floor_ids]
        latest_per_floor: dict[str, dict] = {}
        for d in filtered:
            fid = d["floorId"]
            if fid not in latest_per_floor or d["snapshotDate"] > latest_per_floor[fid]["snapshotDate"]:
                latest_per_floor[fid] = d
        rows = [{"_id": fid, "doc": doc} for fid, doc in latest_per_floor.items()]
        return _FakeAggregateCursor(rows)

    async def find_one(self, query, sort=None):
        return self._docs[0] if self._docs else None


def _make_db(towers, floors, snapshots):
    db = MagicMock()
    collections = {
        "towers": _FakeCollection(towers),
        "floors": _FakeCollection(floors),
        "construction_progress_snapshots": _FakeCollection(snapshots),
        "projects": _FakeCollection([]),
    }
    db.__getitem__.side_effect = lambda name: collections[name]
    return db


class TestGetProjectContext:
    @pytest.mark.asyncio
    async def test_excludes_unanalyzed_floor_from_average_but_reports_it(self):
        towers = [{"_id": "t1", "name": "Tower A", "projectId": "p1"}]
        floors = [
            {"_id": "f1", "towerId": "t1", "label": "Floor 1"},
            {"_id": "f2", "towerId": "t1", "label": "Floor 2"},
            {"_id": "f3", "towerId": "t1", "label": "Floor 3"},  # never analyzed
        ]
        snapshots = [
            {"floorId": "f1", "snapshotDate": 1, "overallProgressPct": 60.0, "overallStatus": "in_progress", "summaryCards": {}},
            {"floorId": "f2", "snapshotDate": 1, "overallProgressPct": 80.0, "overallStatus": "in_progress", "summaryCards": {}},
        ]
        db = _make_db(towers, floors, snapshots)
        service = DrishtiContextService(db)

        result = await service.get_project_context("org1", "p1")

        assert result["floorsAnalyzed"] == 2
        assert result["floorsNotYetAnalyzed"] == 1
        # (60 + 80) / 2 = 70, NOT (60+80+0)/3
        assert result["overallProgressPct"] == 70.0

    @pytest.mark.asyncio
    async def test_no_analyzed_floors_returns_none_not_zero(self):
        towers = [{"_id": "t1", "name": "Tower A", "projectId": "p1"}]
        floors = [{"_id": "f1", "towerId": "t1", "label": "Floor 1"}]
        db = _make_db(towers, floors, [])
        service = DrishtiContextService(db)

        result = await service.get_project_context("org1", "p1")

        assert result["overallProgressPct"] is None
        assert result["floorsNotYetAnalyzed"] == 1


class TestComputeCaptureCoverage:
    @pytest.mark.asyncio
    async def test_unanalyzed_floor_reports_not_analyzed(self):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        result = await service.compute_capture_coverage("org1", "f1")
        assert result["analyzed"] is False
        assert result["roomsConfigured"] == 0

    @pytest.mark.asyncio
    async def test_configured_captured_assessed_stay_distinct(self, monkeypatch):
        snapshot = {
            "flatProgress": [
                {
                    "flatName": "Flat 01",
                    "roomsRequired": 5,
                    "roomsPhotographed": 2,
                    "rooms": [
                        {
                            "roomName": "Bedroom 1",
                            "activities": [
                                {"activityId": "a1", "status": "completed"},
                                {"activityId": "a2", "status": "in_progress"},
                            ],
                        },
                        {
                            "roomName": "Toilet 1",
                            "activities": [
                                # No capture yet for this room — must be
                                # not_assessed, never counted as 0% complete.
                                {"activityId": "a3", "status": "not_assessed"},
                            ],
                        },
                        {
                            "roomName": "Kitchen",
                            "activities": [
                                # Concealed work — not_observable, never
                                # counted as incomplete.
                                {"activityId": "a4", "status": "not_observable"},
                            ],
                        },
                    ],
                },
            ],
            "summaryCards": {},
        }
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=snapshot))

        result = await service.compute_capture_coverage("org1", "f1")

        assert result["roomsConfigured"] == 5
        assert result["roomsCaptured"] == 2
        assert result["activitiesConfigured"] == 4
        assert result["activitiesAssessed"] == 2  # completed + in_progress only
        assert result["activitiesNotAssessed"] == 1
        assert result["activitiesNotObservable"] == 1
        # coveragePct falls back to a manual ratio since summaryCards lacks it
        assert result["coveragePct"] == 40.0

    @pytest.mark.asyncio
    async def test_prefers_persisted_coverage_pct_when_present(self, monkeypatch):
        snapshot = {
            "flatProgress": [{"flatName": "Flat 01", "roomsRequired": 5, "roomsPhotographed": 2, "rooms": []}],
            "summaryCards": {"coveragePct": 91.0},
        }
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=snapshot))

        result = await service.compute_capture_coverage("org1", "f1")

        assert result["coveragePct"] == 91.0
