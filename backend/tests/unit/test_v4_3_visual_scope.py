"""v4.3 visual-scope aggregation + (v5.0) structured evidence_class mapping (no free-text rewriting)."""
from __future__ import annotations

from app.services.construction_progress_providers.precedence import ENABLE_FILL_FORWARD
from app.services.construction_progress_providers.vllm_provider import (
    COMPLETED_STATUS_PCT,
    PROMPT_VERSION,
    _status_for_pct,
    apply_evidence_class,
    prefer_lower_unit_evidence,
    reconcile_pct_with_evidence,
    rollup_photographed_unit_pcts,
)
from app.services.construction_progress_providers.visual_criteria import VISUAL_CRITERIA


def test_prompt_version_is_v5_family():
    assert PROMPT_VERSION.startswith("v5.")



def test_fill_forward_still_off():
    assert ENABLE_FILL_FORWARD is False


def test_1_white_smooth_prose_does_not_change_a_putty_number():
    # The prose is ignored; the proof gate (indicators_found) is what stops look-alikes.
    out = reconcile_pct_with_evidence(
        "flat.putty_39", 80.0, "Walls are white and smooth with a finished appearance.",
    )
    assert out == 80.0


def test_2_insufficient_stage_evidence_putty_is_unknown():
    assert reconcile_pct_with_evidence(
        "flat.putty_39", 70.0, "Uniform white smooth walls look finished.",
        evidence_class="INSUFFICIENT_STAGE_EVIDENCE",
    ) is None


def test_3_wall_punning_can_remain_high_on_punned_surface():
    # Reconcile must not zero clear punning scope language.
    out = reconcile_pct_with_evidence(
        "flat.wall_punning_4",
        85.0,
        "Approximately 85% of observable wall surface is smooth/punned; small unfinished reveals remain.",
    )
    assert out == 85.0
    criteria = VISUAL_CRITERIA["flat.wall_punning_4"]
    assert "80–90" in criteria or "80-90" in criteria or "punned" in criteria.lower()


def test_4_localized_gi_framing_criteria_partial():
    criteria = VISUAL_CRITERIA["flat.false_ceiling_framing_6"]
    assert "PARTIAL" in criteria or "partial" in criteria.lower() or "Localized" in criteria
    assert "100%" in criteria or "never 100" in criteria.lower()


def test_5_related_infrastructure_class_is_zero():
    assert apply_evidence_class(
        "flat.false_ceiling_boxing_24", 60.0, "RELATED_INFRASTRUCTURE_ONLY",
    ) == 0.0
    # ...but the sentence alone is not.
    assert reconcile_pct_with_evidence(
        "flat.false_ceiling_boxing_24", 60.0, "GI framing visible; no gypsum boards installed.",
    ) == 60.0


def test_6_ceiling_punning_independent_of_mep():
    criteria = VISUAL_CRITERIA["flat.ceiling_punning_2"]
    assert "Do NOT reduce" in criteria or "do not reduce" in criteria.lower()
    out = reconcile_pct_with_evidence(
        "flat.ceiling_punning_2",
        100.0,
        "Entire observable ceiling surface is uniformly smooth and punned; wires hang at service points.",
    )
    assert out == 100.0


def test_7_electrical_prose_is_not_rewritten():
    out = reconcile_pct_with_evidence(
        "flat.electrical_wiring_23", 75.0,
        "Electrical boxes and loose wires are visible at several points.",
    )
    assert out == 75.0


def test_8_material_present_class_is_zero_for_a_shutter():
    assert apply_evidence_class(
        "flat.internal_door_shutter_fixing_with_hardware_22", 50.0, "MATERIAL_PRESENT_ONLY",
    ) == 0.0
    assert reconcile_pct_with_evidence(
        "flat.internal_door_shutter_fixing_with_hardware_22", 50.0,
        "A door shutter is leaning against the wall near the opening.",
    ) == 50.0


def test_9_one_frame_capture_can_be_100():
    criteria = VISUAL_CRITERIA["flat.internal_door_frames_18"]
    assert "Capture-level" in criteria or "capture" in criteria.lower()
    assert "100%" in criteria


def test_10_one_frame_plus_bare_openings_not_flat_100():
    rolled = rollup_photographed_unit_pcts([100.0, 0.0, 0.0])
    assert rolled < 100.0
    assert abs(rolled - (100.0 / 3.0)) < 0.01


def test_11_window_material_present_class_is_zero():
    assert apply_evidence_class(
        "flat.window_w3a_utility_door_sld_fixing_20", 40.0, "MATERIAL_PRESENT_ONLY",
    ) == 0.0
    assert apply_evidence_class(
        "flat.windows_43", 40.0, "NOT_OBSERVABLE",
    ) == 0.0


def test_12_combined_window_proportional_criteria():
    criteria = VISUAL_CRITERIA["flat.window_w3a_utility_door_sld_fixing_20"]
    assert "33%" in criteria
    assert "COMBINED" in criteria or "combined" in criteria.lower()


def test_13_large_unfinished_wall_criteria_blocks_90():
    criteria = VISUAL_CRITERIA["flat.wall_punning_4"]
    assert "not 90" in criteria.lower() or "Large unfinished" in criteria


def test_14_smooth_ceiling_plus_mep_not_reduced():
    criteria = VISUAL_CRITERIA["flat.ceiling_punning_2"]
    assert "MEP" in criteria or "wires" in criteria.lower()


def test_15_confirmed_and_partial_classes_keep_the_number():
    for cls in ("CONFIRMED_INSTALLED", "PARTIALLY_INSTALLED", ""):
        assert apply_evidence_class("flat.electrical_wiring_23", 55.0, cls) == 55.0


def test_evidence_class_insufficient_stage_is_unknown_for_every_activity():
    for aid in ("flat.putty_39", "flat.paint_40", "flat.wall_punning_4", "common.putty_10"):
        assert apply_evidence_class(aid, 65.0, "INSUFFICIENT_STAGE_EVIDENCE") is None


def test_status_completed_only_at_100():
    assert COMPLETED_STATUS_PCT == 100.0
    assert _status_for_pct(90.0) == "in_progress"
    assert _status_for_pct(100.0) == "completed"
    assert _status_for_pct(0.0) == "no_evidence"


def test_min_aggregation_preserved():
    first = prefer_lower_unit_evidence(
        None, pct=100.0, conf=90.0, capture_id="a", evidence="done",
    )
    merged = prefer_lower_unit_evidence(
        first, pct=20.0, conf=90.0, capture_id="b", evidence="partial",
    )
    assert merged["pct"] == 20.0
