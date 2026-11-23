"""Centralised per-activity detection rules and a configurable dependency graph.

Pure data plus small pure functions (no I/O). Ids are the SCORING-level ids used by
the construction progress analysis (plain strings, no imports from app modules).

Two uses:
  1. render_rule_block(activity_id) builds the dense per-activity text injected into
     the vision prompt.
  2. DEPENDENCIES describes which activities normally precede which, and whether a
     confirmed later activity may be used to infer an earlier one (marked inferred,
     never directly detected).

The graph is deliberately NOT a rigid chain: activities overlap across rooms.
"""
from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class ActivityRule:
    activity_id: str
    label: str
    objects_to_find: tuple[str, ...]
    started_indicators: tuple[str, ...]
    partial_indicators: tuple[str, ...]
    complete_indicators: tuple[str, ...]
    insufficient_evidence: tuple[str, ...]
    unable_to_determine_when: tuple[str, ...]
    scope_note: str
    concealed_when_finished: bool
    # Lowercase substrings. A reading with pct > 0 is kept only if at least one (non-negated)
    # indicators_found entry contains one of them (see vllm_provider.passes_proof_gate).
    proof_indicators: tuple[str, ...] = ()


@dataclass(frozen=True)
class Dependency:
    earlier: str
    later: str
    infer: str  # "full" | "cap" | "none"
    note: str


# --------------------------------------------------------------------------- flat

FLAT_RULES: dict[str, ActivityRule] = {
    "flat.floor_screed_1": ActivityRule(
        activity_id="flat.floor_screed_1",
        label="Floor Screed",
        objects_to_find=(
            "grey cement-sand levelling layer on the structural slab",
            "screed rails, strips or level pegs on the floor",
            "flat even floor surface with fine sand-cement texture",
            "slab edges, door thresholds and wall junctions at screed level",
        ),
        started_indicators=(
            "screed rails or strips laid on bare slab",
            "first patches of fresh grey screed with trowel marks",
            "wet or damp screed bays next to bare slab",
        ),
        partial_indicators=(
            "part of the floor screeded and levelled, rest bare slab with debris",
            "% = screeded floor area / room floor area",
        ),
        complete_indicators=(
            "continuous flat grey screed across the whole room floor",
            "no exposed rebar stubs, slab debris or low patches",
            "rails removed and joints filled",
        ),
        insufficient_evidence=(
            "sand or cement bags stored on the floor",
            "rough bare slab with ponding or debris",
            "dark coating on a wet-area floor (that is waterproofing, not screed)",
            "wet-looking or dirty floor without a levelled layer",
        ),
        unable_to_determine_when=(
            "floor is hidden by stored material, scaffolding or shadow",
            "floor is not in view in the photo",
        ),
        scope_note="100% = whole visible room floor is covered by a level screed layer.",
        concealed_when_finished=True,
    ),
    "flat.mep_ceiling_services_plumbing_fire_gas_3": ActivityRule(
        activity_id="flat.mep_ceiling_services_plumbing_fire_gas_3",
        label="Service Lines (ceiling: plumbing, fire, gas)",
        objects_to_find=(
            "PVC, CPVC or GI pipes slung under the slab on clamps or hangers",
            "fire sprinkler pipes with drops and caps",
            "gas line pipe run in the ceiling or upper wall zone",
            "drainage pipes, stubs and sleeves through the slab",
            "pipe clamps, hangers and wall brackets",
        ),
        started_indicators=(
            "sleeves or short stubs at slab openings",
            "first pipe lengths clamped to the slab",
        ),
        partial_indicators=(
            "some routes clamped and aligned but visible gaps or missing branches",
            "pipes laid on the floor or stacked are not yet installed",
        ),
        complete_indicators=(
            "full pipe runs clamped, aligned and capped across the ceiling zone",
            "sprinkler drops and drain stubs terminated with caps",
        ),
        insufficient_evidence=(
            "electrical conduit or cables (that is Electrical Wiring)",
            "pipes lying on the floor or stacked as material",
            "a clean plain slab with no pipes",
            "a finished false ceiling or paint hiding the zone",
        ),
        unable_to_determine_when=(
            "ceiling zone is not visible or is covered by false ceiling or boards",
            "only a corner of the ceiling is in view",
        ),
        scope_note="100% = all ceiling-zone service runs in the visible area clamped and aligned.",
        concealed_when_finished=True,
    ),
    "flat.plumbing_pvc_waterline_7": ActivityRule(
        activity_id="flat.plumbing_pvc_waterline_7",
        label="Plumbing PVC and Water Lines (walls)",
        objects_to_find=(
            "PVC, CPVC or CP water supply pipes chased into toilet, kitchen or utility walls",
            "elbows, tees and capped stubs at WC, basin, shower and sink points",
            "drainage stubs and floor traps at slab level",
            "open wall chases with clamps or mortar patching over pipes",
        ),
        started_indicators=(
            "chases cut in the wall for pipes",
            "first pipe lengths fixed in a chase",
        ),
        partial_indicators=(
            "some fixture points fed with pipes, others still open chase",
            "pipes present but uncapped or not clamped",
        ),
        complete_indicators=(
            "all visible fixture points fed with clamped, capped pipe stubs",
            "chases patched flush after pipe fixing",
        ),
        insufficient_evidence=(
            "pipes stacked or lying on the floor",
            "electrical conduit in chases",
            "empty chases or bare wall",
            "fixtures standing nearby without pipe stubs",
        ),
        unable_to_determine_when=(
            "wall is already tiled or plastered over and pipes cannot be seen",
            "wet-area walls are not in view",
        ),
        scope_note="100% = every visible fixture point in the observed wet wall has its capped supply or drain stub.",
        concealed_when_finished=True,
    ),
    "flat.ceiling_punning_2": ActivityRule(
        activity_id="flat.ceiling_punning_2",
        label="Ceiling Punning",
        objects_to_find=(
            "ceiling soffit surface (slab underside)",
            "smooth grey or white cement/POP plaster layer on the ceiling",
            "rough bare concrete with shuttering marks or honeycombing",
            "ceiling-wall corners and beam edges",
        ),
        started_indicators=(
            "first patches of smooth plaster on bare concrete soffit",
            "plaster mortar patches at beam edges and corners",
        ),
        partial_indicators=(
            "part of the ceiling smooth, remaining bands rough or shuttering-marked",
            "% = punned ceiling area / visible ceiling area",
        ),
        complete_indicators=(
            "uniformly smooth ceiling with straight corners",
            "no rough concrete patches, honeycombs or shuttering lines",
        ),
        insufficient_evidence=(
            "hanging wires, pipes or open service holes (do not reduce % for them)",
            "white paint or putty on the ceiling (different stage)",
            "gypsum or false-ceiling boards (that is a false ceiling, not punning)",
            "bare plain slab (that is unpunned)",
        ),
        unable_to_determine_when=(
            "ceiling is not visible or is covered by a false ceiling",
            "lighting makes smooth versus rough surface unreadable",
        ),
        scope_note="100% = whole visible ceiling surface is smooth punned; judge surface only, not MEP.",
        concealed_when_finished=False,
    ),
    "flat.wall_punning_4": ActivityRule(
        activity_id="flat.wall_punning_4",
        label="Wall Punning",
        objects_to_find=(
            "wall planes of brick, block or concrete",
            "smooth grey or off-white cement/POP plaster finish on walls",
            "rough bare block, brick or concrete patches",
            "corners, reveals, columns, beam faces and plaster lines",
        ),
        started_indicators=(
            "first plaster patches or screed lines on bare masonry",
            "plaster bands or gauge strips along a wall",
        ),
        partial_indicators=(
            "part of the wall smooth, lower or upper bands still rough or bare",
            "% = punned visible wall area / total visible wall area",
        ),
        complete_indicators=(
            "all visible wall planes smooth with straight corners and reveals",
            "no bare block, brick joints or grey rough patches",
        ),
        insufficient_evidence=(
            "white or smooth surface that is actually putty or paint",
            "how finished the room looks overall",
            "tiles or cladding on walls",
        ),
        unable_to_determine_when=(
            "walls are covered by scaffolding, boards or stored material",
            "walls are not in view or too dark to read texture",
        ),
        scope_note="100% = all observable wall planes are plastered; one large unfinished region means not 90+.",
        concealed_when_finished=False,
    ),
    "flat.waterproofing_8": ActivityRule(
        activity_id="flat.waterproofing_8",
        label="Waterproofing (wet areas)",
        objects_to_find=(
            "brush or roller coating on toilet, utility, balcony or sit-out floor",
            "coating turned up the wall about 150 mm or more",
            "grey, black, blue, green or cementitious slurry coat",
            "pipe penetrations, floor traps and corners sealed with coating",
            "ponding water-test marks or a bunded water layer",
        ),
        started_indicators=(
            "first coat on part of the floor",
            "primer or slurry around drain and pipe penetrations",
        ),
        partial_indicators=(
            "floor coated but wall upturn missing or corners uncoated",
            "% = coated floor plus upturn area / wet-area floor plus upturn area",
        ),
        complete_indicators=(
            "continuous coating over floor with upturn at all walls and corners",
            "coating sealed around pipe penetrations",
            "ponding test water standing on the coated floor",
        ),
        insufficient_evidence=(
            "dark dampness, dirt or wet patches on screed",
            "bare grey screed or slab",
            "dry rooms such as bedroom or living (not wet areas)",
            "tile adhesive or stacked tiles",
        ),
        unable_to_determine_when=(
            "wet-area floor is not visible or is already tiled over (concealed)",
            "cannot tell coating from stain or wet screed",
        ),
        scope_note="100% = wet-area floor and wall upturns fully coated; wet areas only.",
        concealed_when_finished=True,
    ),
    "flat.toilet_utility_balcony_flooring_14": ActivityRule(
        activity_id="flat.toilet_utility_balcony_flooring_14",
        label="Toilet Flooring Works (toilets only)",
        objects_to_find=(
            "anti-skid or ceramic floor tiles fixed in the toilet",
            "tile joints, spacers and slope towards the floor drain",
            "tile adhesive or mortar bedding on the toilet floor",
            "cut tiles around the WC point and drain",
        ),
        started_indicators=(
            "first few tiles fixed next to the door or drain",
            "adhesive or bedding spread on part of the floor",
        ),
        partial_indicators=(
            "part of the toilet floor tiled, rest bare or waterproofed",
            "% = tiles fixed in place / toilet floor area",
        ),
        complete_indicators=(
            "every toilet floor tile laid level with even joints",
            "visible slope to the drain and neat cuts at edges",
        ),
        insufficient_evidence=(
            "tiles stacked in boxes or leaning on walls",
            "loose-laid tiles without bedding",
            "wall tiles or dado (different activity)",
            "bare waterproofed floor",
        ),
        unable_to_determine_when=(
            "toilet floor not in view or covered by plastic or debris",
            "room is not clearly a toilet",
        ),
        scope_note="100% = whole toilet floor tiled; toilets only, not dry rooms.",
        concealed_when_finished=False,
    ),
    "flat.toilet_utility_dado_15": ActivityRule(
        activity_id="flat.toilet_utility_dado_15",
        label="Toilet Dado Works (toilets only)",
        objects_to_find=(
            "ceramic or vitrified wall tiles on toilet walls",
            "tile courses, joints and spacers on the wall",
            "tile adhesive on wall plaster",
            "tiling height reaching door head or ceiling line",
        ),
        started_indicators=(
            "first rows of wall tiles fixed at the bottom or corner",
            "adhesive combed on a wall section",
        ),
        partial_indicators=(
            "lower rows tiled, upper band or some walls still bare",
            "% = tiled wall area / wall area to be tiled",
        ),
        complete_indicators=(
            "all toilet walls tiled to full height",
            "cut tiles neat at niches, pipes and corners",
        ),
        insufficient_evidence=(
            "tiles leaning on the wall or stacked",
            "floor tiles (different activity)",
            "bare plaster or waterproofing on the wall",
        ),
        unable_to_determine_when=(
            "toilet walls are not in view",
            "room is not clearly a toilet",
        ),
        scope_note="100% = all toilet walls tiled to the design height; toilets only.",
        concealed_when_finished=False,
    ),
    "flat.vitrified_flooring_16": ActivityRule(
        activity_id="flat.vitrified_flooring_16",
        label="Vitrified Flooring (dry rooms only)",
        objects_to_find=(
            "large-format vitrified or porcelain tiles laid on living, bedroom or kitchen floor",
            "tile joints and spacers",
            "tile bedding mortar or adhesive and bare screed edges",
            "skirting line and door threshold tiles",
        ),
        started_indicators=(
            "a few tiles laid in one corner or doorway",
            "bedding mortar spread in a section",
        ),
        partial_indicators=(
            "substantial area tiled but large bare screed zones remain",
            "% = tiles fixed in place / dry-room floor area",
        ),
        complete_indicators=(
            "whole dry-room floor tiled with even joints",
            "cuts neat at walls and thresholds",
        ),
        insufficient_evidence=(
            "tiles stacked, leaning or in boxes",
            "packing, plastic cover or debris on floor",
            "anti-skid tiles in toilets (different activity)",
            "grey screed only",
        ),
        unable_to_determine_when=(
            "floor is covered by protective sheets so tiles cannot be seen",
            "floor is not in view",
        ),
        scope_note="100% = whole visible dry-room floor tiled; toilets, utility and balcony excluded.",
        concealed_when_finished=False,
    ),
    "flat.internal_door_frames_18": ActivityRule(
        activity_id="flat.internal_door_frames_18",
        label="Internal Door Frames",
        objects_to_find=(
            "wooden or steel door frames fixed in internal door openings",
            "frame head and jambs plumb with wedges, shims or foam",
            "bedroom, toilet and kitchen door openings",
            "bare openings without frames",
        ),
        started_indicators=(
            "frame placed in opening with temporary props",
            "holdfasts or grouting at the base of a frame",
        ),
        partial_indicators=(
            "some openings framed, others still bare",
            "% = fixed frames / visible required openings",
        ),
        complete_indicators=(
            "frames fixed plumb in all visible openings",
            "gaps to the wall packed or grouted",
        ),
        insufficient_evidence=(
            "door shutters or leaves (different activity)",
            "frames stacked, leaning or lying on the floor",
            "lift doors, cabinets, window frames or shaft enclosures",
        ),
        unable_to_determine_when=(
            "openings are blocked by material or not visible",
            "cannot tell if a frame is fixed or just leaning",
        ),
        scope_note="100% = every visible internal door opening has a fixed frame; one frame in view can be 100% for that opening.",
        concealed_when_finished=False,
    ),
    "flat.main_door_shutter_fixing_temporary_21": ActivityRule(
        activity_id="flat.main_door_shutter_fixing_temporary_21",
        label="Main Door Shutter (temporary)",
        objects_to_find=(
            "main entrance door leaf hung in the frame",
            "hinges, temporary bolt or lock on the entrance leaf",
            "entrance frame without a leaf",
        ),
        started_indicators=(
            "leaf lifted into the frame but not yet hinged",
            "hinges fixed on the frame",
        ),
        partial_indicators=(
            "leaf propped or hung loosely, not aligned",
        ),
        complete_indicators=(
            "main door leaf hung in the entrance frame (temporary leaf acceptable)",
            "leaf swings or sits aligned in the frame",
        ),
        insufficient_evidence=(
            "leaf leaning on the wall, stacked or wrapped in plastic",
            "frame alone with no leaf",
            "internal door shutters",
        ),
        unable_to_determine_when=(
            "entrance door is not visible in the photo",
            "cannot tell the opening is the main entrance",
        ),
        scope_note="100% = the main entrance leaf is hung in its frame.",
        concealed_when_finished=False,
    ),
    "flat.internal_door_shutter_fixing_with_hardware_22": ActivityRule(
        activity_id="flat.internal_door_shutter_fixing_with_hardware_22",
        label="Internal Door Shutters with Hardware",
        objects_to_find=(
            "flush door leaves hung in internal door frames",
            "hinges, latch, handle or tower bolt on the leaf",
            "frames with no leaf",
            "leaves stacked or leaning nearby",
        ),
        started_indicators=(
            "first leaf lifted into a frame",
            "hinge screws fixed on frame and leaf",
        ),
        partial_indicators=(
            "some openings have hung leaves, others only frames",
            "% = hung leaves / visible internal frames",
        ),
        complete_indicators=(
            "all visible internal leaves hung in frames with hardware fitted",
            "leaves align with the frame with even gaps",
        ),
        insufficient_evidence=(
            "leaves leaning, propped, stacked or on the floor",
            "leaves wrapped in plastic and not hung",
            "frame alone",
            "main entrance leaf",
        ),
        unable_to_determine_when=(
            "doors are not in view or openings are blocked",
            "cannot tell hung from leaning",
        ),
        scope_note="100% = every visible internal frame has a hung leaf with basic hardware.",
        concealed_when_finished=False,
    ),
    "flat.false_ceiling_boxing_24": ActivityRule(
        activity_id="flat.false_ceiling_boxing_24",
        label="False Ceiling Boxing (boards)",
        objects_to_find=(
            "gypsum or calcium silicate boards screwed on GI framing",
            "board joints, screw heads and tape or jointing compound",
            "dropped ceiling bulkhead or cove boxing",
            "GI channels without boards",
        ),
        started_indicators=(
            "first boards fixed on a part of the framing",
            "boards lifted onto framing with screws",
        ),
        partial_indicators=(
            "boards on part of the grid, rest framing only",
            "% = boarded false-ceiling area / false-ceiling scope in view",
        ),
        complete_indicators=(
            "all framing in view closed with boards",
            "joints taped or filled and edges straight",
        ),
        insufficient_evidence=(
            "GI framing alone (that is framing, not boxing)",
            "boards stacked or stored on the floor",
            "plain smooth slab or punned ceiling",
            "white painted ceiling without boards",
        ),
        unable_to_determine_when=(
            "ceiling is not visible",
            "cannot tell board from smooth plaster",
        ),
        scope_note="100% = false-ceiling framing in view is fully boarded; no framing means 0, not applicable.",
        concealed_when_finished=False,
    ),
    "flat.electrical_wiring_23": ActivityRule(
        activity_id="flat.electrical_wiring_23",
        label="Electrical Wiring (rough-in)",
        objects_to_find=(
            "PVC conduit pipes chased in walls or run in the ceiling",
            "GI or PVC switch boxes and junction boxes",
            "ceiling light points and fan hooks",
            "wires pulled through conduits and coiled at boxes",
            "DB or MCB box location",
        ),
        started_indicators=(
            "wall chases cut and conduit fixed in places",
            "a few boxes embedded",
        ),
        partial_indicators=(
            "conduits and boxes in some walls, wires pulled in some runs only",
            "wires poking out of boxes mean rough-in done, not necessarily terminated",
        ),
        complete_indicators=(
            "conduits, boxes and ceiling points routed for all visible walls",
            "conductors pulled and coiled at every box, chases patched",
        ),
        insufficient_evidence=(
            "a visible switchboard or empty boxes alone",
            "final switch or socket plates (different, later step)",
            "plumbing or fire pipes mistaken for conduit",
            "loose cable coils stored on the floor",
        ),
        unable_to_determine_when=(
            "walls are already plastered or painted and no conduit is visible",
            "boxes are in view but cannot tell whether wires are pulled",
        ),
        scope_note="100% = routed rough-in conduits, boxes and wires present across the observed walls and ceiling.",
        concealed_when_finished=True,
    ),
    "flat.gypsum_41": ActivityRule(
        activity_id="flat.gypsum_41",
        label="Gypsum Works (walls)",
        objects_to_find=(
            "gypsum board sheets screwed on wall framing or gypsum plaster applied on walls",
            "board joints, screw heads, jointing tape and compound on walls",
            "smooth even gypsum finish with straight reveals and corners",
            "GI wall channels or studs waiting for boards",
        ),
        started_indicators=(
            "first boards screwed on a wall frame",
            "first gypsum plaster patches on a wall",
        ),
        partial_indicators=(
            "boards or gypsum plaster on some walls, other walls still bare masonry or framing",
            "% = gypsum-finished wall area / wall area in view that gets gypsum",
        ),
        complete_indicators=(
            "all walls in view lined with boards or gypsum plaster, joints taped and filled",
            "straight corners and reveals, no bare masonry or framing left",
        ),
        insufficient_evidence=(
            "ceiling boards (that is False Ceiling Boxing, not gypsum walls)",
            "smooth white wall alone (putty, paint and punning look alike)",
            "boards or gypsum bags stacked or leaning against a wall",
            "GI framing alone with no boards",
        ),
        unable_to_determine_when=(
            "cannot tell gypsum from punning, putty or paint",
            "walls are not in view or covered by material",
        ),
        scope_note="100% = every wall in view that gets gypsum is lined or plastered; walls only, never ceilings.",
        concealed_when_finished=False,
    ),
    "flat.windows_43": ActivityRule(
        activity_id="flat.windows_43",
        label="Windows",
        objects_to_find=(
            "window frames, sliding or casement windows fixed in wall openings",
            "glazing or glass panes in the frame, ventilator frames",
            "frame holdfasts, sealant or foam around the frame",
            "empty window openings",
        ),
        started_indicators=(
            "frame set in the opening with props or wedges",
            "frame fixed but no glass yet",
        ),
        partial_indicators=(
            "some openings fitted, others empty",
            "% = fixed windows / window openings in view",
        ),
        complete_indicators=(
            "frames fixed plumb in all openings in view, glazing fitted",
            "gaps to the wall sealed or packed",
        ),
        insufficient_evidence=(
            "frames or glass stacked, leaning or lying on the floor",
            "an empty opening (that is 0)",
            "door frames or lift doors",
            "wrapped or crated windows not fixed",
        ),
        unable_to_determine_when=(
            "openings are not in view or hidden by scaffolding or sheets",
            "cannot tell fixed from leaning",
        ),
        scope_note="100% = every window opening in view holds a fixed frame; frame stacked or leaning is 0.",
        concealed_when_finished=False,
    ),
    "flat.railing_42": ActivityRule(
        activity_id="flat.railing_42",
        label="Railing (balcony, sit-out, utility)",
        objects_to_find=(
            "MS or glass railing fixed along the balcony, sit-out or utility edge",
            "posts, base plates, handrail and glass panels fixed to the slab or parapet",
            "open slab edge with no railing",
            "railing material lying nearby",
        ),
        started_indicators=(
            "posts or base plates fixed along the edge",
            "first railing section fixed",
        ),
        partial_indicators=(
            "railing fixed on part of the edge, rest open",
            "% = fixed railing length / required edge length in view",
        ),
        complete_indicators=(
            "railing fixed along the whole visible open edge",
            "posts plumb, handrail or glass panels in place",
        ),
        insufficient_evidence=(
            "posts, rails or glass lying on the floor or leaning on a wall",
            "a plain parapet wall with no railing",
            "window grills or internal fixtures",
        ),
        unable_to_determine_when=(
            "the balcony or utility edge is not in view",
            "cannot tell fixed from leaning",
        ),
        scope_note="100% = the whole visible open edge carries a fixed railing; balcony, sit-out and utility only.",
        concealed_when_finished=False,
    ),
    "flat.putty_39": ActivityRule(
        activity_id="flat.putty_39",
        label="Putty (any coat)",
        objects_to_find=(
            "white or off-white putty skim over grey plaster on walls and ceilings",
            "boundary between grey plaster and puttied surface",
            "trowel and blade marks, ridges, patches",
            "sanding dust or powder on the floor near walls",
        ),
        started_indicators=(
            "putty patches on grey plaster",
            "putty applied in bands or around corners",
        ),
        partial_indicators=(
            "patchy or translucent putty with grey plaster showing through",
            "% = puttied visible wall and ceiling area / visible wall and ceiling area",
        ),
        complete_indicators=(
            "all visible walls and ceilings covered with putty, no grey plaster showing",
            "sanded smooth surface, still unpainted",
        ),
        insufficient_evidence=(
            "any white wall alone (white paint, primer, POP and gypsum look alike)",
            "putty bags or buckets present",
            "smooth finished look without putty marks, patches or sanding",
        ),
        unable_to_determine_when=(
            "cannot tell putty from primer, paint or POP",
            "surface is white and smooth with no texture cues",
        ),
        scope_note="100% = every visible wall and ceiling carries putty (any coat); coat number is not judged; unsure means unable_to_determine.",
        concealed_when_finished=False,
    ),
    "flat.paint_40": ActivityRule(
        activity_id="flat.paint_40",
        label="Paint (primer or any coat)",
        objects_to_find=(
            "roller-applied primer or paint on walls and ceilings",
            "roller texture and cut-in lines at corners and edges",
            "masked edges, switch boxes or frames with paint splashes",
            "colour or flatter finish different from bare putty",
        ),
        started_indicators=(
            "paint or primer on part of a wall with bare putty beside it",
            "cut-in lines at ceiling corners",
        ),
        partial_indicators=(
            "some walls painted, others bare putty; missed corners",
            "% = painted visible wall and ceiling area / visible wall and ceiling area",
        ),
        complete_indicators=(
            "uniform paint or primer across all visible walls and ceilings",
            "no bare putty patches or sanding marks showing through",
        ),
        insufficient_evidence=(
            "any white wall alone (putty and gypsum look similar)",
            "paint cans, brushes or rollers stored in the room",
            "a smooth white surface with no roller marks, cut-in lines or masking",
        ),
        unable_to_determine_when=(
            "cannot tell paint or primer from putty",
            "poor lighting hides texture and sheen",
        ),
        scope_note="100% = every visible wall and ceiling carries primer or paint (any coat); unsure means unable_to_determine.",
        concealed_when_finished=False,
    ),
}

# ------------------------------------------------------------------------- common

COMMON_RULES: dict[str, ActivityRule] = {
    "common.mep_works_fire_fighting_electrical_0": ActivityRule(
        activity_id="common.mep_works_fire_fighting_electrical_0",
        label="Common Area MEP (fire fighting, electrical)",
        objects_to_find=(
            "fire-fighting pipes, risers and sprinkler drops along corridor ceilings",
            "cable trays, conduits and junction boxes in corridors and shafts",
            "pipe clamps, hangers and sleeves",
            "light points and loose cables awaiting termination",
        ),
        started_indicators=(
            "first trays or pipe lengths hung",
            "sleeves and clamps fixed at the slab",
        ),
        partial_indicators=(
            "some runs installed, gaps or unsupported lengths remain",
        ),
        complete_indicators=(
            "fire pipes and electrical trays clamped and aligned along the visible corridor",
            "drops capped and cables laid in trays",
        ),
        insufficient_evidence=(
            "pipes or trays stacked on the floor",
            "bare plain slab without runs",
            "a false ceiling hiding the zone",
        ),
        unable_to_determine_when=(
            "ceiling or shaft is closed by boards or not visible",
            "only a short stretch of the corridor is in view",
        ),
        scope_note="100% = all visible common-area MEP runs fixed; quality of hidden runs is never inferred.",
        concealed_when_finished=True,
    ),
    "common.wall_punning_works_1": ActivityRule(
        activity_id="common.wall_punning_works_1",
        label="Common Area Wall Punning",
        objects_to_find=(
            "corridor, lobby and stair-core walls",
            "smooth grey or off-white plaster on walls",
            "rough bare block or concrete patches",
            "corners, column faces and plaster lines",
        ),
        started_indicators=(
            "first plaster patches on bare masonry",
            "plaster gauge strips on corridor walls",
        ),
        partial_indicators=(
            "part of the corridor wall smooth, other bands rough",
            "% = punned visible wall area / visible common wall area",
        ),
        complete_indicators=(
            "all visible common walls uniformly smooth",
            "no bare block or rough patches",
        ),
        insufficient_evidence=(
            "white putty or paint (different stage)",
            "wall tiles or cladding",
            "how finished the corridor looks overall",
        ),
        unable_to_determine_when=(
            "walls are covered by scaffolding or material",
            "cannot tell plaster from putty",
        ),
        scope_note="100% = all observable common-area wall planes are plastered.",
        concealed_when_finished=False,
    ),
    "common.false_ceiling_works_2": ActivityRule(
        activity_id="common.false_ceiling_works_2",
        label="Common Area False Ceiling",
        objects_to_find=(
            "GI grid, channels and hangers under corridor slab",
            "gypsum or board panels fixed on the grid",
            "board joints and bulkheads along corridors and lobbies",
        ),
        started_indicators=(
            "hangers and perimeter channel fixed",
            "first main runners hung",
        ),
        partial_indicators=(
            "grid in part of the corridor, boards on some bays only",
            "% = framed or boarded area / false-ceiling scope in view",
        ),
        complete_indicators=(
            "grid fully boarded along the visible corridor",
            "joints filled and edges straight",
        ),
        insufficient_evidence=(
            "smooth, white, punned or painted plain slab",
            "boards stacked on the floor",
            "pipes and trays alone",
        ),
        unable_to_determine_when=(
            "ceiling not visible",
            "cannot tell board from smooth plaster",
        ),
        scope_note="100% = false-ceiling scope in view fully framed and boarded; no grid means 0.",
        concealed_when_finished=False,
    ),
    "common.putty_10": ActivityRule(
        activity_id="common.putty_10",
        label="Common Area Putty (any coat)",
        objects_to_find=(
            "white or off-white putty skim on corridor, lobby and stair walls and ceilings",
            "boundary between grey plaster and puttied surface",
            "trowel marks, patches and sanding dust",
        ),
        started_indicators=(
            "putty patches on grey plaster",
            "putty applied in bands near corners",
        ),
        partial_indicators=(
            "patchy or translucent putty with grey showing through",
            "% = puttied area / visible common wall and ceiling area",
        ),
        complete_indicators=(
            "all visible common surfaces covered with putty, still unpainted",
            "sanded smooth with no grey plaster showing",
        ),
        insufficient_evidence=(
            "any white wall alone (paint, primer, POP, gypsum look-alikes)",
            "putty buckets or bags present",
        ),
        unable_to_determine_when=(
            "cannot tell putty from primer or paint",
            "smooth white wall with no texture cues",
        ),
        scope_note="100% = all visible common surfaces carry putty (any coat); unsure means unable_to_determine.",
        concealed_when_finished=False,
    ),
    "common.paint_11": ActivityRule(
        activity_id="common.paint_11",
        label="Common Area Paint (primer or any coat)",
        objects_to_find=(
            "roller primer or paint on corridor, lobby and stair walls and ceilings",
            "roller texture and cut-in lines",
            "masked edges and paint splashes on frames or boxes",
        ),
        started_indicators=(
            "paint or primer on part of a wall beside bare putty",
            "cut-in lines at corners",
        ),
        partial_indicators=(
            "some walls painted, others bare; missed corners",
            "% = painted area / visible common surface area",
        ),
        complete_indicators=(
            "uniform paint or primer across all visible common surfaces",
            "no putty patches or sanding marks showing",
        ),
        insufficient_evidence=(
            "any white wall alone",
            "paint cans, brushes or rollers stored nearby",
            "a smooth white surface with no roller marks or cut-in lines",
        ),
        unable_to_determine_when=(
            "cannot tell paint or primer from putty",
            "poor lighting hides texture",
        ),
        scope_note="100% = all visible common surfaces carry primer or paint (any coat); unsure means unable_to_determine.",
        concealed_when_finished=False,
    ),
}

# --------------------------------------------------------------------- proof indicators
# Lowercase substrings that must appear in a (non-negated) indicators_found entry before a
# reading above 0 is kept. Look-alike-prone activities are strict: "smooth", "white" or "flat"
# alone is never proof. Kept as one table so a site engineer can review them in one place.

_PIPE_PROOF = ("pipe", "clamp", "hanger", "sprinkler", "sleeve", "stub", "duct", "drain")
_PLASTER_PROOF = ("plaster", "punn", "pop finish", "gauge strip", "cement", "screed line", "grey")
_PUTTY_PROOF = ("putty", "skim", "trowel", "blade", "sanding", "sanded", "patch", "coat")
_PAINT_PROOF = ("paint", "primer", "coat", "roller", "cut-in", "cut in", "masked", "masking", "splash", "brush")
_FALSE_CEILING_PROOF = (
    "board joint", "joint", "grid", "channel", "access panel", "cove", "cut-out", "cutout",
    "gypsum board", "bulkhead", "screw head", "jointing", "boxing",
)

PROOF_INDICATORS: dict[str, tuple[str, ...]] = {
    "flat.floor_screed_1": ("screed", "levelled", "leveled", "cement-sand", "sand-cement", "sand cement", "rail", "level peg", "trowel"),
    "flat.mep_ceiling_services_plumbing_fire_gas_3": _PIPE_PROOF + ("gas line",),
    "flat.plumbing_pvc_waterline_7": ("pipe", "stub", "elbow", "chase", "cpvc", "pvc", "tee", "floor trap"),
    "flat.ceiling_punning_2": _PLASTER_PROOF,
    "flat.wall_punning_4": _PLASTER_PROOF,
    "flat.waterproofing_8": ("waterproof", "coating", "membrane", "slurry", "upturn", "bund", "ponding", "brush"),
    "flat.toilet_utility_balcony_flooring_14": ("tile", "joint", "spacer", "adhesive", "bedding"),
    "flat.toilet_utility_dado_15": ("tile", "joint", "spacer", "adhesive", "dado"),
    "flat.vitrified_flooring_16": ("tile", "vitrified", "porcelain", "joint", "spacer", "skirting"),
    "flat.internal_door_frames_18": ("frame", "jamb", "shim", "wedge", "holdfast"),
    "flat.main_door_shutter_fixing_temporary_21": ("shutter", "leaf", "hinge", "hung", "bolt", "lock"),
    "flat.internal_door_shutter_fixing_with_hardware_22": ("shutter", "leaf", "hinge", "hung", "latch", "handle", "bolt"),
    "flat.false_ceiling_boxing_24": _FALSE_CEILING_PROOF,
    "flat.electrical_wiring_23": ("conduit", "box", "wire", "cable", "fan hook", "mcb", "chase"),
    "flat.gypsum_41": ("gypsum", "board joint", "screw head", "jointing", "tape", "joint compound"),
    "flat.windows_43": ("window", "glazing", "glass", "ventilator", "sash"),
    "flat.railing_42": ("railing", "handrail", "post", "baluster", "balustrade", "glass panel", "rail"),
    "flat.putty_39": _PUTTY_PROOF,
    "flat.paint_40": _PAINT_PROOF,
    "common.mep_works_fire_fighting_electrical_0": ("pipe", "tray", "conduit", "sprinkler", "clamp", "hanger", "sleeve", "cable", "riser"),
    "common.wall_punning_works_1": _PLASTER_PROOF,
    "common.false_ceiling_works_2": _FALSE_CEILING_PROOF,
    "common.putty_10": _PUTTY_PROOF,
    "common.paint_11": _PAINT_PROOF,
}


def _with_proof(rules: dict[str, ActivityRule]) -> dict[str, ActivityRule]:
    return {k: replace(r, proof_indicators=PROOF_INDICATORS.get(k, r.proof_indicators)) for k, r in rules.items()}


FLAT_RULES = _with_proof(FLAT_RULES)
COMMON_RULES = _with_proof(COMMON_RULES)
RULES: dict[str, ActivityRule] = {**FLAT_RULES, **COMMON_RULES}

# ------------------------------------------------------------------- dependencies

_SL3 = "flat.mep_ceiling_services_plumbing_fire_gas_3"
_SL7 = "flat.plumbing_pvc_waterline_7"
_S = "flat.floor_screed_1"
_CP = "flat.ceiling_punning_2"
_WP = "flat.wall_punning_4"
_WPF = "flat.waterproofing_8"
_TF = "flat.toilet_utility_balcony_flooring_14"
_TD = "flat.toilet_utility_dado_15"
_VF = "flat.vitrified_flooring_16"
_IDF = "flat.internal_door_frames_18"
_IDS = "flat.internal_door_shutter_fixing_with_hardware_22"
_FCB = "flat.false_ceiling_boxing_24"
_EW = "flat.electrical_wiring_23"
_PU = "flat.putty_39"
_PA = "flat.paint_40"
_GY = "flat.gypsum_41"
_C_PU = "common.putty_10"
_C_PA = "common.paint_11"

DEPENDENCIES: tuple[Dependency, ...] = (
    # Service lines come first; their quality is concealed, never inferred from finishes.
    Dependency(_SL3, _S, "none", "Ceiling services usually precede screed; ordering only."),
    Dependency(_SL7, _S, "none", "Wall water lines usually precede floor prep; ordering only."),
    Dependency(_SL3, _CP, "none", "Ceiling services precede ceiling punning; hidden quality never inferred."),
    Dependency(_SL7, _WP, "none", "Wall pipe chases precede wall punning; hidden quality never inferred."),
    Dependency(_SL7, _WPF, "none", "Pipe stubs precede waterproofing; ordering only."),
    Dependency(_SL3, _FCB, "none", "Ceiling services precede false ceiling boxing; ordering only."),
    # Screed and floors.
    Dependency(_S, _WPF, "cap", "Waterproofing is applied over screed; capped at waterproofing %."),
    Dependency(_S, _VF, "full", "Tiles cannot be laid without screed beneath; capped at flooring %."),
    Dependency(_S, _TF, "full", "Toilet tiles cannot be laid without screed beneath; capped at flooring %."),
    Dependency(_WPF, _TF, "cap", "Toilet tiles go over waterproofing; only with direct tile evidence."),
    Dependency(_WPF, _TD, "none", "Waterproofing precedes dado; ordering only."),
    Dependency(_TF, _TD, "none", "Floor and dado overlap in toilets; ordering only."),
    Dependency(_WP, _TD, "none", "Wall plaster precedes dado; ordering only."),
    # Punning and paint chain.
    Dependency(_WP, _PU, "full", "Putty goes on punned walls; confirmed putty proves punning."),
    Dependency(_CP, _PU, "cap", "Ceilings are puttied after punning; capped, ceilings may be left out."),
    Dependency(_PU, _PA, "full", "Paint over putty proves the putty is at least as complete."),
    # Gypsum is an alternative wall substrate: ordering only, never inferred either way.
    Dependency(_GY, _PU, "none", "Gypsum walls are puttied afterwards; ordering only."),
    # Electrical, ceilings, doors (ordering mostly).
    Dependency(_WP, _EW, "none", "Wiring chases follow or overlap punning; ordering only."),
    Dependency(_EW, _PU, "none", "Rough-in wiring precedes putty; ordering only."),
    Dependency(_EW, _FCB, "none", "Wiring precedes boxing; ordering only."),
    Dependency(_FCB, _PU, "none", "Boxing precedes putty on ceilings; ordering only."),
    Dependency(_IDF, _IDS, "full", "A hung shutter proves its frame is fixed."),
    Dependency(_WP, _IDF, "none", "Frames usually fixed around punning; ordering only."),
    # Common areas follow the same wall-finish order.
    Dependency("common.mep_works_fire_fighting_electrical_0", "common.wall_punning_works_1", "none",
               "Common MEP precedes wall punning; hidden quality never inferred."),
    Dependency("common.wall_punning_works_1", _C_PU, "full",
               "Putty goes on punned common walls; confirmed putty proves punning."),
    Dependency(_C_PU, _C_PA, "full", "Paint over putty proves the putty is at least as complete."),
    Dependency("common.false_ceiling_works_2", _C_PU, "none",
               "Boxing precedes putty on ceilings; ordering only."),
)


def dependencies_for_later(later_id: str) -> tuple[Dependency, ...]:
    return tuple(d for d in DEPENDENCIES if d.later == later_id)


def inferable_from(later_id: str) -> tuple[Dependency, ...]:
    return tuple(d for d in dependencies_for_later(later_id) if d.infer != "none")


def prerequisites_of(activity_id: str) -> tuple[str, ...]:
    seen: list[str] = []
    for d in dependencies_for_later(activity_id):
        if d.earlier not in seen:
            seen.append(d.earlier)
    return tuple(seen)


def rule_for(activity_id: str) -> ActivityRule | None:
    return RULES.get(activity_id)


# ----------------------------------------------------------------------- rendering

_MAX_BLOCK_CHARS = 1250


def _join(items: tuple[str, ...], n: int) -> str:
    return "; ".join(items[:n])


def _build_block(rule: ActivityRule, counts: tuple[int, ...]) -> str:
    look, st, part, comp, notp, unable, proof = counts
    lines = [
        f"- {rule.activity_id} - {rule.label}",
        f"  Look for: {_join(rule.objects_to_find, look)}",
        f"  Started: {_join(rule.started_indicators, st)}",
        f"  Partial: {_join(rule.partial_indicators, part)}",
        f"  Complete: {_join(rule.complete_indicators, comp)}",
        f"  NOT proof: {_join(rule.insufficient_evidence, notp)}",
        f"  Unable to determine when: {_join(rule.unable_to_determine_when, unable)}",
        f"  Scope: {rule.scope_note}",
    ]
    if rule.proof_indicators:
        lines.append(
            "  Proof needed: name at least one of these in indicators_found, else unable_to_determine: "
            + ", ".join(rule.proof_indicators[:proof])
        )
    if rule.concealed_when_finished:
        lines.append("  Concealed once finished: never claim direct verification when covered.")
    pre = prerequisites_of(rule.activity_id)
    if pre:
        labels = [RULES[p].label for p in pre if p in RULES]
        if labels:
            lines.append("  Normally preceded by: " + ", ".join(labels))
    return "\n".join(lines)


def render_rule_block(activity_id: str) -> str:
    rule = RULES.get(activity_id)
    if rule is None:
        return f"- {activity_id} - {activity_id}"
    counts = [4, 3, 2, 3, 4, 2, 6]
    block = _build_block(rule, tuple(counts))
    # Trim the longest lists one bullet at a time until the block fits the budget.
    while len(block) > _MAX_BLOCK_CHARS and any(c > 1 for c in counts):
        i = max(range(7), key=lambda k: counts[k])
        counts[i] -= 1
        block = _build_block(rule, tuple(counts))
    return block


# ------------------------------------------------------------------------ validation

_REQUIRED_FLAT = (
    "flat.floor_screed_1",
    "flat.mep_ceiling_services_plumbing_fire_gas_3",
    "flat.plumbing_pvc_waterline_7",
    "flat.ceiling_punning_2",
    "flat.wall_punning_4",
    "flat.waterproofing_8",
    "flat.toilet_utility_balcony_flooring_14",
    "flat.toilet_utility_dado_15",
    "flat.vitrified_flooring_16",
    "flat.internal_door_frames_18",
    "flat.main_door_shutter_fixing_temporary_21",
    "flat.internal_door_shutter_fixing_with_hardware_22",
    "flat.false_ceiling_boxing_24",
    "flat.electrical_wiring_23",
    "flat.gypsum_41",
    "flat.windows_43",
    "flat.railing_42",
    "flat.putty_39",
    "flat.paint_40",
)
_REQUIRED_COMMON = (
    "common.mep_works_fire_fighting_electrical_0",
    "common.wall_punning_works_1",
    "common.false_ceiling_works_2",
    "common.putty_10",
    "common.paint_11",
)
REQUIRED_IDS: tuple[str, ...] = _REQUIRED_FLAT + _REQUIRED_COMMON

_TUPLE_FIELDS = (
    "objects_to_find",
    "started_indicators",
    "partial_indicators",
    "complete_indicators",
    "insufficient_evidence",
    "unable_to_determine_when",
)


def _find_cycle() -> list[str] | None:
    graph: dict[str, list[str]] = {}
    for d in DEPENDENCIES:
        graph.setdefault(d.earlier, []).append(d.later)
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if state.get(nxt, 0) == 1:
                return stack[stack.index(nxt):] + [nxt]
            if state.get(nxt, 0) == 0:
                found = visit(nxt)
                if found:
                    return found
        stack.pop()
        state[node] = 2
        return None

    for n in list(graph):
        if state.get(n, 0) == 0:
            found = visit(n)
            if found:
                return found
    return None


def validate_rules() -> list[str]:
    problems: list[str] = []
    for rid in REQUIRED_IDS:
        if rid not in RULES:
            problems.append(f"missing rule: {rid}")
    for key, rule in RULES.items():
        if key != rule.activity_id:
            problems.append(f"key/id mismatch: {key} vs {rule.activity_id}")
        if not rule.label.strip():
            problems.append(f"empty label: {key}")
        if not rule.scope_note.strip():
            problems.append(f"empty scope_note: {key}")
        for f in _TUPLE_FIELDS:
            if not getattr(rule, f):
                problems.append(f"empty {f}: {key}")
        if not rule.proof_indicators:
            problems.append(f"empty proof_indicators: {key}")
        elif any(p != p.lower() or not p.strip() for p in rule.proof_indicators):
            problems.append(f"proof_indicators must be non-empty lowercase: {key}")
    for d in DEPENDENCIES:
        if d.infer not in ("full", "cap", "none"):
            problems.append(f"bad infer mode {d.infer!r}: {d.earlier} -> {d.later}")
        for aid in (d.earlier, d.later):
            if aid not in RULES:
                problems.append(f"unknown dependency id: {aid}")
        if d.earlier == d.later:
            problems.append(f"self dependency: {d.earlier}")
    cycle = _find_cycle()
    if cycle:
        problems.append("dependency cycle: " + " -> ".join(cycle))
    return problems
