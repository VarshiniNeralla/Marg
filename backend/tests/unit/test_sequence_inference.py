"""Later directly-detected stages may prove earlier ones - flagged as INFERRED, never over-reaching."""
from app.services.construction_progress_providers.sequence_inference import apply_sequence_inference

WP = "flat.wall_punning_4"
CP = "flat.ceiling_punning_2"
P1 = "flat.putty_1st_coat_25"
P2 = "flat.putty_2nd_coat_26"
PR = "flat.primer_1st_coat_paint_27"
SCREED = "flat.floor_screed_1"
WPF = "flat.waterproofing_8"
TF = "flat.toilet_utility_balcony_flooring_14"
VF = "flat.vitrified_flooring_16"
SL3 = "flat.mep_ceiling_services_plumbing_fire_gas_3"
SL7 = "flat.plumbing_pvc_waterline_7"
IDF = "flat.internal_door_frames_18"
IDS = "flat.internal_door_shutter_fixing_with_hardware_22"


def e(pct, conf=90.0, cap="c1", **kw):
    d = {
        "pct": pct, "conf": conf, "capture_id": cap, "evidence": "seen", "evidence_ids": [cap] if pct else [],
        "detection": "direct", "status": "in_progress", "indicators_found": [], "indicators_missing": [],
        "explanation": "", "views": [], "review_required": False, "review_reason": "", "last_captured_at": None,
    }
    d.update(kw)
    return d


def test_primer_proves_putty_and_punning_as_inferred_not_direct():
    unit = {PR: e(80.0, cap="p")}
    inferred = apply_sequence_inference(unit)
    for aid in (P2, P1, WP):
        assert unit[aid]["pct"] == 80.0
        assert unit[aid]["detection"] == "inferred"
        assert unit[aid]["evidence_ids"] == ["p"]           # the driver's photo, labelled inferred
        assert "Inferred" in unit[aid]["evidence"]
    assert PR not in inferred and unit[PR]["detection"] == "direct"


def test_inference_never_invents_a_later_stage():
    unit = {P1: e(100.0)}
    apply_sequence_inference(unit)
    assert P2 not in unit and PR not in unit
    assert WP in unit                                          # earlier one is allowed


def test_concealed_service_lines_are_never_inferred_from_finishes():
    unit = {PR: e(100.0), TF: e(100.0)}
    apply_sequence_inference(unit)
    assert SL3 not in unit and SL7 not in unit


def test_laid_tiles_prove_screed_and_waterproofing_but_not_unrelated_work():
    unit = {TF: e(100.0)}
    apply_sequence_inference(unit)
    assert unit[SCREED]["detection"] == "inferred" and unit[SCREED]["pct"] == 100.0
    assert unit[WPF]["detection"] == "inferred"
    assert "flat.electrical_wiring_23" not in unit and VF not in unit


def test_dry_room_flooring_proves_screed_only():
    unit = {VF: e(60.0)}
    apply_sequence_inference(unit)
    assert unit[SCREED]["pct"] == 60.0 and WPF not in unit


def test_hidden_earlier_stage_with_a_low_direct_reading_is_raised_and_the_direct_value_kept():
    unit = {PR: e(90.0, cap="p"), WP: e(30.0, cap="w")}
    apply_sequence_inference(unit)
    assert unit[WP]["pct"] == 90.0 and unit[WP]["detection"] == "inferred"
    assert unit[WP]["direct_pct"] == 30.0


def test_a_higher_direct_reading_is_never_lowered_by_inference():
    unit = {PR: e(40.0), P1: e(100.0, cap="x")}
    apply_sequence_inference(unit)
    assert unit[P1]["pct"] == 100.0 and unit[P1]["detection"] == "direct"


def test_visible_earlier_stage_that_contradicts_the_later_one_is_flagged_not_overridden():
    unit = {IDS: e(100.0, cap="s"), IDF: e(0.0, cap="f")}
    apply_sequence_inference(unit)
    assert unit[IDF]["pct"] == 0.0 and unit[IDF]["detection"] == "direct"
    assert unit[IDF]["review_required"] and "conflict" in unit[IDF]["review_reason"].lower()
    assert unit[IDS]["review_required"]


def test_unreliable_drivers_do_not_infer():
    unit = {PR: e(100.0, conf=30.0)}
    apply_sequence_inference(unit)
    assert P2 not in unit


def test_zero_or_unknown_drivers_do_not_infer():
    unit = {PR: e(0.0), P2: e(None, 60.0)}
    apply_sequence_inference(unit)
    assert P1 not in unit and WP not in unit


def test_common_area_chain_uses_its_own_ids():
    unit = {"common.primer_1st_coat_paint_6": e(70.0, cap="z")}
    apply_sequence_inference(unit)
    assert unit["common.putty_2nd_coat_5"]["pct"] == 70.0
    assert unit["common.wall_punning_works_1"]["detection"] == "inferred"
