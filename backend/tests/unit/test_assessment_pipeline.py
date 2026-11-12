"""Whole provider path with a stubbed vision call: state/band parsing, unknown handling, evidence, inference."""
import asyncio
from datetime import datetime, timedelta, timezone

from app.services.construction_progress_providers import CORE_ACTIVITIES
from app.services.construction_progress_providers.base import CaptureRef
from app.services.construction_progress_providers.vllm_provider import (
    VllmConstructionProgressProvider,
    _activities_checklist_text,
    clean_str_list,
    pct_from_assessment,
)

NOW = datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc)


def cap(cid, room, days_ago=0, pin=None):
    return CaptureRef(
        capture_id=cid, pin_id=pin or cid, room_name=room, flat_name="Flat 1",
        captured_at=NOW - timedelta(days=days_ago), image_url="x",
    )


def item(pct, conf=90.0, **kw):
    base = {
        "completion_pct": pct, "confidence_pct": conf, "evidence": f"saw {pct}",
        "explanation": f"explained {pct}", "indicators_found": ["x"], "indicators_missing": [],
        "views": ["walls_n"], "evidence_class": "CONFIRMED_INSTALLED",
    }
    base.update(kw)
    return base


def run(per_capture, captures, rosters=None):
    provider = VllmConstructionProgressProvider()

    async def fake(capture, activities, **_):
        return per_capture.get(capture.capture_id, {})

    provider._assess_capture = fake  # type: ignore[method-assign]
    return asyncio.run(provider.assess_floor_progress(
        floor_id="f", activities=CORE_ACTIVITIES, captures=captures, as_of=NOW,
        flat_room_rosters=rosters or {"Flat 1": sorted({c.room_name for c in captures})},
    ))


def room_acts(result, room):
    r = next(r for fp in result.flat_progress for r in fp.rooms if r.room_name == room)
    return {a.activity_id: a for a in r.activities}


# -- parsing: the model gives a state (+band); the server owns the number --------------------------------------

def test_state_and_band_become_numbers_the_model_never_chose():
    assert pct_from_assessment("not_started", {}) == (0.0, False)
    assert pct_from_assessment("completed", {}) == (100.0, False)
    assert pct_from_assessment("in_progress", {"scope_done_band": "26-50"}) == (38.0, False)
    assert pct_from_assessment("mostly_complete", {"scope_done_band": "76-99"}) == (88.0, False)
    # A stray number is clamped into the state's band instead of being trusted.
    assert pct_from_assessment("in_progress", {"scope_done_band": "1-25", "completion_pct": 90})[0] == 25.0
    assert pct_from_assessment("in_progress", {"completion_pct": 95})[0] == 75.0


def test_unable_to_determine_is_not_a_percentage():
    assert pct_from_assessment("unable_to_determine", {"completion_pct": 0}) == (None, True)


def test_legacy_numeric_answers_still_work():
    assert pct_from_assessment("scored", {"completion_pct": 55}) == (55.0, False)
    assert pct_from_assessment("", {}) == (None, False)


def test_string_lists_are_cleaned_and_capped():
    assert clean_str_list(["a", " a ", "b", "", None, "c", "d", "e"]) == ["a", "b", "c", "d"]
    assert clean_str_list("not a list") == []


def test_prompt_checklist_carries_the_activity_specific_rules():
    punning = next(a for a in CORE_ACTIVITIES if a.activity_id == "flat.putty_1st_coat_25")
    text = _activities_checklist_text([punning], surface_group="walls")
    assert "flat.putty_1st_coat_25" in text
    assert "NOT proof" in text or "Not proof" in text or "not proof" in text.lower()


# -- pipeline ------------------------------------------------------------------------------------------------

def test_unknown_readings_are_not_zero_and_not_in_the_floor_average():
    per = {"a": {
        "flat.putty_1st_coat_25": item(None, 60.0),
        "flat.core_punning": None,
        "flat.wall_punning_4": item(100.0, 90.0),
    }}
    per["a"].pop("flat.core_punning")
    r = run(per, [cap("a", "Living")])
    acts = room_acts(r, "Living")
    assert acts["flat.putty_1st_coat_25"].assessment_status == "unable_to_determine"
    assert acts["flat.putty_1st_coat_25"].review_required is True
    assert acts["flat.putty_1st_coat_25"].evidence_capture_ids == []
    floor = {a.activity.activity_id: a for a in r.activities}
    assert floor["flat.putty_1st_coat_25"].completion_pct == 0.0
    assert floor["flat.putty_1st_coat_25"].coverage_pct == 0.0          # nobody could establish it


def test_evidence_images_belong_to_the_activity_and_room():
    per = {
        "a": {"flat.wall_punning_4": item(80.0, 90.0), "flat.putty_1st_coat_25": item(0.0, 90.0)},
        "b": {"flat.wall_punning_4": item(80.0, 90.0)},
    }
    r = run(per, [cap("a", "Living"), cap("b", "Kitchen")])
    living = room_acts(r, "Living")
    kitchen = room_acts(r, "Kitchen")
    assert living["flat.core_punning"].evidence_capture_ids == ["a"]
    assert kitchen["flat.core_punning"].evidence_capture_ids == ["b"]     # never the other room's photo
    assert living["flat.putty_1st_coat_25"].evidence_capture_ids == []    # 0 % -> no photo attached
    for room_name, acts in (("Living", living), ("Kitchen", kitchen)):
        for a in acts.values():
            for d in a.evidence_details:
                assert d["roomName"] == room_name and d["flatName"] == "Flat 1"


def test_inferred_completion_is_labelled_and_points_at_the_driving_photo():
    per = {"a": {"flat.primer_1st_coat_paint_27": item(90.0, 90.0)}}
    r = run(per, [cap("a", "Living")])
    acts = room_acts(r, "Living")
    assert acts["flat.primer_1st_coat_paint_27"].detection_type == "direct"
    assert acts["flat.putty_2nd_coat_26"].detection_type == "inferred"
    assert acts["flat.putty_2nd_coat_26"].inferred_from == "flat.primer_1st_coat_paint_27"
    assert acts["flat.putty_2nd_coat_26"].evidence_capture_ids == ["a"]
    assert acts["flat.putty_2nd_coat_26"].evidence_details[0]["role"] == "inferred"
    # Service lines are never inferred from a finished surface.
    assert "flat.core_service_lines" not in acts


def test_conflicting_captures_in_one_room_are_flagged():
    per = {"a": {"flat.wall_punning_4": item(10.0, 90.0)}, "b": {"flat.wall_punning_4": item(95.0, 90.0)}}
    r = run(per, [cap("a", "Living"), cap("b", "Living")])
    a = room_acts(r, "Living")["flat.core_punning"]
    assert a.review_required is True
    assert a.completion_pct == 10.0


def test_newer_capture_overrides_an_older_one_in_the_same_room():
    per = {"old": {"flat.wall_punning_4": item(100.0, 90.0)}, "new": {"flat.wall_punning_4": item(30.0, 90.0)}}
    r = run(per, [cap("old", "Living", days_ago=40), cap("new", "Living", days_ago=0)])
    a = room_acts(r, "Living")["flat.core_punning"]
    assert a.completion_pct == 30.0 and a.evidence_capture_ids == ["new"]


def test_scored_captures_and_last_inspection_come_from_the_photos_actually_used():
    r = run({"a": {}}, [cap("a", "Living", days_ago=3), cap("a2", "Living", days_ago=1, pin="p2")])
    assert sorted(r.scored_capture_ids) == ["a", "a2"]
    assert r.last_inspection == NOW - timedelta(days=1)


def test_a_flat_is_not_completed_by_a_few_good_readings():
    per = {"a": {k: item(100.0, 90.0) for k in ("flat.wall_punning_4", "flat.ceiling_punning_2", "flat.floor_screed_1")}}
    r = run(per, [cap("a", "Living")])
    fp = r.flat_progress[0]
    assert fp.is_fully_complete is False and fp.completion_pct < 100.0
