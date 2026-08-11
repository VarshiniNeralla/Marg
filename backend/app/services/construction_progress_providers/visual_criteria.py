"""DRAFT visual criteria for finishing activities — site engineer must review before shipping.

Reviewed by: (pending full sign-off)
Reviewed on: (pending)
Floor-1 calibration pass: 2026-08-11 — Flat 02 Bedroom-2 + Master Bedroom manual
reviews tightened wall punning, flooring, doors, windows, wiring, FC boxing,
putty, and modular switches criteria (see VISUAL_CRITERIA_REVIEW.md).
v4 evidence engine (2026-08-11): continuous scope %, no fill-forward; ceiling/
wall punning + FC framing/boxing criteria emphasize incomplete-area reductions.
v4.1 (2026-08-11): smooth/white/punned/concrete ceiling alone is NOT false ceiling.
v4.2 (2026-08-11): stage-aware putty/punning/wiring; combined window scope; evidence↔%.
v4.3 (2026-08-11): visual-scope evidence_class; white≠putty; room-looks-finished≠high %.
Every string below is DRAFT. Wrong criteria teach the model the wrong activity —
do not ship without a site-engineer pass (see VISUAL_CRITERIA_REVIEW.md).
"""
from __future__ import annotations

# Keys MUST match FROZEN_FLAT_IDS ∪ FROZEN_COMMON_IDS exactly (49 entries).
VISUAL_CRITERIA: dict[str, str] = {
    # ── Flat (0–38) ──────────────────────────────────────────────────────────
    "flat.corecutting_for_services_0": (
        "DRAFT. In progress: open circular/rectangular cut-outs in RCC walls or slabs "
        "with exposed rebar dust and temporary covers. Complete: cut-outs formed to "
        "service size, edges cleaned, ready for sleeve/pipe. Look at wall/slab penetrations "
        "near shafts and wet areas (often later concealed)."
    ),
    "flat.floor_screed_1": (
        "DRAFT. In progress: grey cement screed being laid/levelled, wet patches, screed "
        "rails visible. Complete: continuous level grey screed across the room floor, "
        "no loose sand piles. Look down at the full floor plane (often under later flooring)."
    ),
    "flat.ceiling_punning_2": (
        "DRAFT (v4.3). Score ceiling SURFACE punning only. Do NOT reduce for wires, "
        "pipes, service holes, or unfinished MEP. Reduce only for raw/unpunned/damaged "
        "ceiling surface. Smooth finished ceiling + hanging wires can be ~100% Ceiling "
        "Punning. Ordinary punned slab ≠ false ceiling."
    ),
    "flat.mep_ceiling_services_plumbing_fire_gas_3": (
        "DRAFT. In progress: open ceiling with hanging PVC/GI pipes, fire lines, gas "
        "lines, or cable trays partially routed. Complete: ceiling MEP runs installed and "
        "aligned before boxing/false ceiling closes them. Look up at the ceiling zone "
        "(often later concealed by false ceiling)."
    ),
    "flat.wall_punning_4": (
        "DRAFT (v4.3 visual-scope). % = completed punned visible wall area / total relevant "
        "visible wall area — NOT 'how finished the room looks'. Inspect lower/upper bands, "
        "corners, reveals, columns, grey/raw/rough patches. Anchors: 0–20 small; 25–40 "
        "limited; 45–60 ~half; 65–75 most with clear unfinished; 80–90 only if unfinished "
        "genuinely small; 100 all observable planes. Large unfinished region → not 90+. "
        "Clearly punned majority may be 80–90%. White/smooth can support punning, not putty."
    ),
    "flat.main_door_frame_5": (
        "DRAFT. In progress: main-entrance frame partially set, shims/foam, no shutter. "
        "Complete: main door wooden/metal frame fixed plumb in the opening. Look at the "
        "flat entrance door opening (frame only, not shutter)."
    ),
    "flat.false_ceiling_framing_6": (
        "DRAFT (v4.3 / v4.1 FC). Score ONLY visible GI/MS grid, channels, hangers, or "
        "clear board-support framework. Smooth/white/punned/concrete/slab curves/MEP ≠ FC "
        "(=0%). Localized frame in one opening while majority is punned slab → PARTIAL % "
        "only (scope ratio), never 100% of whole ceiling. Do NOT score boards here."
    ),
    "flat.plumbing_pvc_waterline_7": (
        "DRAFT. In progress: exposed PVC/CPVC water lines chased in walls or running "
        "along walls with open joints. Complete: waterline pipes installed to fixtures "
        "points before tiling conceals them. Look at wall chases and toilet/kitchen wet "
        "walls (often later concealed)."
    ),
    "flat.waterproofing_8": (
        "DRAFT. In progress: dark coating/membrane on toilet/utility floor-wall junctions, "
        "brush marks, upturns at walls. Complete: continuous waterproof layer on wet-area "
        "floors and skirting zone before tiling. Look at toilet/utility floor corners "
        "(often under tiles)."
    ),
    "flat.toilet_door_frame_9": (
        "DRAFT. In progress: toilet door frame leaning/propped, gaps at wall. Complete: "
        "toilet door frame fixed in the wet-room opening. Look at toilet door openings "
        "(frame only)."
    ),
    "flat.plumbing_diverter_flush_valve_fixing_10": (
        "DRAFT. In progress: open wall boxes with valves loosely placed or missing trim. "
        "Complete: diverter/flush valve bodies fixed at correct height in toilet walls. "
        "Look at toilet wall plumbing points before/without final CP covers."
    ),
    "flat.ventilator_fixing_11": (
        "DRAFT. In progress: empty ventilator opening or unit sitting unfixed. Complete: "
        "ventilator/exhaust grille fixed in the wall opening. Look at high wall/window "
        "ventilator openings in toilets/kitchens."
    ),
    "flat.ledge_wall_12": (
        "DRAFT. In progress: partial masonry/block ledge or unfinished niche. Complete: "
        "ledge wall built to line and level, ready for finish. Look at kitchen/utility "
        "ledge or loft wall lines."
    ),
    "flat.ms_railing_for_utility_13": (
        "DRAFT. In progress: MS railing posts/frames loose or partially welded. Complete: "
        "MS utility railing fixed and aligned. Look at utility balcony/rail openings."
    ),
    "flat.toilet_utility_balcony_flooring_14": (
        "DRAFT. In progress: wet-area floor with adhesive beds, loose tiles, or bare "
        "screed patches. Complete: toilet/utility/balcony floor tiles laid with even "
        "joints. Look down at wet-area floors (not dry vitrified rooms)."
    ),
    "flat.toilet_utility_dado_15": (
        "DRAFT. In progress: wall tiles partly up, cut edges, adhesive smears. Complete: "
        "toilet/utility dado tiling continuous to the specified height. Look at wet-room "
        "wall tile fields."
    ),
    "flat.vitrified_flooring_16": (
        "DRAFT (Floor-1 calibrated). Credit ONLY tiles laid and fixed in place. Early: a "
        "few tiles or a small laid island; most floor still bare screed/debris. In progress: "
        "substantial laid area but large unfinished zones remain. Mostly complete: nearly "
        "full coverage with only small gaps. Complete: living/bedroom dry floors fully "
        "tiled with even joints. Do NOT inflate for debris, packing, or tiles stacked/"
        "leaning. Look down at dry-room floor fields (not toilet anti-skid)."
    ),
    "flat.toilet_sitout_balcony_copings_17": (
        "DRAFT. In progress: coping stones missing or dry-set on parapet/sill. Complete: "
        "copings fixed on toilet/sit-out/balcony parapets or sills. Look at parapet tops "
        "and external sill edges."
    ),
    "flat.internal_door_frames_18": (
        "DRAFT (v4.3). Count frames fixed in actual door openings only — not shutters, "
        "cabinets, lift doors, enclosures, leaning frames, or look-alikes. Capture-level: "
        "one clear installed frame can be 100% for that opening. Room/flat: % = installed "
        "frames / observable required openings; one frame + bare openings → proportional."
    ),
    "flat.kitchen_bracket_fixing_granite_fixing_dado_19": (
        "DRAFT. In progress: kitchen brackets bare, granite slabs leaning, dado incomplete. "
        "Complete: kitchen brackets fixed, granite counter set, kitchen dado done. Look at "
        "kitchen counter wall and platform zone only."
    ),
    "flat.window_w3a_utility_door_sld_fixing_20": (
        "DRAFT (v4.3 COMBINED). Count W3A / utility door / SLD separately: INSTALLED only "
        "if fixed in opening. On floor / leaning / stacked / wrapped = MATERIAL_PRESENT_ONLY "
        "(0 for that component). 1 of 3 ≈ 33%; 2 of 3 ≈ 67%. One window ≠ 70–100% of activity."
    ),
    "flat.main_door_shutter_fixing_temporary_21": (
        "DRAFT. In progress: main frame present but no leaf, or temporary leaf propped. "
        "Complete: main door shutter hung (temporary leaf acceptable). Look at the main "
        "entrance leaf in the frame."
    ),
    "flat.internal_door_shutter_fixing_with_hardware_22": (
        "DRAFT (v4.3). PRESENT ≠ FIXED. Leaning/propped/on-floor slab = 0%. Need shutter "
        "hung in opening + basic hardware evidence. Frame alone = 0% shutter."
    ),
    "flat.electrical_wiring_23": (
        "DRAFT (v4.3). Boxes/conduits/loose wires/pulled conductors awaiting termination = "
        "RELATED_INFRASTRUCTURE / early rough-in — NOT high %. 'All boxes have wires' ≠ 100%. "
        "Score routed/installed wiring SCOPE. Anchors: 0–10 isolated; 10–25 early; 25–40 "
        "meaningful early; 40–60 substantial unfinished; 60–80 most; 80–100 nearly all. "
        "If completion cannot be confirmed → low/0, never mid/high."
    ),
    "flat.false_ceiling_boxing_24": (
        "DRAFT (v4.3 / v4.1 FC). Boards only. GI framing alone → Boxing 0%. Smooth slab ≠ "
        "boxing. Stored boards = 0%. Localized boards → proportional; no boards → 0%."
    ),
    "flat.putty_1st_coat_25": (
        "DRAFT (v4.3). White/smooth/pale/finished-looking alone = INSUFFICIENT_STAGE_EVIDENCE "
        "→ 0%. Allow partial ONLY with direct first-putty evidence explaining why it is 1st "
        "putty (not mere whiteness). Cannot distinguish punning vs 1st putty → 0%."
    ),
    "flat.putty_2nd_coat_26": (
        "DRAFT (v4.3 ABSOLUTE). Putty 2nd = 0% unless direct 2nd-coat evidence "
        "(denser/smoother/more opaque than 1st, still unpainted). Smooth/white/uniform NEVER "
        "enough. Cannot distinguish 1st vs 2nd → 0%."
    ),
    "flat.primer_1st_coat_paint_27": (
        "DRAFT. In progress: primer/first paint with missed corners and sheen variation. "
        "Complete: uniform primer or first paint colour (often flatter/lighter than final "
        "finish coat). Look at walls — do not call this final coat if colour looks undercoated."
    ),
    "flat.false_ceiling_in_toilets_sitouts_utilities_28": (
        "DRAFT (v4.1 strict FC). Wet-area false ceiling only with visible FC frame and/or "
        "boards. Smooth/white/punned/concrete wet-room ceiling alone = 0%. Look up in "
        "toilet/sit-out/utility only."
    ),
    "flat.normal_cleaning_29": (
        "DRAFT. In progress: construction dust, packing debris, smears still present. "
        "Complete: general broom/wipe clean — room usable for finishing checks but not "
        "handover-deep-clean. Look at floors and surfaces for everyday construction dirt "
        "(not deep-clean standard)."
    ),
    "flat.toilet_grouting_30": (
        "DRAFT. In progress: open tile joints, grout haze, or missing grout lines. "
        "Complete: toilet floor/wall tile joints filled and cleaned. Look at toilet tile "
        "joint lines only."
    ),
    "flat.modular_switches_sockets_signal_booster_fixing_31": (
        "DRAFT (Floor-1 calibrated). An empty gang box means the switch/socket installation "
        "has NOT happened — use not_started (never in_progress/complete for empty boxes). "
        "Early: a plate partly fitted or sitting loose at the box. In progress: some "
        "modular plates fixed, others empty. Complete: modular switch/socket plates and "
        "signal booster fixed on walls. Look at switch boards and booster locations."
    ),
    "flat.fa_fixing_32": (
        "DRAFT. In progress: FA device missing or hanging on cable. Complete: fire-alarm "
        "devices (MCP/hoter/detector as applicable) fixed on wall/ceiling. Look at FA "
        "points near exits/corridors inside the flat if present."
    ),
    "flat.gas_meter_fixing_33": (
        "DRAFT. In progress: gas point open or meter not mounted. Complete: gas meter "
        "fixed at the designated location. Look at the gas meter niche/utility wall."
    ),
    "flat.cp_fixtures_sanitary_fixtures_34": (
        "DRAFT. In progress: sanitaryware unboxed nearby or CP stubs open. Complete: "
        "WC/basin/CP fixtures installed. Look at toilet fixture positions."
    ),
    "flat.balcony_glass_railing_35": (
        "DRAFT. In progress: balcony railing posts without glass, or glass panels stacked. "
        "Complete: glass railing panels fixed on balcony edge. Look at balcony parapet/"
        "railing line."
    ),
    "flat.main_door_internal_door_polishing_36": (
        "DRAFT. In progress: raw/uneven door finish, polish patchy. Complete: main and "
        "internal door surfaces polished/finished uniformly. Look at door leaf faces and "
        "edges."
    ),
    "flat.final_coat_paint_37": (
        "DRAFT. In progress: final colour going on with cut-ins incomplete. Complete: "
        "finished top-coat paint with even colour and sheen (richer/more opaque than "
        "primer). Look at wall fields — distinguish from primer/1st coat."
    ),
    "flat.deep_cleaning_38": (
        "DRAFT. In progress: residual fine dust in corners, sticker residue, cloudy glass. "
        "Complete: handover-level clean — glass, floors, fixtures free of construction "
        "film. Look at glass, CP fixtures, and floor shine versus ordinary cleaning."
    ),
    # ── Common area (0–9) ────────────────────────────────────────────────────
    "common.mep_works_fire_fighting_electrical_0": (
        "DRAFT. In progress: corridor/shaft MEP with open trays, fire pipes, loose "
        "cabling. Complete: common-area fire-fighting and electrical MEP runs installed "
        "before finishes close them. Look up/along corridor ceilings and shafts."
    ),
    "common.wall_punning_works_1": (
        "DRAFT. In progress: corridor walls with unfinished plaster patches. Complete: "
        "common-area walls uniformly punned/smooth. Look at corridor and lobby wall "
        "planes."
    ),
    "common.false_ceiling_works_2": (
        "DRAFT (v4.1 strict FC). Common-area FC only with visible metal grid and/or "
        "installed boards. Smooth/white/punned/painted corridor ceiling alone = 0%. "
        "Look up along corridors/lobbies."
    ),
    "common.corridor_flooring_3": (
        "DRAFT. In progress: corridor floor with open screed or partial tiles/stone. "
        "Complete: corridor flooring continuous and even. Look down the corridor floor."
    ),
    "common.putty_1st_coat_4": (
        "DRAFT. In progress: first putty patches on common walls/ceilings. Complete: "
        "first full putty coat on corridor surfaces. Look at corridor wall fields "
        "(thinner than 2nd coat)."
    ),
    "common.putty_2nd_coat_5": (
        "DRAFT. In progress: second putty build-up still uneven. Complete: smooth second "
        "putty ready for primer on common walls. Look at corridor wall fields."
    ),
    "common.primer_1st_coat_paint_6": (
        "DRAFT. In progress: primer/first paint incomplete at edges. Complete: uniform "
        "primer or first paint on common walls/ceilings. Look at corridor painted "
        "surfaces before final colour richness."
    ),
    "common.fire_doors_shaft_doors_7": (
        "DRAFT. In progress: fire/shaft door frames without leaves or leaves unhardwareed. "
        "Complete: fire doors and shaft doors hung and closable. Look at stair/shaft door "
        "openings."
    ),
    "common.staircase_flooring_8": (
        "DRAFT. In progress: stair treads/risers bare or partially tiled/stoned. Complete: "
        "staircase flooring finished on treads and landings. Look at stair flights and "
        "landings."
    ),
    "common.painting_2nd_coat_9": (
        "DRAFT. In progress: second/final common-area paint incomplete, patchy sheen. "
        "Complete: finished second coat with even colour on corridor walls/ceilings. "
        "Look at common painted fields versus primer-only surfaces."
    ),
}
