"""v5.0 scope + proof: no free-text rewriting, stage-unknown, proof gate, present-first, scope drop, core lists."""
import asyncio
from datetime import datetime, timezone

import pytest

from app.services.construction_progress_providers import activity_rules as ar
from app.services.construction_progress_providers.activities import (
    CORE_ACTIVITIES,
    CORE_COMMON_ACTIVITIES,
    CORE_FLAT_ACTIVITIES,
    CORE_IDS,
    FROZEN_CORE_COMMON_IDS,
    FROZEN_CORE_FLAT_IDS,
    FROZEN_ALL_IDS,
    scope_filtered_core,
)
from app.services.construction_progress_providers.base import CaptureRef
from app.services.construction_progress_providers.vllm_provider import (
    _SYSTEM_PROMPT,
    PROMPT_VERSION,
    VllmConstructionProgressProvider,
    parse_assessment_items,
    passes_proof_gate,
)

NOW = datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc)
BOXING = "flat.false_ceiling_boxing_24"
PUTTY = "flat.putty_39"
PAINT = "flat.paint_40"


def parse(aid, **fields):
    item = {"activity_id": aid, "state": "completed", "confidence": "high", "evidence_class": "CONFIRMED_INSTALLED",
            "indicators_found": [], "explanation": "x"}
    item.update(fields)
    return parse_assessment_items({"assessments": [item]}, valid_ids={aid}).get(aid)


# -- (a) no free-text rewriting ---------------------------------------------------------------------------

def test_prose_with_doubt_words_does_not_change_the_number():
    out = parse(
        BOXING, indicators_found=["board joints", "screw heads"],
        explanation="No gypsum boards are missing, but I cannot confirm every bay; insufficient light.",
    )
    assert out["completion_pct"] == 100.0 and out["gate"] == ""


def test_in_progress_band_survives_look_alike_sentences():
    out = parse(PUTTY, state="in_progress", scope_done_band="26-50", indicators_found=["putty patches"],
                explanation="Walls are white and smooth and look finished.")
    assert out["completion_pct"] == 38.0


def test_insufficient_stage_evidence_is_unknown_not_zero():
    for aid, found in ((PUTTY, ["putty patches"]), ("flat.wall_punning_4", ["plaster"]), (BOXING, ["board joints"])):
        out = parse(aid, evidence_class="INSUFFICIENT_STAGE_EVIDENCE", indicators_found=found)
        assert out["completion_pct"] is None and out["state"] == "unable_to_determine" and out["gate"] == "stage"


def test_material_related_and_not_observable_classes_still_zero_or_drop():
    assert parse(PAINT, evidence_class="MATERIAL_PRESENT_ONLY", indicators_found=["paint cans"])["completion_pct"] == 0.0
    assert parse(PAINT, evidence_class="RELATED_INFRASTRUCTURE_ONLY")["completion_pct"] == 0.0
    assert parse(PAINT, evidence_class="NOT_OBSERVABLE") is None


# -- (b) proof gate -----------------------------------------------------------------------------------------

def test_smooth_white_ceiling_claim_becomes_unknown():
    out = parse(BOXING, indicators_found=["smooth surface", "painted ceiling", "no visible grid or hangers"])
    assert out["completion_pct"] is None
    assert out["gate"] == "proof" and out["state"] == "unable_to_determine"
    assert out["explanation"].startswith("Not enough visible proof of False Ceiling Boxing")


def test_false_ceiling_with_real_proof_is_kept():
    for found in (["board joints"], ["GI grid and channels"], ["access panel in the ceiling"], ["cove light cut-out"],
                  ["gypsum board with screw heads"]):
        assert parse(BOXING, indicators_found=found)["completion_pct"] == 100.0, found


def test_negated_proof_does_not_count():
    assert passes_proof_gate(BOXING, 100.0, ["no board joints visible"]) is False
    assert passes_proof_gate(BOXING, 100.0, ["without grid", "not visible: channel"]) is False
    assert passes_proof_gate(BOXING, 100.0, ["board joints"]) is True


def test_gate_never_turns_zero_or_unknown_into_anything_else():
    assert passes_proof_gate(BOXING, 0.0, []) is True
    assert passes_proof_gate(BOXING, None, []) is True
    out = parse(BOXING, state="not_started", evidence_class="CONFIRMED_INSTALLED", indicators_found=[])
    assert out["completion_pct"] == 0.0 and out["gate"] == ""


def test_putty_and_paint_need_their_own_words():
    assert parse(PUTTY, indicators_found=["smooth white wall"])["completion_pct"] is None
    assert parse(PUTTY, indicators_found=["trowel marks"])["completion_pct"] == 100.0
    assert parse(PAINT, indicators_found=["white wall", "even finish"])["completion_pct"] is None
    assert parse(PAINT, indicators_found=["roller cut-in line"])["completion_pct"] == 100.0


def test_every_rule_gate_rejects_an_empty_indicator_list():
    for rid in ar.RULES:
        assert passes_proof_gate(rid, 50.0, []) is False, rid
        assert passes_proof_gate(rid, 50.0, [ar.RULES[rid].proof_indicators[0]]) is True, rid


# -- (c) present first --------------------------------------------------------------------------------------

@pytest.mark.parametrize("present", ["no", "unclear", "maybe"])
def test_present_not_yes_is_unknown(present):
    out = parse(PAINT, present=present, indicators_found=["roller marks"])
    assert out["completion_pct"] is None and out["gate"] == "present" and out["state"] == "unable_to_determine"


def test_present_yes_keeps_the_reading_and_absent_field_is_not_gated():
    assert parse(PAINT, present="yes", indicators_found=["roller marks"])["completion_pct"] == 100.0
    assert parse(PAINT, indicators_found=["roller marks"])["completion_pct"] == 100.0


def test_not_started_with_present_no_stays_zero():
    out = parse(PAINT, state="not_started", present="no")
    assert out["completion_pct"] == 0.0


def test_prompt_asks_for_present_and_version_is_bumped():
    assert '"present"' in _SYSTEM_PROMPT and "PRESENT FIRST" in _SYSTEM_PROMPT
    assert PROMPT_VERSION == "v5.0-scope-proof"


# -- core lists / frozen ids -----------------------------------------------------------------------------------

def test_core_lists_are_sixteen_flat_and_five_common():
    assert len(CORE_FLAT_ACTIVITIES) == 16 and len(CORE_COMMON_ACTIVITIES) == 5 and len(CORE_ACTIVITIES) == 21
    assert FROZEN_CORE_FLAT_IDS == (
        "flat.floor_screed_1", "flat.core_service_lines", "flat.core_punning", "flat.gypsum_41",
        "flat.waterproofing_8", "flat.toilet_utility_balcony_flooring_14", "flat.toilet_utility_dado_15",
        "flat.vitrified_flooring_16", "flat.internal_door_frames_18", "flat.core_door_shutters_temporary",
        "flat.windows_43", "flat.railing_42", "flat.false_ceiling_boxing_24", "flat.electrical_wiring_23",
        "flat.putty_39", "flat.paint_40",
    )
    assert FROZEN_CORE_COMMON_IDS == (
        "common.mep_works_fire_fighting_electrical_0", "common.wall_punning_works_1",
        "common.false_ceiling_works_2", "common.putty_10", "common.paint_11",
    )


def test_old_coat_ids_left_core_but_stay_in_the_catalogue():
    old = {"flat.putty_1st_coat_25", "flat.putty_2nd_coat_26", "flat.primer_1st_coat_paint_27",
           "common.putty_1st_coat_4", "common.putty_2nd_coat_5", "common.primer_1st_coat_paint_6"}
    assert not old & CORE_IDS
    assert old <= FROZEN_ALL_IDS


def test_railing_is_scoped_to_open_edge_rooms_only():
    railing = next(a for a in CORE_ACTIVITIES if a.activity_id == "flat.railing_42")
    from app.services.construction_progress_providers.vllm_provider import _activity_applies_to_room
    assert _activity_applies_to_room(railing, "Balcony")
    assert _activity_applies_to_room(railing, "Utility")
    assert _activity_applies_to_room(railing, "Sit-out")
    assert not _activity_applies_to_room(railing, "Master Bedroom")
    assert not _activity_applies_to_room(railing, "Toilet-1")


def test_scope_filtered_core():
    assert [a.activity_id for a in scope_filtered_core(None)] == [a.activity_id for a in CORE_ACTIVITIES]
    picked = scope_filtered_core(["flat.paint_40", "flat.floor_screed_1", "legacy.nope", "flat.putty_1st_coat_25"])
    assert [a.activity_id for a in picked] == ["flat.floor_screed_1", "flat.paint_40"]   # core order, junk ignored
    assert scope_filtered_core([]) == []


# -- scope: unselected activities never reach the result ---------------------------------------------------------

def _run(per_capture, activities, room="Living"):
    provider = VllmConstructionProgressProvider()

    async def fake(capture, acts, **_):
        return per_capture

    provider._assess_capture = fake  # type: ignore[method-assign]
    caps = [CaptureRef(capture_id="a", pin_id="a", room_name=room, flat_name="Flat 1", captured_at=NOW, image_url="x")]
    return asyncio.run(provider.assess_floor_progress(
        floor_id="f", activities=activities, captures=caps, as_of=NOW, flat_room_rosters={"Flat 1": [room]},
    ))


def _item(pct):
    return {"completion_pct": pct, "confidence_pct": 90.0, "evidence": "e", "explanation": "e",
            "indicators_found": ["x"], "indicators_missing": [], "views": [], "evidence_class": "CONFIRMED_INSTALLED"}


def _room_ids(result):
    return {a.activity_id for fp in result.flat_progress for r in fp.rooms for a in r.activities}


def test_unselected_activity_returned_by_the_model_is_dropped():
    selected = scope_filtered_core(["flat.floor_screed_1", PUTTY])
    r = _run({"flat.floor_screed_1": _item(100.0), PUTTY: _item(40.0), "flat.railing_42": _item(100.0),
              "flat.gypsum_41": _item(80.0), PAINT: _item(90.0)}, selected, room="Balcony")
    assert {a.activity.activity_id for a in r.activities} == {"flat.floor_screed_1", PUTTY}
    assert _room_ids(r) <= {"flat.floor_screed_1", PUTTY}
    assert "flat.railing_42" not in _room_ids(r) and PAINT not in _room_ids(r)


def test_inference_cannot_resurrect_an_unselected_activity():
    # Paint selected only: putty and wall punning would be inferred from it, but neither was selected.
    r = _run({PAINT: _item(90.0)}, scope_filtered_core([PAINT]))
    assert {a.activity.activity_id for a in r.activities} == {PAINT}
    assert _room_ids(r) == {PAINT}


def test_default_scope_none_scores_everything():
    r = _run({PAINT: _item(90.0)}, scope_filtered_core(None))
    assert {a.activity.activity_id for a in r.activities} == CORE_IDS
    assert PUTTY in _room_ids(r)      # inferred from paint, and selected
