"""v4.4 area-scope — paint⇒putty already in test_precedence; room activation + rollup."""
from __future__ import annotations

from app.services.construction_progress_providers.activities import (
    ALL_ACTIVITIES,
    FLAT_ACTIVITIES,
    COMMON_AREA_ACTIVITIES,
)
from app.services.construction_progress_providers.base import ActivityDef, FlatProgress
from app.services.construction_progress_providers.precedence import (
    ENABLE_FILL_FORWARD,
    ENABLE_PAINT_IMPLIES_PUTTY,
)
from app.services.construction_progress_providers.vllm_provider import (
    PROMPT_VERSION,
    _activity_applies_to_room,
    _build_flat_progress,
    _status_for_pct,
)


def _by_id(aid: str) -> ActivityDef:
    return next(a for a in ALL_ACTIVITIES if a.activity_id == aid)


def test_prompt_version_is_v4_4():
    assert PROMPT_VERSION == "v4.6-activity-rules"
    assert ENABLE_FILL_FORWARD is False
    assert ENABLE_PAINT_IMPLIES_PUTTY is True


def test_bedroom_does_not_activate_toilet_kitchen_balcony_only():
    bedroom = "Bedroom-2"
    toilet_only = [
        "flat.toilet_grouting_30",
        "flat.toilet_door_frame_9",
        "flat.plumbing_diverter_flush_valve_fixing_10",
        "flat.cp_fixtures_sanitary_fixtures_34",
        "flat.ventilator_fixing_11",
        "flat.kitchen_bracket_fixing_granite_fixing_dado_19",
        "flat.balcony_glass_railing_35",
    ]
    for aid in toilet_only:
        assert not _activity_applies_to_room(_by_id(aid), bedroom), aid


def test_toilet_activates_toilet_and_combined_wet():
    toilet = "M. Toilet"
    assert _activity_applies_to_room(_by_id("flat.toilet_grouting_30"), toilet)
    assert _activity_applies_to_room(_by_id("flat.ventilator_fixing_11"), toilet)
    assert _activity_applies_to_room(_by_id("flat.toilet_utility_balcony_flooring_14"), toilet)
    assert _activity_applies_to_room(_by_id("flat.toilet_sitout_balcony_copings_17"), toilet)
    assert _activity_applies_to_room(_by_id("flat.false_ceiling_in_toilets_sitouts_utilities_28"), toilet)
    assert not _activity_applies_to_room(
        _by_id("flat.kitchen_bracket_fixing_granite_fixing_dado_19"), toilet
    )


def test_corridor_not_staircase_flooring():
    assert _activity_applies_to_room(_by_id("common.corridor_flooring_3"), "Corridor")
    assert not _activity_applies_to_room(_by_id("common.staircase_flooring_8"), "Corridor")
    assert _activity_applies_to_room(_by_id("common.staircase_flooring_8"), "Staircase")
    assert not _activity_applies_to_room(_by_id("common.corridor_flooring_3"), "Staircase")


def test_general_flat_activity_still_applies_everywhere():
    wall = _by_id("flat.wall_punning_4")
    assert wall.applicable_rooms == frozenset()
    assert _activity_applies_to_room(wall, "Living / Dining")
    assert _activity_applies_to_room(wall, "Kitchen")


def test_status_for_pct_unchanged():
    assert _status_for_pct(100.0) == "completed"
    assert _status_for_pct(50.0) == "in_progress"
    assert _status_for_pct(0.0) == "no_evidence"
    assert _status_for_pct(0.0, has_evidence=True) == "in_progress"


def test_flat_progress_counts_unphotographed_rooms_as_zero_in_pct():
    """One observed activity in one room counts only against that room's applicable activities; the two
    unphotographed rooms contribute 0, so a single reading can never carry the flat."""
    from app.services.construction_progress_providers.activities import CORE_FLAT_ACTIVITIES
    from app.services.construction_progress_providers.vllm_provider import _activity_applies_to_room

    activities_by_id = {a.activity_id: a for a in CORE_FLAT_ACTIVITIES}
    aid = "flat.core_punning"
    per_pct = {aid: {("Flat 01", "Bedroom-2"): 40.0}}
    per_conf = {aid: {("Flat 01", "Bedroom-2"): 90.0}}
    per_ev = {aid: {("Flat 01", "Bedroom-2"): "c1"}}
    per_ev_text = {aid: {("Flat 01", "Bedroom-2"): "Walls punned"}}

    flats = _build_flat_progress(
        activities_by_id=activities_by_id,
        per_activity_unit_pct=per_pct,
        per_activity_unit_conf=per_conf,
        per_activity_unit_evidence=per_ev,
        per_activity_unit_evidence_text=per_ev_text,
        flat_room_rosters={"Flat 01": ["Bedroom-2", "M. Toilet", "Kitchen"]},
    )
    assert len(flats) == 1
    fp: FlatProgress = flats[0]
    assert fp.rooms_photographed == 1
    assert fp.rooms_required == 3
    assert fp.rooms_complete == 0
    applicable = sum(1 for a in CORE_FLAT_ACTIVITIES if _activity_applies_to_room(a, "Bedroom-2"))
    # Room progress = 40 / applicable activities (work nobody verified is not counted); flat = mean of 3 rooms.
    assert fp.completion_pct == round(40.0 / applicable / 3, 1)
    assert fp.is_fully_complete is False


def test_status_zero_with_evidence_is_in_progress():
    assert _status_for_pct(0.0, has_evidence=True) == "in_progress"
    assert _status_for_pct(0.0, has_evidence=False) == "no_evidence"
    assert _status_for_pct(100.0, has_evidence=True) == "completed"


def test_floor_finishing_from_flats_not_activity_card_mean():
    from app.services.construction_progress_providers.base import (
        ActivityAssessment,
        FlatProgress,
    )
    from app.services.construction_progress_providers.vllm_provider import (
        rollup_floor_finishing_progress,
    )

    flats = [
        FlatProgress("Flat 01", 10.0, 0, 1, rooms_required=10, rooms_photographed=1),
        FlatProgress("Flat 02", 20.0, 0, 1, rooms_required=10, rooms_photographed=1),
        FlatProgress("Flat 03", 0.0, 0, 0, rooms_required=10, rooms_photographed=0),
    ]
    # High activity-card scores must NOT inflate floor % above flat mean.
    high_acts = [
        ActivityAssessment(
            activity=_by_id("flat.wall_punning_4"),
            status="in_progress",
            completion_pct=90.0,
            confidence_pct=90.0,
        ),
    ]
    overall = rollup_floor_finishing_progress(flats, high_acts)
    # Mean of every flat, uncaptured ones count as 0%: (10 + 20 + 0) / 3.
    assert overall == 10.0


def test_flat_fully_complete_requires_all_required_rooms_and_every_applicable_activity():
    from app.services.construction_progress_providers.activities import CORE_FLAT_ACTIVITIES
    from app.services.construction_progress_providers.vllm_provider import _activity_applies_to_room

    activities_by_id = {a.activity_id: a for a in CORE_FLAT_ACTIVITIES}
    rooms = ["Bedroom-2", "Kitchen"]

    def build(skip_one: bool):
        pct, conf, ev, txt = {}, {}, {}, {}
        for room in rooms:
            unit = ("Flat 01", room)
            for a in CORE_FLAT_ACTIVITIES:
                if not _activity_applies_to_room(a, room):
                    continue
                if skip_one and room == "Kitchen" and a.activity_id == "flat.electrical_wiring_23":
                    continue
                pct.setdefault(a.activity_id, {})[unit] = 100.0
                conf.setdefault(a.activity_id, {})[unit] = 90.0
                ev.setdefault(a.activity_id, {})[unit] = "c1"
                txt.setdefault(a.activity_id, {})[unit] = "ok"
        return _build_flat_progress(
            activities_by_id=activities_by_id,
            per_activity_unit_pct=pct,
            per_activity_unit_conf=conf,
            per_activity_unit_evidence=ev,
            per_activity_unit_evidence_text=txt,
            flat_room_rosters={"Flat 01": rooms},
        )[0]

    done = build(skip_one=False)
    assert done.is_fully_complete is True
    assert done.completion_pct == 100.0
    assert done.rooms_photographed == 2 and done.rooms_required == 2

    # One applicable activity nobody observed in one room: the flat is NOT complete and never reads 100.
    partial = build(skip_one=True)
    assert partial.is_fully_complete is False
    assert partial.rooms_complete == 1
    assert partial.completion_pct < 100.0


def test_common_activities_count_unchanged():
    assert len(COMMON_AREA_ACTIVITIES) == 10
