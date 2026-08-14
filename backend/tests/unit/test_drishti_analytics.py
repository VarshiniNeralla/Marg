"""Unit tests for drishti_analytics.py's pure ranking/comparison/synthesis
functions — the core of Drishti's "calculations happen in code, never in the
LLM" architecture. All fixtures are handcrafted dicts, no db/mocking needed."""
from __future__ import annotations

from app.services.drishti_analytics import (
    find_capture_gaps,
    rank_activities,
    rank_common_areas,
    rank_flats,
    rank_unfinished_work,
    synthesize_top_concerns,
)


def _activity(activity_id, name, pct, status="completed", evidence=""):
    return {
        "activityId": activity_id, "activityName": name,
        "completionPct": pct, "confidencePct": 90.0,
        "evidenceCaptureIds": [], "evidence": evidence, "status": status,
    }


def _room(name, activities, captures_count=1, pin_numbers=None):
    return {
        "roomName": name, "isComplete": False, "activities": activities,
        "capturesCount": captures_count, "pinNumbers": pin_numbers or [],
    }


def _flat(name, rooms, completion_pct=50.0, rooms_complete=0):
    return {
        "flatName": name, "completionPct": completion_pct,
        "roomsComplete": rooms_complete, "roomsTotal": len(rooms),
        "roomsRequired": len(rooms), "roomsPhotographed": len(rooms),
        "isFullyComplete": False, "rooms": rooms,
    }


class TestRankActivities:
    def test_fastest_excludes_not_assessed_and_not_observable(self):
        rooms = [
            _room("Bedroom 1", [
                _activity("a1", "Wall Punning", 90.0, status="completed"),
                _activity("a2", "Painting", 40.0, status="in_progress"),
                _activity("a3", "Corecutting", 0.0, status="not_assessed"),
                _activity("a4", "MEP", 0.0, status="not_observable"),
            ]),
        ]
        result = rank_activities(rooms, direction="fastest")
        assert len(result) == 2
        assert result[0]["activityName"] == "Wall Punning"
        assert result[0]["completionPct"] == 90.0
        assert result[1]["activityName"] == "Painting"

    def test_slowest_sorts_ascending(self):
        rooms = [_room("Kitchen", [
            _activity("a1", "Tiling", 80.0),
            _activity("a2", "Electrical", 20.0),
        ])]
        result = rank_activities(rooms, direction="slowest")
        assert [r["activityName"] for r in result] == ["Electrical", "Tiling"]

    def test_empty_scope_returns_empty_list_not_exception(self):
        assert rank_activities([], direction="fastest") == []
        rooms = [_room("Empty Room", [_activity("a1", "X", 0.0, status="not_assessed")])]
        assert rank_activities(rooms, direction="fastest") == []


class TestRankFlats:
    def test_excludes_common_area_entry(self):
        flats = [
            _flat("Flat 01", [], completion_pct=60.0),
            _flat("Flat 02", [], completion_pct=80.0),
            _flat("Common Area", [], completion_pct=999.0),
        ]
        result = rank_flats(flats, direction="most_progressed")
        names = [r["flatName"] for r in result]
        assert "Common Area" not in names
        assert names == ["Flat 02", "Flat 01"]

    def test_least_progressed_sorts_ascending(self):
        flats = [_flat("Flat 01", [], completion_pct=60.0), _flat("Flat 02", [], completion_pct=20.0)]
        result = rank_flats(flats, direction="least_progressed")
        assert result[0]["flatName"] == "Flat 02"


class TestRankCommonAreas:
    def test_ranks_only_common_area_rooms(self):
        flats = [
            _flat("Flat 01", [_room("Bedroom", [_activity("a1", "X", 99.0)])]),
            _flat("Common Area", [
                _room("Corridor", [_activity("a1", "Wall Punning", 70.0)]),
                _room("Lobby", [_activity("a1", "Flooring", 30.0)]),
            ]),
        ]
        result = rank_common_areas(flats, direction="most_progressed")
        assert [r["commonAreaName"] for r in result] == ["Corridor", "Lobby"]

    def test_no_common_area_entry_returns_empty(self):
        flats = [_flat("Flat 01", [_room("Bedroom", [_activity("a1", "X", 50.0)])])]
        assert rank_common_areas(flats) == []


class TestRankUnfinishedWork:
    def test_filters_by_threshold_and_sorts_ascending(self):
        rooms = [_room("Kitchen", [
            _activity("a1", "Tiling", 90.0),
            _activity("a2", "Electrical", 20.0),
            _activity("a3", "Plumbing", 60.0),
        ])]
        result = rank_unfinished_work(rooms, threshold_pct=80.0)
        assert [r["activityName"] for r in result] == ["Electrical", "Plumbing"]
        assert result[0]["gapPct"] == 80.0
        assert result[1]["gapPct"] == 40.0


class TestFindCaptureGaps:
    def test_surfaces_zero_capture_rooms_worst_first(self):
        flats = [
            _flat("Flat 01", [
                _room("Bedroom", [_activity("a1", "X", 50.0)], captures_count=2),
                _room("Toilet", [_activity("a1", "X", 0.0, status="not_assessed")], captures_count=0),
            ]),
            _flat("Common Area", [
                _room("Corridor", [_activity("a1", "X", 0.0, status="not_assessed")], captures_count=0),
            ]),
        ]
        gaps = find_capture_gaps(flats)
        assert len(gaps) == 2
        room_names = {g["roomName"] for g in gaps}
        assert room_names == {"Toilet", "Corridor"}
        corridor_gap = next(g for g in gaps if g["roomName"] == "Corridor")
        assert corridor_gap["isCommonArea"] is True
        toilet_gap = next(g for g in gaps if g["roomName"] == "Toilet")
        assert toilet_gap["isCommonArea"] is False


class TestSynthesizeTopConcerns:
    def test_empty_inputs_yield_empty_list(self):
        assert synthesize_top_concerns() == []

    def test_qualifies_and_orders_by_severity(self):
        floor_snapshot = {"floorId": "f1", "overallProgressPct": 30.0}
        coverage = {"coveragePct": 40.0}
        unfinished = [{"activityName": "Electrical", "completionPct": 10.0}]
        capture_gaps = [{"flatName": "Flat 01", "roomName": "Toilet", "capturesCount": 0, "isCommonArea": False}]
        quality_notes = [{"pinName": "Pin 3", "floor": "Floor 2"}]
        forecast = {"status": "stalled_or_regressing"}

        concerns = synthesize_top_concerns(
            floor_snapshot=floor_snapshot, coverage=coverage, unfinished_work=unfinished,
            capture_gaps=capture_gaps, quality_notes=quality_notes, forecast=forecast,
        )
        # Low coverage % and specific uncaptured rooms are two distinct
        # coverage concerns, plus one each for progress/unfinished-work/
        # quality/schedule = 6 total.
        assert len(concerns) == 6
        # severityRank ascending = most severe first
        assert [c["severityRank"] for c in concerns] == sorted(c["severityRank"] for c in concerns)
        categories = {c["category"] for c in concerns}
        assert categories == {"progress", "coverage", "quality", "schedule"}

    def test_high_progress_and_coverage_do_not_trigger_concerns(self):
        floor_snapshot = {"floorId": "f1", "overallProgressPct": 95.0}
        coverage = {"coveragePct": 98.0}
        concerns = synthesize_top_concerns(floor_snapshot=floor_snapshot, coverage=coverage)
        assert concerns == []
