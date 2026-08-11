"""v4.2 stage-aware evidence engine — aggregation + evidence↔score consistency."""
from __future__ import annotations

from app.services.construction_progress_providers.precedence import ENABLE_FILL_FORWARD
from app.services.construction_progress_providers.vllm_provider import (
    PROMPT_VERSION,
    prefer_lower_unit_evidence,
    reconcile_pct_with_evidence,
    rollup_photographed_unit_pcts,
)
from app.services.construction_progress_providers.visual_criteria import VISUAL_CRITERIA


def test_prompt_version_is_v4_family():
    assert PROMPT_VERSION.startswith("v4.")


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


def test_c_combined_window_one_of_three_is_proportional():
    """C: 1 of 3 components ≈ 33% — criteria encodes combined counting."""
    criteria = VISUAL_CRITERIA["flat.window_w3a_utility_door_sld_fixing_20"]
    assert "1 of 3" in criteria or "≈ 33%" in criteria or "33%" in criteria
    assert "COMBINED" in criteria or "combined" in criteria.lower() or "separate" in criteria.lower()


def test_d_gi_framing_without_boards_boxing_zero():
    """D: evidence says no boards → boxing forced to 0 even if model returned 50%."""
    out = reconcile_pct_with_evidence(
        "flat.false_ceiling_boxing_24",
        50.0,
        "GI framing visible but no gypsum boards are visible in the open section.",
    )
    assert out == 0.0


def test_e_insufficient_putty_1st_evidence_capped():
    """E: white wall + cannot distinguish stage → putty 1st must be 0 (v4.3)."""
    out = reconcile_pct_with_evidence(
        "flat.putty_1st_coat_25",
        90.0,
        "Walls are white and smooth but cannot distinguish punning from first putty.",
    )
    assert out == 0.0


def test_f_putty_2nd_stage_uncertainty_is_zero():
    """F: cannot distinguish 2nd from 1st → Putty 2nd = 0%."""
    out = reconcile_pct_with_evidence(
        "flat.putty_2nd_coat_26",
        70.0,
        "Smooth white walls; cannot distinguish second coat from first coat.",
    )
    assert out == 0.0


def test_g_wiring_insufficient_admission_capped():
    """G: model admits wiring completion cannot be confirmed → not keep 40%+ high."""
    out = reconcile_pct_with_evidence(
        "flat.electrical_wiring_23",
        100.0,
        "All visible boxes have wires but actual wiring completion cannot be confirmed.",
    )
    assert out <= 25.0


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
