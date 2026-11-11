"""The 14 core activities: catalog shape, component merge, room scoping, floor chains."""
from app.services.construction_progress_providers.activities import (
    ALL_ACTIVITIES,
    CORE_ACTIVITIES,
    CORE_COMMON_ACTIVITIES,
    CORE_FLAT_ACTIVITIES,
    FROZEN_ALL_IDS,
    SCORING_ACTIVITIES,
    activities_as_dicts,
)
from app.services.construction_progress_providers.precedence import apply_precedence
from app.services.construction_progress_providers.vllm_provider import (
    _activity_applies_to_room,
    _merge_components_per_unit,
)

EXPECTED_FLAT = [
    "Screed Works", "Service Lines", "Punning Works", "Waterproofing Works",
    "Toilet Flooring Works", "Toilet Dado Works", "Vitrified Flooring Works",
    "Internal Door Frames", "Door Shutters (Temporary)", "False Ceiling Boxing",
    "Electrical Wiring", "1st Coat Putty", "2nd Coat Putty", "Primer & 1st Coat Paint",
]


def _by_name(name):
    return next(a for a in CORE_FLAT_ACTIVITIES if a.name == name)


def test_core_flat_catalog_is_exactly_the_fourteen_in_site_order():
    assert [a.name for a in CORE_FLAT_ACTIVITIES] == EXPECTED_FLAT
    assert [a.sequence_index for a in CORE_FLAT_ACTIVITIES] == list(range(14))


def test_core_common_catalog():
    assert [a.name for a in CORE_COMMON_ACTIVITIES] == [
        "Service Lines", "Punning Works", "False Ceiling Boxing",
        "1st Coat Putty", "2nd Coat Putty", "Primer & 1st Coat Paint",
    ]


def test_every_core_activity_is_observable_and_ids_are_unique():
    assert all(a.observability == "observable" for a in CORE_ACTIVITIES)
    ids = [a.activity_id for a in CORE_ACTIVITIES]
    assert len(ids) == len(set(ids))


def test_reused_ids_keep_history_and_merged_ones_are_new():
    reused = [a for a in CORE_ACTIVITIES if not a.components]
    assert all(a.activity_id in FROZEN_ALL_IDS for a in reused)
    merged = {a.activity_id: a.components for a in CORE_ACTIVITIES if a.components}
    assert set(merged) == {"flat.core_service_lines", "flat.core_punning", "flat.core_door_shutters_temporary"}
    for comps in merged.values():
        assert all(c in FROZEN_ALL_IDS for c in comps)


def test_scoring_set_is_components_only_with_no_other_legacy_activity():
    ids = {a.activity_id for a in SCORING_ACTIVITIES}
    assert "flat.ceiling_punning_2" in ids and "flat.wall_punning_4" in ids
    assert "flat.core_punning" not in ids
    assert "flat.final_coat_paint_37" not in ids and "flat.deep_cleaning_38" not in ids
    assert all(a.observability == "observable" for a in SCORING_ACTIVITIES)


def test_visually_checkable_early_works_are_no_longer_concealed():
    by_id = {a.activity_id: a for a in ALL_ACTIVITIES}
    for aid in ("flat.floor_screed_1", "flat.waterproofing_8",
                "flat.mep_ceiling_services_plumbing_fire_gas_3", "flat.plumbing_pvc_waterline_7"):
        assert by_id[aid].observability == "observable"


def test_vitrified_flooring_never_applies_to_wet_rooms_and_toilet_flooring_only_to_toilets():
    vit = _by_name("Vitrified Flooring Works")
    tfl = _by_name("Toilet Flooring Works")
    dado = _by_name("Toilet Dado Works")
    for wet in ("Toilet", "M. Toilet", "Utility", "Balcony"):
        assert not _activity_applies_to_room(vit, wet)
    for dry in ("Living Room", "Master Bedroom", "Kitchen"):
        assert _activity_applies_to_room(vit, dry)
    assert _activity_applies_to_room(tfl, "Toilet-2") and _activity_applies_to_room(dado, "M. Toilet")
    assert not _activity_applies_to_room(tfl, "Living Room")
    assert not _activity_applies_to_room(dado, "Balcony")


def test_waterproofing_applies_to_wet_areas_only():
    wp = _by_name("Waterproofing Works")
    assert _activity_applies_to_room(wp, "Toilet") and _activity_applies_to_room(wp, "Balcony")
    assert not _activity_applies_to_room(wp, "Master Bedroom")


def _entry(pct, conf=60.0, cap="c", ev="e"):
    return {"pct": pct, "conf": conf, "capture_id": cap, "evidence": ev}


def test_merge_averages_visible_components_and_drops_everything_else():
    unit = ("Flat 1", "Living Room")
    best = {unit: {
        "flat.ceiling_punning_2": _entry(100.0, 90.0, "c1"),
        "flat.wall_punning_4": _entry(50.0, 60.0, "c2"),
        "flat.final_coat_paint_37": _entry(0.0),
        "flat.putty_1st_coat_25": _entry(20.0),
    }}
    _merge_components_per_unit(best, CORE_FLAT_ACTIVITIES)
    m = best[unit]
    assert m["flat.core_punning"]["pct"] == 75.0
    assert m["flat.core_punning"]["conf"] == 60.0            # weakest component
    assert m["flat.core_punning"]["capture_id"] == "c1"      # strongest evidence
    assert set(m) == {"flat.core_punning", "flat.putty_1st_coat_25"}   # components + non-core removed


def test_merge_treats_an_unseen_component_as_unknown_not_zero():
    unit = ("Flat 1", "Bedroom")
    best = {unit: {"flat.internal_door_shutter_fixing_with_hardware_22": _entry(100.0)}}
    _merge_components_per_unit(best, CORE_FLAT_ACTIVITIES)
    assert best[unit]["flat.core_door_shutters_temporary"]["pct"] == 100.0


def test_merge_leaves_a_unit_without_any_component_alone():
    unit = ("Flat 1", "Kitchen")
    best = {unit: {"flat.putty_2nd_coat_26": _entry(10.0)}}
    _merge_components_per_unit(best, CORE_FLAT_ACTIVITIES)
    assert "flat.core_punning" not in best[unit]


def _room(**pcts):
    return {k: {"completionPct": v, "confidencePct": 60.0} for k, v in pcts.items()}


def test_laid_toilet_tiles_credit_screed_and_waterproofing():
    out = apply_precedence(_room(**{"flat.toilet_utility_balcony_flooring_14": 100.0}))
    assert out["flat.floor_screed_1"]["completionPct"] == 100.0
    assert out["flat.waterproofing_8"]["completionPct"] == 100.0


def test_laid_vitrified_credits_screed_but_not_waterproofing():
    out = apply_precedence(_room(**{"flat.vitrified_flooring_16": 60.0}))
    assert out["flat.floor_screed_1"]["completionPct"] == 60.0
    assert "flat.waterproofing_8" not in out


def test_screed_alone_never_invents_tiles():
    out = apply_precedence(_room(**{"flat.floor_screed_1": 100.0}))
    assert out.get("flat.vitrified_flooring_16", {}).get("completionPct", 0.0) == 0.0


def test_dicts_list_core_first_then_legacy_flagged():
    rows = activities_as_dicts()
    core_rows = [r for r in rows if r["core"]]
    assert len(core_rows) == len(CORE_ACTIVITIES) == 20
    assert rows[: len(core_rows)] == core_rows
    assert all(not r["core"] for r in rows[len(core_rows):])
