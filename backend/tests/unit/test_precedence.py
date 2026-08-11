"""T8 / v4.4 — paint⇒putty, block-backward, MEP door gate."""
from __future__ import annotations

from app.services.construction_progress_providers.precedence import (
    COMPLETE_THRESHOLD,
    COMPLETED_STATUS_PCT,
    ENABLE_FILL_FORWARD,
    ENABLE_PAINT_IMPLIES_PUTTY,
    WALL_FINISH_CHAIN,
    apply_precedence,
    sequence_violation_pairs,
)


def test_fill_forward_still_off_but_paint_implies_putty_on():
    assert ENABLE_FILL_FORWARD is False
    assert ENABLE_PAINT_IMPLIES_PUTTY is True


def test_final_coat_complete_fills_putty_not_wall_punning():
    room = {
        "flat.wall_punning_4": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.putty_1st_coat_25": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.putty_2nd_coat_26": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.primer_1st_coat_paint_27": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.final_coat_paint_37": {"completionPct": 100.0, "status": "completed"},
    }
    out = apply_precedence(room)

    assert out["flat.final_coat_paint_37"]["completionPct"] == 100.0
    assert out["flat.putty_1st_coat_25"]["completionPct"] == 100.0
    assert out["flat.putty_2nd_coat_26"]["completionPct"] == 100.0
    # Paint does not invent wall punning.
    assert out["flat.wall_punning_4"]["completionPct"] == 0.0


def test_primer_complete_fills_putty():
    room = {
        "flat.putty_1st_coat_25": {"completionPct": 40.0, "status": "in_progress"},
        "flat.putty_2nd_coat_26": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.primer_1st_coat_paint_27": {"completionPct": 100.0, "status": "completed"},
        "flat.final_coat_paint_37": {"completionPct": 0.0, "status": "no_evidence"},
    }
    out = apply_precedence(room)
    assert out["flat.putty_1st_coat_25"]["completionPct"] == 100.0
    assert out["flat.putty_2nd_coat_26"]["completionPct"] == 100.0
    # Putty must not invent final paint.
    assert out["flat.final_coat_paint_37"]["completionPct"] == 0.0


def test_putty_complete_does_not_fill_paint():
    room = {
        "flat.putty_1st_coat_25": {"completionPct": 100.0, "status": "completed"},
        "flat.putty_2nd_coat_26": {"completionPct": 100.0, "status": "completed"},
        "flat.primer_1st_coat_paint_27": {"completionPct": 0.0, "status": "no_evidence"},
        "flat.final_coat_paint_37": {"completionPct": 0.0, "status": "no_evidence"},
    }
    out = apply_precedence(room)
    assert out["flat.primer_1st_coat_paint_27"]["completionPct"] == 0.0
    assert out["flat.final_coat_paint_37"]["completionPct"] == 0.0


def test_block_backward_does_not_zero_evidenced_paint():
    """In-progress paint with putty at 0 must survive (assess putty independently)."""
    room = {
        "flat.wall_punning_4": {"completion_pct": 50.0},
        "flat.putty_1st_coat_25": {"completion_pct": 0.0},
        "flat.putty_2nd_coat_26": {"completion_pct": 0.0},
        "flat.primer_1st_coat_paint_27": {"completion_pct": 40.0},
        "flat.final_coat_paint_37": {"completion_pct": 0.0},
    }
    out = apply_precedence(room)
    assert out["flat.primer_1st_coat_paint_27"]["completion_pct"] == 40.0


def test_block_backward_zeros_non_paint_downstream_when_upstream_not_started():
    room = {
        "flat.wall_punning_4": {"completion_pct": 0.0},
        "flat.putty_1st_coat_25": {"completion_pct": 0.0},
        "flat.putty_2nd_coat_26": {"completion_pct": 55.0},
        "flat.primer_1st_coat_paint_27": {"completion_pct": 0.0},
        "flat.final_coat_paint_37": {"completion_pct": 0.0},
    }
    out = apply_precedence(room)
    assert out["flat.putty_2nd_coat_26"]["completion_pct"] == 0.0


def test_common_paint_implies_common_putty():
    room = {
        "common.putty_1st_coat_4": {"completionPct": 0.0},
        "common.putty_2nd_coat_5": {"completionPct": 0.0},
        "common.primer_1st_coat_paint_6": {"completionPct": 100.0},
        "common.painting_2nd_coat_9": {"completionPct": 0.0},
    }
    out = apply_precedence(room)
    assert out["common.putty_1st_coat_4"]["completionPct"] == 100.0
    assert out["common.putty_2nd_coat_5"]["completionPct"] == 100.0
    assert out["common.painting_2nd_coat_9"]["completionPct"] == 0.0


def test_mep_zeroed_when_doors_incomplete():
    room = {
        "flat.mep_ceiling_services_plumbing_fire_gas_3": {"completionPct": 100.0},
        "flat.main_door_shutter_fixing_temporary_21": {"completionPct": 10.0},
        "flat.internal_door_shutter_fixing_with_hardware_22": {"completionPct": 0.0},
    }
    out = apply_precedence(room)
    assert out["flat.mep_ceiling_services_plumbing_fire_gas_3"]["completionPct"] == 0.0


def test_mep_kept_when_any_door_complete():
    room = {
        "flat.mep_ceiling_services_plumbing_fire_gas_3": {"completionPct": 100.0},
        "flat.main_door_shutter_fixing_temporary_21": {"completionPct": 95.0},
        "flat.internal_door_shutter_fixing_with_hardware_22": {"completionPct": 0.0},
    }
    out = apply_precedence(room)
    assert out["flat.mep_ceiling_services_plumbing_fire_gas_3"]["completionPct"] == 100.0
    assert COMPLETE_THRESHOLD == 92.0
    assert COMPLETED_STATUS_PCT == 100.0


def test_sequence_violation_pairs_cover_wall_chain_and_mep_doors():
    pairs = sequence_violation_pairs()
    assert ("flat.putty_1st_coat_25", "flat.final_coat_paint_37") in pairs
    assert ("flat.wall_punning_4", "flat.final_coat_paint_37") in pairs
    assert (
        "flat.main_door_shutter_fixing_temporary_21",
        "flat.mep_ceiling_services_plumbing_fire_gas_3",
    ) in pairs
    assert WALL_FINISH_CHAIN[0] == "flat.wall_punning_4"
    assert WALL_FINISH_CHAIN[-1] == "flat.final_coat_paint_37"
