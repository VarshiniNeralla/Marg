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


_ROOM_SNAPSHOT = {
    "flatProgress": [
        {
            "flatName": "Flat 02",
            "rooms": [
                {
                    "roomName": "Bedroom-3", "capturesCount": 2,
                    "activities": [{"activityId": "a1", "activityName": "Wall Punning", "completionPct": 70.0, "status": "in_progress"}],
                },
                {
                    "roomName": "Toilet", "capturesCount": 0,
                    "activities": [{"activityId": "a1", "activityName": "Wall Punning", "completionPct": 0.0, "status": "not_assessed"}],
                },
            ],
        },
        {
            "flatName": "Common Area",
            "rooms": [
                {
                    "roomName": "Corridor", "capturesCount": 3,
                    "activities": [{"activityId": "common.corridor_flooring_1", "activityName": "Corridor Flooring", "completionPct": 40.0, "status": "in_progress"}],
                },
            ],
        },
    ],
}


class TestGetRoomContext:
    @pytest.mark.asyncio
    async def test_found_when_room_has_evidence(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_room_context("org1", "f1", "Flat 02", "Bedroom-3")

        assert result["resolutionStatus"] == "found"
        assert result["room"]["roomName"] == "Bedroom-3"

    @pytest.mark.asyncio
    async def test_configured_no_evidence_when_room_never_captured(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_room_context("org1", "f1", "Flat 02", "Toilet")

        assert result["resolutionStatus"] == "configured_no_evidence"

    @pytest.mark.asyncio
    async def test_not_configured_when_room_not_in_roster(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_room_context("org1", "f1", "Flat 02", "Master Suite")

        assert result["resolutionStatus"] == "not_configured"
        assert result["room"] is None

    @pytest.mark.asyncio
    async def test_not_configured_when_floor_never_analyzed(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=None))

        result = await service.get_room_context("org1", "f1", "Flat 02", "Bedroom-3")

        assert result["resolutionStatus"] == "not_configured"


class TestGetCommonAreaContext:
    @pytest.mark.asyncio
    async def test_found_when_common_area_has_evidence(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_common_area_context("org1", "f1", "Corridor")

        assert result["resolutionStatus"] == "found"
        assert result["room"]["roomName"] == "Corridor"
        assert result["flatName"] == "Common Area"

    @pytest.mark.asyncio
    async def test_real_flats_room_is_not_mistaken_for_a_common_area(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        # "Bedroom-3" only exists under Flat 02, never under Common Area.
        result = await service.get_common_area_context("org1", "f1", "Bedroom-3")

        assert result["resolutionStatus"] == "not_configured"
        assert result["room"] is None


class TestGetActivityContext:
    @pytest.mark.asyncio
    async def test_found_across_multiple_rooms(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_activity_context("org1", "f1", "a1")

        assert result["resolutionStatus"] == "found"
        # a1 appears in both Bedroom-3 (in_progress) and Toilet (not_assessed).
        assert len(result["hits"]) == 2

    @pytest.mark.asyncio
    async def test_narrowed_to_one_room_when_room_name_given(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_activity_context("org1", "f1", "a1", flat_name="Flat 02", room_name="Bedroom-3")

        assert len(result["hits"]) == 1
        assert result["hits"][0]["roomName"] == "Bedroom-3"

    @pytest.mark.asyncio
    async def test_not_configured_when_activity_id_absent_in_scope(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_activity_context("org1", "f1", "nonexistent.activity")

        assert result["resolutionStatus"] == "not_configured"
        assert result["hits"] == []

    @pytest.mark.asyncio
    async def test_configured_no_evidence_when_only_not_assessed_hits(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_ROOM_SNAPSHOT))

        result = await service.get_activity_context("org1", "f1", "a1", flat_name="Flat 02", room_name="Toilet")

        assert result["resolutionStatus"] == "configured_no_evidence"


_PROJECT_CONTEXT_TWO_FLOORS = {
    "towers": [
        {
            "towerId": "t1", "towerName": "Tower A",
            "floors": [
                {"floorId": "f1", "floorName": "Floor 1"},
                {"floorId": "f2", "floorName": "Floor 2"},
            ],
        },
    ],
}


def _snapshot_doc(floor_id, snapshot_date, flat_progress):
    return {"floorId": floor_id, "snapshotDate": snapshot_date, "flatProgress": flat_progress}


class TestFindActivityAcrossProject:
    @pytest.mark.asyncio
    async def test_finds_hits_across_multiple_floors_in_one_batched_query(self):
        import datetime as dt

        snapshots = [
            _snapshot_doc("f1", dt.datetime(2026, 1, 1), [
                {"flatName": "Flat 01", "rooms": [
                    {"roomName": "Kitchen", "activities": [
                        {"activityId": "flat.vitrified_flooring_16", "activityName": "Vitrified Flooring", "completionPct": 70.0, "status": "in_progress"},
                    ]},
                ]},
            ]),
            _snapshot_doc("f2", dt.datetime(2026, 1, 1), [
                {"flatName": "Common Area", "rooms": [
                    {"roomName": "Corridor", "activities": [
                        {"activityId": "flat.vitrified_flooring_16", "activityName": "Vitrified Flooring", "completionPct": 30.0, "status": "in_progress"},
                    ]},
                ]},
            ]),
        ]
        db = _make_db([], [], snapshots)
        service = DrishtiContextService(db)

        result = await service.find_activity_across_project("org1", _PROJECT_CONTEXT_TWO_FLOORS, "flat.vitrified_flooring_16")

        assert result["resolutionStatus"] == "found"
        assert len(result["hits"]) == 2
        floor_names = {h["floorName"] for h in result["hits"]}
        assert floor_names == {"Floor 1", "Floor 2"}
        assert result["floorsSearched"] == 2
        assert result["floorsAnalyzed"] == 2

    @pytest.mark.asyncio
    async def test_no_project_floors_reports_not_configured(self):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)

        result = await service.find_activity_across_project("org1", {"towers": []}, "flat.vitrified_flooring_16")

        assert result["resolutionStatus"] == "not_configured"
        assert result["hits"] == []

    @pytest.mark.asyncio
    async def test_analyzed_floors_but_activity_never_scored_is_not_configured(self):
        import datetime as dt

        snapshots = [
            _snapshot_doc("f1", dt.datetime(2026, 1, 1), [
                {"flatName": "Flat 01", "rooms": [
                    {"roomName": "Kitchen", "activities": [
                        {"activityId": "flat.electrical_wiring_23", "activityName": "Electrical Wiring", "completionPct": 50.0, "status": "in_progress"},
                    ]},
                ]},
            ]),
        ]
        db = _make_db([], [], snapshots)
        service = DrishtiContextService(db)

        result = await service.find_activity_across_project("org1", _PROJECT_CONTEXT_TWO_FLOORS, "flat.vitrified_flooring_16")

        assert result["resolutionStatus"] == "not_configured"
        assert result["hits"] == []
        assert result["floorsAnalyzed"] == 1

    @pytest.mark.asyncio
    async def test_no_floors_analyzed_at_all_is_configured_no_evidence(self):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)

        result = await service.find_activity_across_project("org1", _PROJECT_CONTEXT_TWO_FLOORS, "flat.vitrified_flooring_16")

        assert result["resolutionStatus"] == "configured_no_evidence"
        assert result["floorsAnalyzed"] == 0


# ── Fixtures for location_activities / common-area category status ─────────

_LIFT_LOBBY_SNAPSHOT = {
    "floorId": "f1",
    "flatProgress": [
        {
            "flatName": "Flat 02",
            "rooms": [
                {"roomName": "Bedroom-3", "capturesCount": 1, "activities": [
                    {"activityId": "flat.vitrified_flooring_16", "activityName": "Vitrified Flooring", "completionPct": 60.0, "status": "in_progress"},
                ]},
            ],
        },
        {
            "flatName": "Common Area",
            "rooms": [
                {
                    "roomName": "Lift Lobby", "capturesCount": 4,
                    "activities": [
                        {"activityId": "common.wall_punning_works_1", "activityName": "Wall Punning Works", "completionPct": 85.0, "status": "in_progress", "confidencePct": 90.0, "evidence": "Wall surfaces largely finished"},
                        {"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 0.0, "status": "not_assessed"},
                        {"activityId": "common.painting_2nd_coat_9", "activityName": "Painting 2nd Coat", "completionPct": 0.0, "status": "not_assessed"},
                        {"activityId": "common.false_ceiling_works_2", "activityName": "False Ceiling Works", "completionPct": 15.0, "status": "in_progress"},
                    ],
                },
                {
                    "roomName": "Corridor", "capturesCount": 3,
                    "activities": [
                        {"activityId": "common.corridor_flooring_3", "activityName": "Corridor Flooring", "completionPct": 40.0, "status": "in_progress"},
                        {"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 30.0, "status": "in_progress"},
                    ],
                },
                {
                    "roomName": "Staircase", "capturesCount": 0,
                    "activities": [
                        {"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 0.0, "status": "not_assessed"},
                    ],
                },
            ],
        },
    ],
}

_PAINTING_IDS = [
    "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26", "flat.primer_1st_coat_paint_27", "flat.final_coat_paint_37",
    "common.putty_1st_coat_4", "common.putty_2nd_coat_5", "common.primer_1st_coat_paint_6", "common.painting_2nd_coat_9",
]


class TestGetLocationActivities:
    """Covers the exact reported bug: "what OTHER activities are pending in
    the Lift Lobby" must return EVERY activity at that location, not just
    the one previously discussed."""

    @pytest.mark.asyncio
    async def test_returns_every_activity_at_the_named_common_area(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_location_activities(
            "org1", "f1", common_area_name="Lift Lobby",
        )

        assert result["resolutionStatus"] == "found"
        assert len(result["activities"]) == 4
        names = {a["activityName"] for a in result["activities"]}
        assert names == {"Wall Punning Works", "Primer & 1st Coat Paint", "Painting 2nd Coat", "False Ceiling Works"}

    @pytest.mark.asyncio
    async def test_returns_every_activity_at_a_room_in_a_flat(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_location_activities(
            "org1", "f1", flat_name="Flat 02", room_name="Bedroom-3",
        )

        assert len(result["activities"]) == 1
        assert result["activities"][0]["activityName"] == "Vitrified Flooring"

    @pytest.mark.asyncio
    async def test_uncaptured_location_reports_configured_no_evidence(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_location_activities(
            "org1", "f1", common_area_name="Staircase",
        )

        assert result["resolutionStatus"] == "configured_no_evidence"
        assert len(result["activities"]) == 1  # the activity record exists, just not_assessed

    @pytest.mark.asyncio
    async def test_unknown_location_reports_not_configured(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_location_activities(
            "org1", "f1", common_area_name="Fire Shaft",
        )

        assert result["resolutionStatus"] == "not_configured"
        assert result["activities"] == []


class TestGetCommonAreaCategoryStatus:
    """Covers "what is the status of painting in the Common Areas" —
    aggregating one category across EVERY common-area unit, distinguishing
    captured/assessed units from never-captured ones."""

    @pytest.mark.asyncio
    async def test_aggregates_across_all_common_area_units(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_common_area_category_status("org1", "f1", _PAINTING_IDS)

        assert result["resolutionStatus"] == "found"
        unit_names = {u["commonAreaName"] for u in result["units"]}
        assert unit_names == {"Lift Lobby", "Corridor"}
        assert "Staircase" in result["uncapturedUnits"]

    @pytest.mark.asyncio
    async def test_overall_pct_excludes_not_assessed_units(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=_LIFT_LOBBY_SNAPSHOT))

        result = await service.get_common_area_category_status("org1", "f1", _PAINTING_IDS)

        # Lift Lobby's painting activities are not_assessed (excluded);
        # Corridor's Primer & 1st Coat Paint is in_progress at 30% (included).
        assert result["overallCompletionPct"] == 30.0

    @pytest.mark.asyncio
    async def test_never_configured_on_this_floor_is_not_configured(self, monkeypatch):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=None))

        result = await service.get_common_area_category_status("org1", "f1", _PAINTING_IDS)

        assert result["resolutionStatus"] == "not_configured"

    @pytest.mark.asyncio
    async def test_units_present_but_all_not_assessed_is_configured_no_evidence(self, monkeypatch):
        snapshot = {
            "flatProgress": [{
                "flatName": "Common Area",
                "rooms": [{
                    "roomName": "Lobby", "capturesCount": 2,
                    "activities": [{"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 0.0, "status": "not_assessed"}],
                }],
            }],
        }
        db = _make_db([], [], [])
        service = DrishtiContextService(db)
        monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=snapshot))

        result = await service.get_common_area_category_status("org1", "f1", _PAINTING_IDS)

        assert result["resolutionStatus"] == "configured_no_evidence"
        assert result["overallCompletionPct"] is None


class TestGetCommonAreaCategoryStatusAcrossProject:
    @pytest.mark.asyncio
    async def test_aggregates_per_floor_across_project(self):
        db = _make_db([], [], [_LIFT_LOBBY_SNAPSHOT])
        service = DrishtiContextService(db)

        result = await service.get_common_area_category_status_across_project(
            "org1", _PROJECT_CONTEXT_TWO_FLOORS, _PAINTING_IDS,
        )

        assert result["resolutionStatus"] == "found"
        assert len(result["byFloor"]) == 1
        assert result["byFloor"][0]["floorId"] == "f1"
        assert result["overallCompletionPct"] == 30.0

    @pytest.mark.asyncio
    async def test_no_floors_returns_not_configured(self):
        db = _make_db([], [], [])
        service = DrishtiContextService(db)

        result = await service.get_common_area_category_status_across_project(
            "org1", {"towers": []}, _PAINTING_IDS,
        )

        assert result["resolutionStatus"] == "not_configured"
