"""v4.2 aggregation + (v5.0) structured-only evidence reconciliation — aggregation + evidence↔score consistency."""
from __future__ import annotations

from app.services.construction_progress_providers.precedence import ENABLE_FILL_FORWARD
from app.services.construction_progress_providers.vllm_provider import (
    PROMPT_VERSION,
    prefer_lower_unit_evidence,
    reconcile_pct_with_evidence,
    rollup_photographed_unit_pcts,
)
from app.services.construction_progress_providers.visual_criteria import VISUAL_CRITERIA


def test_prompt_version_is_v5_family():
    assert PROMPT_VERSION.startswith("v5.")


def test_fill_forward_still_disabled():
    assert ENABLE_FILL_FORWARD is False


def test_a_same_unit_min_wins_over_max():
    """A: capture 100% then 0% for same room → result is 0% (not 100%)."""
    first = prefer_lower_unit_evidence(
        None, pct=100.0, conf=90.0, capture_id="c1", evidence="complete view A",
    )
    merged = prefer_lower_unit_evidence(
        first, pct=0.0, conf=90.0, capture_id="c2", evidence="incomplete view B",
    )
    assert merged["pct"] == 0.0
    assert merged["capture_id"] == "c2"


def test_b_room_complete_plus_incomplete_cannot_be_100():
    """B: one room 100%, another 0% → flat rollup cannot be 100%."""
    rolled = rollup_photographed_unit_pcts([100.0, 0.0])
    assert rolled == 50.0
    assert rolled < 100.0


def test_activity_full_roster_blocks_false_100():
    """Uncaptured applicable rooms count as 0% — cannot Completeness-gate to 100%."""
    from app.services.construction_progress_providers.vllm_provider import (
        rollup_activity_over_roster,
    )
    units = {
        ("Flat 01", "Bedroom-1"): 100.0,
        ("Flat 01", "Bedroom-2"): 100.0,
    }
    roster = [
        ("Flat 01", "Bedroom-1"),
        ("Flat 01", "Bedroom-2"),
        ("Flat 01", "Bedroom-3"),
        ("Flat 01", "Kitchen"),
    ]
    avg, photographed, fully = rollup_activity_over_roster(
        applicable_units=roster,
        units_pct=units,
    )
    assert len(photographed) == 2
    assert fully is False
    assert avg == 50.0
    assert avg < 100.0


def test_activity_full_roster_100_only_when_all_complete():
    from app.services.construction_progress_providers.vllm_provider import (
        rollup_activity_over_roster,
    )
    units = {
        ("Flat 01", "Toilet-1"): 100.0,
        ("Flat 01", "Toilet-2"): 100.0,
    }
    roster = [("Flat 01", "Toilet-1"), ("Flat 01", "Toilet-2")]
    avg, photographed, fully = rollup_activity_over_roster(
        applicable_units=roster,
        units_pct=units,
    )
    assert fully is True
    assert avg == 100.0
    assert len(photographed) == 2


def test_c_combined_window_one_of_three_is_proportional():
    """C: 1 of 3 components ≈ 33% — criteria encodes combined counting."""
    criteria = VISUAL_CRITERIA["flat.window_w3a_utility_door_sld_fixing_20"]
    assert "1 of 3" in criteria or "≈ 33%" in criteria or "33%" in criteria
    assert "COMBINED" in criteria or "combined" in criteria.lower() or "separate" in criteria.lower()


def test_d_free_text_never_rewrites_a_number():
    """D (v5.0): "no boards" in the prose no longer forces 0. Only structured fields may change a number."""
    out = reconcile_pct_with_evidence(
        "flat.false_ceiling_boxing_24",
        50.0,
        "GI framing visible but no gypsum boards are visible in the open section.",
    )
    assert out == 50.0


def test_e_insufficient_stage_evidence_class_is_unknown_not_zero():
    """E (v5.0): the model could not tell the stage -> unknown (None), never 0."""
    assert reconcile_pct_with_evidence(
        "flat.putty_39", 90.0, "cannot distinguish punning from putty",
        evidence_class="INSUFFICIENT_STAGE_EVIDENCE",
    ) is None
    assert reconcile_pct_with_evidence(
        "flat.electrical_wiring_23", 90.0, "", evidence_class="insufficient_stage_evidence",
    ) is None


def test_f_putty_prose_admitting_doubt_is_not_used():
    out = reconcile_pct_with_evidence(
        "flat.putty_39", 70.0, "Smooth white walls; cannot distinguish second coat from first coat.",
    )
    assert out == 70.0


def test_g_wiring_prose_admitting_doubt_is_not_used():
    out = reconcile_pct_with_evidence(
        "flat.electrical_wiring_23", 100.0,
        "All visible boxes have wires but actual wiring completion cannot be confirmed.",
    )
    assert out == 100.0


def test_h_door_frame_criteria_rejects_lookalikes():
    """H: criteria require real openings, not enclosures / look-alikes."""
    criteria = VISUAL_CRITERIA["flat.internal_door_frames_18"]
    assert "enclosure" in criteria.lower() or "look-alike" in criteria.lower() or "look alike" in criteria.lower()
    assert "proportional" in criteria.lower() or "observable required" in criteria.lower()


def test_i_ceiling_punning_not_penalized_for_mep():
    """I: Ceiling Punning criteria must not reduce for wires/MEP alone."""
    criteria = VISUAL_CRITERIA["flat.ceiling_punning_2"]
    assert "Do NOT reduce" in criteria or "do not reduce" in criteria.lower()
    assert "wire" in criteria.lower() or "MEP" in criteria


def test_false_ceiling_v4_1_still_in_criteria():
    framing = VISUAL_CRITERIA["flat.false_ceiling_framing_6"]
    boxing = VISUAL_CRITERIA["flat.false_ceiling_boxing_24"]
    assert "0%" in framing and ("smooth" in framing.lower() or "punned" in framing.lower())
    assert "GI framing alone" in boxing or "boards absent" in boxing.lower() or "Boxing = 0%" in boxing


def test_prefer_lower_keeps_higher_conf_on_tie():
    first = prefer_lower_unit_evidence(
        None, pct=40.0, conf=60.0, capture_id="a", evidence="mid",
    )
    tied = prefer_lower_unit_evidence(
        first, pct=40.0, conf=90.0, capture_id="b", evidence="clearer mid",
    )
    assert tied["pct"] == 40.0
    assert tied["capture_id"] == "b"
    assert tied["conf"] == 90.0


def test_rollup_empty_is_zero():
    assert rollup_photographed_unit_pcts([]) == 0.0
