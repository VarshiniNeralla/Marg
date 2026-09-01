"""Unit tests for drishti_analytics.py's pure ranking/comparison/synthesis
functions — the core of Drishti's "calculations happen in code, never in the
LLM" architecture. All fixtures are handcrafted dicts, no db/mocking needed."""
from __future__ import annotations

from app.services.drishti_analytics import (
    find_capture_gaps,
    find_captured_rooms,
    list_activities_by_status,
    list_floor_level_activities_by_status,
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

    def test_per_room_flat_name_wins_over_fallback_parameter(self):
        """Regression: a multi-flat scope (whole floor / whole project) must
        attribute each activity to the room's OWN flat, never blanket-label
        every activity with one fallback flat_name — that would misattribute
        every activity outside the fallback flat to the wrong flat."""
        room_in_flat_a = {**_room("Kitchen", [_activity("a1", "Tiling", 50.0)]), "flatName": "Flat A"}
        room_in_flat_b = {**_room("Bedroom", [_activity("a2", "Painting", 30.0)]), "flatName": "Flat B"}
        result = rank_activities([room_in_flat_a, room_in_flat_b], direction="fastest", flat_name="Fallback")
        by_activity = {r["activityName"]: r["flatName"] for r in result}
        assert by_activity["Tiling"] == "Flat A"
        assert by_activity["Painting"] == "Flat B"

    def test_falls_back_to_flat_name_param_when_room_lacks_its_own(self):
        # Single-flat scope: rooms don't carry their own flatName, so the
        # caller-supplied fallback is used for all of them.
        rooms = [_room("Kitchen", [_activity("a1", "Tiling", 50.0)])]
        result = rank_activities(rooms, direction="fastest", flat_name="Flat 02")
        assert result[0]["flatName"] == "Flat 02"


class TestListActivitiesByStatus:
    def test_lists_matching_status_only(self):
        rooms = [_room("Kitchen", [
            _activity("a1", "Tiling", 50.0, status="in_progress"),
            _activity("a2", "Painting", 100.0, status="completed"),
            _activity("a3", "Corecutting", 0.0, status="not_assessed"),
        ])]
        result = list_activities_by_status(rooms, ["in_progress"])
        assert len(result) == 1
        assert result[0]["activityName"] == "Tiling"

    def test_includes_not_assessed_and_not_observable_unlike_rank_activities(self):
        """Unlike rank_activities (which excludes non-rankable statuses),
        a LISTING question about not_assessed/not_observable activities is
        legitimate and must return real hits."""
        rooms = [_room("Kitchen", [
            _activity("a1", "Corecutting", 0.0, status="not_assessed"),
            _activity("a2", "MEP", 0.0, status="not_observable"),
        ])]
        result = list_activities_by_status(rooms, ["not_assessed", "not_observable"])
        assert len(result) == 2

    def test_multi_flat_scope_attributes_each_activity_to_its_own_flat(self):
        room_in_flat_a = {**_room("Kitchen", [_activity("a1", "Tiling", 50.0, status="in_progress")]), "flatName": "Flat A"}
        room_in_flat_b = {**_room("Bedroom", [_activity("a2", "Tiling", 30.0, status="in_progress")]), "flatName": "Flat B"}
        result = list_activities_by_status([room_in_flat_a, room_in_flat_b], ["in_progress"])
        flat_names = {r["flatName"] for r in result}
        assert flat_names == {"Flat A", "Flat B"}

    def test_empty_when_nothing_matches(self):
        rooms = [_room("Kitchen", [_activity("a1", "Tiling", 50.0, status="completed")])]
        assert list_activities_by_status(rooms, ["not_assessed"]) == []

    def test_sorted_by_activity_name_then_flat_then_room(self):
        rooms = [
            {**_room("Room B", [_activity("a1", "Zebra Activity", 50.0, status="in_progress")]), "flatName": "Flat 02"},
            {**_room("Room A", [_activity("a2", "Alpha Activity", 50.0, status="in_progress")]), "flatName": "Flat 01"},
        ]
        result = list_activities_by_status(rooms, ["in_progress"])
        assert [r["activityName"] for r in result] == ["Alpha Activity", "Zebra Activity"]


class TestListFloorLevelActivitiesByStatus:
    """Regression coverage for a real production bug: "what are those 101
    activities that did not start" (statuses not_assessed/no_evidence)
    always returned an empty activityList.items, because
    list_activities_by_status reads room-level rooms[].activities[] — and
    an uncaptured room's activities is a bare [] in real production data
    (confirmed directly against the database), so not_assessed activities
    can NEVER appear there no matter how many exist. Those statuses only
    exist in each snapshot's separate per-floor "activities" rollup (one
    entry per activity NAME for the whole floor, keyed "name" not
    "activityName", with no room/flat location at all)."""

    def _floor_activity(self, name, status, activity_id="a1"):
        return {"activityId": activity_id, "name": name, "status": status, "completionPct": 0.0}

    def test_lists_matching_status_from_floor_rollup(self):
        floor_activities = {
            "f1": [
                self._floor_activity("Main Door Frame", "not_assessed"),
                self._floor_activity("Wall Punning", "in_progress"),
                self._floor_activity("Corecutting", "not_observable"),
            ],
        }
        result = list_floor_level_activities_by_status(floor_activities, ["not_assessed"], {"f1": "Floor 1"})
        assert len(result) == 1
        assert result[0]["activityName"] == "Main Door Frame"
        assert result[0]["floorName"] == "Floor 1"
        # No room/flat location exists for a floor-rollup entry.
        assert "roomName" not in result[0]
        assert "flatName" not in result[0]

    def test_merges_multiple_statuses(self):
        floor_activities = {
            "f1": [
                self._floor_activity("Main Door Frame", "not_assessed"),
                self._floor_activity("Corecutting", "not_observable"),
            ],
        }
        result = list_floor_level_activities_by_status(
            floor_activities, ["not_assessed", "not_observable"], {"f1": "Floor 1"},
        )
        assert len(result) == 2

    def test_groups_across_multiple_floors_sorted_by_floor_then_name(self):
        floor_activities = {
            "f2": [self._floor_activity("Zebra Activity", "not_assessed")],
            "f1": [self._floor_activity("Alpha Activity", "not_assessed")],
        }
        result = list_floor_level_activities_by_status(
            floor_activities, ["not_assessed"], {"f1": "Floor 1", "f2": "Floor 2"},
        )
        assert [(r["floorName"], r["activityName"]) for r in result] == [
            ("Floor 1", "Alpha Activity"), ("Floor 2", "Zebra Activity"),
        ]

    def test_empty_when_nothing_matches(self):
        floor_activities = {"f1": [self._floor_activity("Wall Punning", "in_progress")]}
        assert list_floor_level_activities_by_status(floor_activities, ["not_assessed"], {"f1": "Floor 1"}) == []

    def test_works_without_floor_names_mapping(self):
        floor_activities = {"f1": [self._floor_activity("Main Door Frame", "not_assessed")]}
        result = list_floor_level_activities_by_status(floor_activities, ["not_assessed"])
        assert result[0]["floorName"] is None
        assert result[0]["floorId"] == "f1"


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


class TestFindCapturedRooms:
    def test_surfaces_only_rooms_with_captures_best_first(self):
        flats = [
            _flat("Flat 01", [
                _room("Bedroom", [_activity("a1", "X", 50.0)], captures_count=2),
                _room("Toilet", [_activity("a1", "X", 0.0, status="not_assessed")], captures_count=0),
            ]),
            _flat("Common Area", [
                _room("Corridor", [_activity("a1", "X", 30.0)], captures_count=1),
            ]),
        ]
        captured = find_captured_rooms(flats)
        room_names = {r["roomName"] for r in captured}
        assert room_names == {"Bedroom", "Corridor"}
        assert "Toilet" not in room_names
        # best-first: Bedroom (2 captures) before Corridor (1 capture).
        assert [r["roomName"] for r in captured] == ["Bedroom", "Corridor"]
        bedroom = next(r for r in captured if r["roomName"] == "Bedroom")
        assert bedroom["isCommonArea"] is False
        corridor = next(r for r in captured if r["roomName"] == "Corridor")
        assert corridor["isCommonArea"] is True

    def test_empty_when_nothing_captured(self):
        flats = [_flat("Flat 01", [
            _room("Toilet", [_activity("a1", "X", 0.0, status="not_assessed")], captures_count=0),
        ])]
        assert find_captured_rooms(flats) == []

    def test_is_the_exact_complement_of_find_capture_gaps(self):
        flats = [
            _flat("Flat 01", [
                _room("Bedroom", [_activity("a1", "X", 50.0)], captures_count=3),
                _room("Toilet", [_activity("a1", "X", 0.0, status="not_assessed")], captures_count=0),
            ]),
        ]
        captured_names = {r["roomName"] for r in find_captured_rooms(flats)}
        gap_names = {g["roomName"] for g in find_capture_gaps(flats)}
        assert captured_names == {"Bedroom"}
        assert gap_names == {"Toilet"}
        assert captured_names.isdisjoint(gap_names)


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
