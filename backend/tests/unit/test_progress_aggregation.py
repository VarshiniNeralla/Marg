"""Room -> flat -> floor aggregation: coverage vs estimate, unknown != 0, completion strictness."""
from datetime import datetime

from app.services.construction_progress_providers.progress_aggregation import (
    blended_floor_pct,
    flat_metrics,
    floor_finishing_summary,
    recompute_flat_progress,
    room_metrics,
    status_for_pct,
)

APPLICABLE = ["a", "b", "c", "d"]


def act(aid, pct, **kw):
    return {"activityId": aid, "completionPct": pct, "status": "in_progress", **kw}


def room(acts, captures=1):
    return {"roomName": "R", "activities": acts, "capturesCount": captures, "pinNumbers": [1]}


def test_status_vocabulary():
    assert status_for_pct(None) == "unable_to_determine"
    assert status_for_pct(0) == "not_started"
    assert status_for_pct(40) == "in_progress"
    assert status_for_pct(85) == "mostly_complete"
    assert status_for_pct(100) == "completed"


def test_room_counted_progress_estimate_and_coverage_are_separate():
    m = room_metrics(room([act("a", 100.0), act("b", 50.0)]), APPLICABLE)
    assert m["estimatePct"] == 75.0           # mean of what was seen
    assert m["progressPct"] == 37.5           # (100 + 50) / 4 applicable: unseen work is not counted
    assert m["coveragePct"] == 50.0
    assert m["status"] == "in_progress"


def test_unable_to_determine_is_unknown_not_zero():
    m = room_metrics(room([act("a", 100.0), act("b", 0.0, assessmentStatus="unable_to_determine")]), APPLICABLE)
    assert m["observedActivities"] == 1
    assert m["estimatePct"] == 100.0           # the unknown did not drag the estimate down to 50
    assert m["coveragePct"] == 25.0


def test_room_only_completed_when_every_applicable_activity_is_observed_at_100():
    full = room_metrics(room([act(x, 100.0) for x in APPLICABLE]), APPLICABLE)
    assert full["status"] == "completed" and full["isComplete"] is True
    three_of_four = room_metrics(room([act(x, 100.0) for x in APPLICABLE[:3]]), APPLICABLE)
    assert three_of_four["status"] != "completed" and three_of_four["isComplete"] is False
    one_short = room_metrics(room([act("a", 100.0), act("b", 100.0), act("c", 100.0), act("d", 90.0)]), APPLICABLE)
    assert one_short["isComplete"] is False


def test_few_readings_mean_awaiting_evidence_even_when_they_look_good():
    m = room_metrics(room([act("a", 100.0)]), APPLICABLE)       # 1 of 4 observed
    assert m["status"] == "awaiting_evidence"
    assert m["isComplete"] is False


def test_room_with_no_capture_and_no_readings_is_no_photos():
    m = room_metrics({"roomName": "R", "activities": [], "capturesCount": 0, "pinNumbers": []}, APPLICABLE)
    assert m["status"] == "no_photos"
    assert m["progressPct"] == 0.0


def test_manual_override_counts_as_observed():
    m = room_metrics(room([act(x, 100.0, detectionType="manual") for x in APPLICABLE]), APPLICABLE)
    assert m["isComplete"] is True


def test_floor_example_four_flats_each_complete_flat_is_25_percent():
    done = {"completionPct": 100.0, "scopeStatus": "completed", "coveragePct": 100.0}
    pending = {"completionPct": 0.0, "scopeStatus": "no_photos", "coveragePct": 0.0}
    one_of_four = floor_finishing_summary([done, pending, pending, pending])
    assert one_of_four["progressPct"] == 25.0
    assert one_of_four["completed"] == 1 and one_of_four["total"] == 4


def test_flat_with_one_unfinished_room_does_not_contribute_its_full_share():
    complete_room = room_metrics(room([act(x, 100.0) for x in APPLICABLE]), APPLICABLE)
    half_room = room_metrics(room([act(x, 50.0) for x in APPLICABLE]), APPLICABLE)
    fm = flat_metrics([complete_room, half_room], 2)
    assert fm["isFullyComplete"] is False
    assert fm["completionPct"] == 75.0
    assert fm["status"] == "in_progress"


def test_unphotographed_rooms_count_as_zero_in_the_flat_and_block_completion():
    complete_room = room_metrics(room([act(x, 100.0) for x in APPLICABLE]), APPLICABLE)
    fm = flat_metrics([complete_room], rooms_required=3)
    assert fm["completionPct"] == 33.3
    assert fm["roomsRequired"] == 3 and fm["isFullyComplete"] is False
    assert fm["coveragePct"] == 33.3


def test_flat_cannot_read_100_unless_every_room_is_complete():
    almost = room_metrics(room([act("a", 100.0), act("b", 100.0), act("c", 100.0), act("d", 99.0)]), APPLICABLE)
    fm = flat_metrics([almost], 1)
    assert fm["completionPct"] < 100.0


def test_awaiting_evidence_flat_is_counted_separately():
    awaiting = {"completionPct": 5.0, "scopeStatus": "awaiting_evidence", "coveragePct": 10.0}
    wip = {"completionPct": 40.0, "scopeStatus": "in_progress", "coveragePct": 80.0}
    s = floor_finishing_summary([awaiting, wip])
    assert (s["awaitingEvidence"], s["inProgress"], s["completed"]) == (1, 1, 0)


def test_common_area_counts_as_one_flat_equivalent_in_the_headline():
    flats = {"progressPct": 40.0, "total": 4}
    common = {"progressPct": 90.0, "total": 3}
    assert blended_floor_pct(flats, common) == round((40 * 4 + 90) / 5, 1)
    assert blended_floor_pct(flats, {"progressPct": 0.0, "total": 0}) == 40.0


def test_recompute_in_place_is_idempotent_and_reports_last_inspection():
    flats = [{
        "flatName": "Flat 01", "roomsRequired": 2,
        "rooms": [
            {"roomName": "A", "capturesCount": 1, "pinNumbers": [1], "activities": [
                act(x, 100.0, lastCapturedAt=datetime(2026, 11, 10, 10, 0)) for x in APPLICABLE
            ]},
            {"roomName": "B", "capturesCount": 0, "pinNumbers": [], "activities": []},
        ],
    }]
    assert recompute_flat_progress(flats, lambda f, r: APPLICABLE) is True
    fp = flats[0]
    assert fp["completionPct"] == 50.0 and fp["roomsComplete"] == 1 and fp["scopeStatus"] == "in_progress"
    assert fp["lastInspection"] == datetime(2026, 11, 10, 10, 0)
    assert recompute_flat_progress(flats, lambda f, r: APPLICABLE) is False


def test_legacy_snapshot_without_applicable_ids_falls_back_to_observed_activities():
    flats = [{"flatName": "F", "roomsRequired": 1, "rooms": [
        {"roomName": "A", "capturesCount": 1, "pinNumbers": [1], "activities": [act("x", 60.0), act("y", 80.0)]},
    ]}]
    recompute_flat_progress(flats, None)
    assert flats[0]["rooms"][0]["estimatePct"] == 70.0
    assert flats[0]["completionPct"] == 70.0
