"""
Predefined finishing-activity checklist for AI Construction Progress Monitoring.

This is the single source of truth for what gets scored per floor — both the
mock provider (mock_provider.py) and the frontend (via GET
/construction-progress/activities) read from this list, so there is never a
second copy to keep in sync.

`sequence_index` reflects the REAL construction order these activities
happen in on site (as given in the product requirement doc) — the mock
provider's progress-cursor model relies on this ordering to make early
activities mock as more complete than later ones.

Activity IDs are FROZEN literals (T6). Never renumber or regenerate from list
index — inserting a new activity must append a new id without renaming any
existing one, or stored snapshots orphan.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.construction_progress_providers.visual_criteria import VISUAL_CRITERIA


@dataclass(frozen=True)
class ActivityDef:
    activity_id: str
    name: str
    section: str  # "flat" | "common"
    sequence_index: int
    observability: str = "observable"  # observable | concealed | document_only
    surface_group: str = "walls"  # ceiling|walls|floor|openings|fixtures|cleanliness
    applicable_rooms: frozenset[str] = frozenset()  # empty = all rooms
    visual_criteria: str = ""
    confusable_with: tuple[str, ...] = ()
    weight: float = 1.0


# ── Frozen ID tables (T6) — do not renumber ─────────────────────────────────
# Exact set asserted by tests/unit/test_activity_ids_frozen.py

FROZEN_FLAT_IDS: tuple[str, ...] = (
    "flat.corecutting_for_services_0",
    "flat.floor_screed_1",
    "flat.ceiling_punning_2",
    "flat.mep_ceiling_services_plumbing_fire_gas_3",
    "flat.wall_punning_4",
    "flat.main_door_frame_5",
    "flat.false_ceiling_framing_6",
    "flat.plumbing_pvc_waterline_7",
    "flat.waterproofing_8",
    "flat.toilet_door_frame_9",
    "flat.plumbing_diverter_flush_valve_fixing_10",
    "flat.ventilator_fixing_11",
    "flat.ledge_wall_12",
    "flat.ms_railing_for_utility_13",
    "flat.toilet_utility_balcony_flooring_14",
    "flat.toilet_utility_dado_15",
    "flat.vitrified_flooring_16",
    "flat.toilet_sitout_balcony_copings_17",
    "flat.internal_door_frames_18",
    "flat.kitchen_bracket_fixing_granite_fixing_dado_19",
    "flat.window_w3a_utility_door_sld_fixing_20",
    "flat.main_door_shutter_fixing_temporary_21",
    "flat.internal_door_shutter_fixing_with_hardware_22",
    "flat.electrical_wiring_23",
    "flat.false_ceiling_boxing_24",
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
    "flat.primer_1st_coat_paint_27",
    "flat.false_ceiling_in_toilets_sitouts_utilities_28",
    "flat.normal_cleaning_29",
    "flat.toilet_grouting_30",
    "flat.modular_switches_sockets_signal_booster_fixing_31",
    "flat.fa_fixing_32",
    "flat.gas_meter_fixing_33",
    "flat.cp_fixtures_sanitary_fixtures_34",
    "flat.balcony_glass_railing_35",
    "flat.main_door_internal_door_polishing_36",
    "flat.final_coat_paint_37",
    "flat.deep_cleaning_38",
)

FROZEN_COMMON_IDS: tuple[str, ...] = (
    "common.mep_works_fire_fighting_electrical_0",
    "common.wall_punning_works_1",
    "common.false_ceiling_works_2",
    "common.corridor_flooring_3",
    "common.putty_1st_coat_4",
    "common.putty_2nd_coat_5",
    "common.primer_1st_coat_paint_6",
    "common.fire_doors_shaft_doors_7",
    "common.staircase_flooring_8",
    "common.painting_2nd_coat_9",
)

FROZEN_ALL_IDS: frozenset[str] = frozenset(FROZEN_FLAT_IDS) | frozenset(FROZEN_COMMON_IDS)

_FLAT_ACTIVITY_NAMES = [
    "Corecutting for Services",
    "Floor Screed",
    "Ceiling Punning",
    "MEP Ceiling Services (Plumbing, Fire, Gas)",
    "Wall Punning",
    "Main Door Frame",
    "False Ceiling Framing",
    "Plumbing (PVC & Waterline)",
    "Waterproofing",
    "Toilet Door Frame",
    "Plumbing Diverter & Flush Valve Fixing",
    "Ventilator Fixing",
    "Ledge Wall",
    "MS Railing for Utility",
    "Toilet, Utility & Balcony Flooring",
    "Toilet & Utility Dado",
    "Vitrified Flooring",
    "Toilet, Sitout & Balcony Copings",
    "Internal Door Frames",
    "Kitchen Bracket Fixing, Granite Fixing & Dado",
    "Window W3A, Utility Door & SLD Fixing",
    "Main Door Shutter Fixing (Temporary)",
    "Internal Door Shutter Fixing with Hardware",
    "Electrical Wiring",
    "False Ceiling Boxing",
    "Putty 1st Coat",
    "Putty 2nd Coat",
    "Primer & 1st Coat Paint",
    "False Ceiling in Toilets, Sitouts & Utilities",
    "Normal Cleaning",
    "Toilet Grouting",
    "Modular Switches & Sockets, Signal Booster Fixing",
    "FA Fixing",
    "Gas Meter Fixing",
    "CP Fixtures & Sanitary Fixtures",
    "Balcony Glass Railing",
    "Main Door & Internal Door Polishing",
    "Final Coat Paint",
    "Deep Cleaning",
]

_COMMON_AREA_ACTIVITY_NAMES = [
    "MEP Works (Fire Fighting, Electrical)",
    "Wall Punning Works",
    "False Ceiling Works",
    "Corridor Flooring",
    "Putty 1st Coat",
    "Putty 2nd Coat",
    "Primer & 1st Coat Paint",
    "Fire Doors & Shaft Doors",
    "Staircase Flooring",
    "Painting 2nd Coat",
]

# Proposed observability — site engineer must confirm before shipping (T5).
_CONCEALED_IDS = frozenset({
    "flat.corecutting_for_services_0",
    "flat.floor_screed_1",
    "flat.mep_ceiling_services_plumbing_fire_gas_3",
    "flat.plumbing_pvc_waterline_7",
    "flat.waterproofing_8",
})

# Surface groups used by T7 surface-group calls.
_SURFACE_BY_ID: dict[str, str] = {
    "flat.corecutting_for_services_0": "walls",
    "flat.floor_screed_1": "floor",
    "flat.ceiling_punning_2": "ceiling",
    "flat.mep_ceiling_services_plumbing_fire_gas_3": "ceiling",
    "flat.wall_punning_4": "walls",
    "flat.main_door_frame_5": "openings",
    "flat.false_ceiling_framing_6": "ceiling",
    "flat.plumbing_pvc_waterline_7": "walls",
    "flat.waterproofing_8": "floor",
    "flat.toilet_door_frame_9": "openings",
    "flat.plumbing_diverter_flush_valve_fixing_10": "fixtures",
    "flat.ventilator_fixing_11": "openings",
    "flat.ledge_wall_12": "walls",
    "flat.ms_railing_for_utility_13": "fixtures",
    "flat.toilet_utility_balcony_flooring_14": "floor",
    "flat.toilet_utility_dado_15": "walls",
    "flat.vitrified_flooring_16": "floor",
    "flat.toilet_sitout_balcony_copings_17": "walls",
    "flat.internal_door_frames_18": "openings",
    "flat.kitchen_bracket_fixing_granite_fixing_dado_19": "walls",
    "flat.window_w3a_utility_door_sld_fixing_20": "openings",
    "flat.main_door_shutter_fixing_temporary_21": "openings",
    "flat.internal_door_shutter_fixing_with_hardware_22": "openings",
    "flat.electrical_wiring_23": "walls",
    "flat.false_ceiling_boxing_24": "ceiling",
    "flat.putty_1st_coat_25": "walls",
    "flat.putty_2nd_coat_26": "walls",
    "flat.primer_1st_coat_paint_27": "walls",
    "flat.false_ceiling_in_toilets_sitouts_utilities_28": "ceiling",
    "flat.normal_cleaning_29": "cleanliness",
    "flat.toilet_grouting_30": "floor",
    "flat.modular_switches_sockets_signal_booster_fixing_31": "fixtures",
    "flat.fa_fixing_32": "fixtures",
    "flat.gas_meter_fixing_33": "fixtures",
    "flat.cp_fixtures_sanitary_fixtures_34": "fixtures",
    "flat.balcony_glass_railing_35": "fixtures",
    "flat.main_door_internal_door_polishing_36": "openings",
    "flat.final_coat_paint_37": "walls",
    "flat.deep_cleaning_38": "cleanliness",
    "common.mep_works_fire_fighting_electrical_0": "ceiling",
    "common.wall_punning_works_1": "walls",
    "common.false_ceiling_works_2": "ceiling",
    "common.corridor_flooring_3": "floor",
    "common.putty_1st_coat_4": "walls",
    "common.putty_2nd_coat_5": "walls",
    "common.primer_1st_coat_paint_6": "walls",
    "common.fire_doors_shaft_doors_7": "openings",
    "common.staircase_flooring_8": "floor",
    "common.painting_2nd_coat_9": "walls",
}

# Room-type tokens derived from flat_finishing_rosters layouts.
_ROOMS_TOILET = frozenset({"toilet", "m. toilet", "toilet-1", "toilet-2", "toilet-3"})
_ROOMS_KITCHEN = frozenset({"kitchen"})
_ROOMS_BALCONY = frozenset({"balcony", "sit-out"})
_ROOMS_UTILITY = frozenset({"utility"})
_ROOMS_WET = _ROOMS_TOILET | _ROOMS_UTILITY | _ROOMS_BALCONY
# Common-area room tokens (matched via substring/token overlap in vllm_provider).
_ROOMS_CORRIDOR = frozenset({"corridor", "passage", "common passage", "common corridor"})
_ROOMS_STAIRCASE = frozenset({"staircase", "stair", "stairs", "stairwell"})
_ROOMS_LOBBY_SHAFT = frozenset({
    "lobby",
    "lift lobby",
    "entrance lobby",
    "common lobby",
    "shaft",
    "fire shaft",
    "electrical shaft",
    "duct",
    "corridor",
    "passage",
})

_APPLICABLE_BY_ID: dict[str, frozenset[str]] = {
    "flat.toilet_grouting_30": _ROOMS_TOILET,
    "flat.kitchen_bracket_fixing_granite_fixing_dado_19": _ROOMS_KITCHEN,
    "flat.balcony_glass_railing_35": _ROOMS_BALCONY,
    "flat.ms_railing_for_utility_13": _ROOMS_UTILITY,
    "flat.toilet_utility_dado_15": _ROOMS_TOILET | _ROOMS_UTILITY,
    "flat.toilet_utility_balcony_flooring_14": _ROOMS_WET,
    "flat.toilet_door_frame_9": _ROOMS_TOILET,
    "flat.plumbing_diverter_flush_valve_fixing_10": _ROOMS_TOILET,
    "flat.cp_fixtures_sanitary_fixtures_34": _ROOMS_TOILET,
    "flat.ventilator_fixing_11": _ROOMS_TOILET,
    "flat.toilet_sitout_balcony_copings_17": _ROOMS_WET,
    "flat.false_ceiling_in_toilets_sitouts_utilities_28": _ROOMS_WET,
    "common.corridor_flooring_3": _ROOMS_CORRIDOR,
    "common.staircase_flooring_8": _ROOMS_STAIRCASE,
    "common.fire_doors_shaft_doors_7": _ROOMS_LOBBY_SHAFT,
}

_CONFUSABLE: dict[str, tuple[str, ...]] = {
    "flat.putty_1st_coat_25": ("flat.putty_2nd_coat_26",),
    "flat.putty_2nd_coat_26": ("flat.putty_1st_coat_25",),
    "flat.primer_1st_coat_paint_27": ("flat.final_coat_paint_37",),
    "flat.final_coat_paint_37": ("flat.primer_1st_coat_paint_27",),
    "flat.normal_cleaning_29": ("flat.deep_cleaning_38",),
    "flat.deep_cleaning_38": ("flat.normal_cleaning_29",),
}


def _build(section: str, names: list[str], ids: tuple[str, ...]) -> list[ActivityDef]:
    if len(names) != len(ids):
        raise RuntimeError(f"{section} name/id length mismatch: {len(names)} vs {len(ids)}")
    out: list[ActivityDef] = []
    for i, (name, aid) in enumerate(zip(names, ids)):
        out.append(ActivityDef(
            activity_id=aid,
            name=name,
            section=section,
            sequence_index=i,
            observability="concealed" if aid in _CONCEALED_IDS else "observable",
            surface_group=_SURFACE_BY_ID.get(aid, "walls"),
            applicable_rooms=_APPLICABLE_BY_ID.get(aid, frozenset()),
            visual_criteria=VISUAL_CRITERIA.get(aid, ""),
            confusable_with=_CONFUSABLE.get(aid, ()),
            weight=1.0,
        ))
    return out


FLAT_ACTIVITIES: list[ActivityDef] = _build("flat", _FLAT_ACTIVITY_NAMES, FROZEN_FLAT_IDS)
COMMON_AREA_ACTIVITIES: list[ActivityDef] = _build("common", _COMMON_AREA_ACTIVITY_NAMES, FROZEN_COMMON_IDS)
ALL_ACTIVITIES: list[ActivityDef] = FLAT_ACTIVITIES + COMMON_AREA_ACTIVITIES


def activities_as_dicts() -> list[dict]:
    """Serialisable form for the GET /construction-progress/activities endpoint.

    Existing keys are preserved for frontend compatibility; new taxonomy fields
    are additive only.
    """
    return [
        {
            "activityId": a.activity_id,
            "name": a.name,
            "section": a.section,
            "sequenceIndex": a.sequence_index,
            "observability": a.observability,
            "surfaceGroup": a.surface_group,
            "applicableRooms": sorted(a.applicable_rooms),
            "visualCriteria": a.visual_criteria,
            "confusableWith": list(a.confusable_with),
            "weight": a.weight,
        }
        for a in ALL_ACTIVITIES
    ]
