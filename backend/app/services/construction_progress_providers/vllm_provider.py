"""
Real vision-model-backed ConstructionProgressProvider using the same local
vLLM endpoint already used for room-map extraction and before/after progress
analysis elsewhere in this codebase (app/services/vision_providers/vllm_provider.py).

T4/T7 design change (v2-surface-groups):
* Panoramas are reprojected into a rig of 6 flat views (4 walls + ceiling +
  floor) via panorama_views.render_rig; a phone photo passes through as a
  single generic view.
* Instead of one huge 39-item checklist per capture, the provider issues one
  vision call per SURFACE GROUP (ceiling / walls / openings / fixtures /
  floor / cleanliness) — each call sees ONLY the views for that group and
  ONLY the activities in that group whose applicable_rooms match the
  capture's room name.
* Concealed activities (observability=="concealed") are never asked of the
  model — v4 does not fill-forward invent their scores from downstream work.
* The prompt asks for continuous completion_pct (0–100) + confidence +
  evidence from direct visual scope coverage (v4.3-visual-scope).
* Per-room precedence (precedence.apply_precedence) runs BEFORE the roster
  rollup: later⇒earlier finish-chain fill (paint⇒primer/putty/punning);
  block-backward + MEP↔door-shutter gate remain.
* Per-unit capture merge uses incompleteness-wins (min); evidence_class +
  evidence text that admit insufficiency/material-only force 0 or low %.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import time
from datetime import datetime
from typing import Any

import cv2
import httpx
import numpy as np
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from PIL import Image, ImageStat

from app.core.config import Settings, get_settings
from app.services.derived_views_service import get_or_render_views
from app.services.image_fetch import download_image, resize_if_needed
from app.services.panorama_service import is_equirectangular, measure_image
from app.services.panorama_views import DEFAULT_RIG, RIG_VERSION, ViewSpec, render_rig
from app.services.construction_progress_providers.activities import ActivityDef
from app.services.construction_progress_providers.base import (
    ActivityAssessment,
    ActivityStatus,
    CaptureRef,
    ConstructionProgressProvider,
    FlatProgress,
    FloorProgressResult,
    RoomActivityAssessment,
    RoomProgress,
)
from app.services.construction_progress_providers.precedence import (
    WALL_FINISH_CHAIN,
    apply_precedence,
)

# A capture the model itself was unsure about (weak/indirect/partial view)
# must not surface as "evidence" for a floor-wide activity card — see the
# confidence floor in assess_floor_progress. With the v2 bucketed confidence
# (low=30, medium=60, high=90), this floor keeps only medium+high.
_MIN_EVIDENCE_CONFIDENCE = 50.0
# Room heatmap + Flat Finishing per-room bars use the lower bar so a
# legitimate finishing activity the model reported at low confidence still
# scores the room bar (but not the floor-wide card).
_MIN_ROOM_CONFIDENCE = 30.0
# Alias kept for older call sites / comments that said "heatmap".
_MIN_HEATMAP_CONFIDENCE = _MIN_ROOM_CONFIDENCE

# The completion_pct an activity/unit must reach to read as genuinely "done" —
# shared with precedence.COMPLETE_THRESHOLD (kept locally for import stability).
COMPLETE_THRESHOLD = 92.0

# Bump on every prompt / taxonomy / surface-group change. Reviews and metrics
# must never pool accuracy across versions (see T3 provenance stamping).
# v4: Flat Finishing visual completion scoring engine — continuous %, no
# fill-forward, no max aggregation, material≠install, independent activities.
# v4.1: strict false-ceiling identification (smooth/white/punned slab ≠ FC).
# v4.2: stage-aware walls/putty/wiring; evidence↔score consistency; scope language.
# v4.3: visual-scope — evidence_class; activity≠room-looks-finished; putty/wiring hard stops.
PROMPT_VERSION = "v4.4-area-scope"

# The synthetic flat name room_map_service.py stamps on every common-area
# room (lobby, lift lobby, shafts, ...), so a capture's own flat_name tells
# us definitively which section it belongs to — no guessing needed.
_COMMON_AREA_FLAT = "Common Area"

# Fallback only when the model returns a legacy state without completion_pct.
_STATE_TO_PCT: dict[str, float] = {
    "not_started": 0.0,
    "early": 15.0,
    "in_progress": 40.0,
    "mostly_complete": 80.0,
    "complete": 100.0,
}
_CONFIDENCE_TO_PCT: dict[str, float] = {
    "low": 30.0,
    "medium": 60.0,
    "high": 90.0,
}

# When the model's own evidence admits insufficiency, never keep a high %.
_INSUFFICIENT_EVIDENCE_MARKERS: tuple[str, ...] = (
    "cannot be confirmed",
    "cannot confirm",
    "insufficient evidence",
    "insufficient",
    "cannot distinguish",
    "does not prove",
    "does not establish",
    "cannot establish",
    "not enough evidence",
    "not sufficient",
    "cannot determine",
    "cannot verify",
    "unclear whether",
    "unable to confirm",
    "unable to distinguish",
)

_NO_BOARD_MARKERS: tuple[str, ...] = (
    "no gypsum",
    "no boards",
    "no board",
    "boards are absent",
    "boards absent",
    "no boxing",
    "no installed board",
    "without boards",
    "without gypsum",
)

# Appearance-only language that must NOT justify putty-stage scores (v4.3).
_PUTTY_APPEARANCE_ONLY_MARKERS: tuple[str, ...] = (
    "white and smooth",
    "smooth white",
    "white wall",
    "walls are white",
    "walls look white",
    "uniform white",
    "putty-like",
    "looks finished",
    "finished appearance",
    "finished-looking",
    "smooth pale",
    "mostly white",
)

_PUTTY_STAGE_PROOF_MARKERS: tuple[str, ...] = (
    "first putty",
    "1st putty",
    "putty 1st",
    "first-coat putty",
    "first coat putty",
    "putty layer",
    "putty patches",
    "second putty",
    "2nd putty",
    "putty 2nd",
    "second-coat",
    "second coat putty",
)

_EVIDENCE_CLASS_ZERO: frozenset[str] = frozenset({
    "material_present_only",
    "related_infrastructure_only",
    "not_observable",
})

# Activity status "completed" requires essentially full scope (v4.3).
# Precedence / near-done gates keep COMPLETE_THRESHOLD separately.
COMPLETED_STATUS_PCT = 100.0


def apply_evidence_class(activity_id: str, pct: float, evidence_class: str | None) -> float:
    """Map internal evidence_class → completion (v4.3). Does not invent %.

    CONFIRMED_INSTALLED / PARTIALLY_INSTALLED → leave pct (scope-based).
    MATERIAL_PRESENT_ONLY / RELATED_INFRASTRUCTURE_ONLY / NOT_OBSERVABLE → 0.
    INSUFFICIENT_STAGE_EVIDENCE → 0 for putty stages; otherwise leave (caller
    may still cap via reconcile).
    """
    try:
        value = max(0.0, min(100.0, float(pct)))
    except (TypeError, ValueError):
        return 0.0
    cls = (evidence_class or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not cls:
        return value
    if cls in _EVIDENCE_CLASS_ZERO:
        return 0.0
    if cls == "insufficient_stage_evidence":
        aid = (activity_id or "").lower()
        if "putty" in aid or "primer" in aid or "paint" in aid:
            return 0.0
        return value
    # confirmed_installed / partially_installed / unknown → keep
    return value


def reconcile_pct_with_evidence(
    activity_id: str,
    pct: float,
    evidence: str,
    evidence_class: str | None = None,
) -> float:
    """Cap/zero scores that contradict evidence class or evidence text (v4.3)."""
    value = apply_evidence_class(activity_id, pct, evidence_class)
    text = (evidence or "").lower()
    if not text:
        return value

    aid = (activity_id or "").lower()
    if "false_ceiling_boxing" in aid or aid.endswith("boxing_24"):
        if any(m in text for m in _NO_BOARD_MARKERS):
            return 0.0

    # Putty: white/smooth/finished appearance alone is NEVER enough.
    if "putty_1st" in aid or "putty_2nd" in aid:
        appearance = any(m in text for m in _PUTTY_APPEARANCE_ONLY_MARKERS) or (
            "white" in text and "smooth" in text
        )
        stage_proof = any(m in text for m in _PUTTY_STAGE_PROOF_MARKERS)
        if appearance and not stage_proof and value > 0:
            return 0.0
        if "putty_2nd" in aid and any(
            m in text
            for m in (
                "cannot distinguish",
                "unable to distinguish",
                "does not prove",
                "does not establish",
                "cannot establish",
                "cannot confirm",
                "insufficient",
            )
        ):
            return 0.0

    if any(m in text for m in _INSUFFICIENT_EVIDENCE_MARKERS):
        # Stage-specific putty already handled; other activities stay low.
        if "putty" in aid:
            return 0.0
        value = min(value, 25.0)

    # Electrical: "all boxes have wires" / boxes+loose wires alone ≠ mid/high %.
    if "electrical_wiring" in aid:
        boxes_wires = (
            ("box" in text or "boxes" in text)
            and ("wire" in text or "conductor" in text)
        )
        if boxes_wires and value > 40.0:
            if any(m in text for m in _INSUFFICIENT_EVIDENCE_MARKERS) or (
                "all visible" in text and "box" in text
            ):
                value = min(value, 25.0)
            elif "routed" not in text and "scope" not in text and "%" not in text:
                value = min(value, 25.0)

    # Shutter: leaning/present without fixing → 0.
    if "door_shutter" in aid or "shutter_fixing" in aid:
        if any(
            m in text
            for m in ("leaning", "propped", "on the floor", "stacked", "not fixed", "not hung")
        ):
            return 0.0
        if "present" in text and "hardware" not in text and "hung" not in text and "fixed" not in text:
            if value > 0 and "install" not in text:
                return 0.0

    # Window on floor / leaning → 0 for window activity claims that admit it.
    if "window" in aid or "sld" in aid:
        if any(m in text for m in ("on the floor", "leaning", "stacked nearby", "propped")):
            # If evidence only describes the loose component, zero; if mixed,
            # prefer_lower elsewhere handles multi-component — here force 0 when
            # no "installed"/"fixed in opening" counter-claim.
            if "installed" not in text and "fixed in" not in text:
                return 0.0

    return value


def prefer_lower_unit_evidence(
    existing: dict[str, Any] | None,
    *,
    pct: float,
    conf: float,
    capture_id: str,
    evidence: str,
) -> dict[str, Any]:
    """Per-(activity, room) merge: incompleteness wins (never max)."""
    candidate = {
        "pct": float(pct),
        "conf": float(conf),
        "capture_id": capture_id,
        "evidence": evidence,
    }
    if existing is None:
        return candidate
    if candidate["pct"] < existing["pct"]:
        return candidate
    if candidate["pct"] == existing["pct"] and candidate["conf"] > existing["conf"]:
        return candidate
    return existing


def rollup_photographed_unit_pcts(pcts: list[float]) -> float:
    """Mean of unit scores. Empty list → 0.

    Callers that want floor-complete semantics must pass a score for EVERY
    applicable roster unit (use 0.0 for uncaptured / unscored rooms). Averaging
    only photographed rooms is what previously produced false 100% cards.
    """
    if not pcts:
        return 0.0
    return float(sum(pcts) / len(pcts))


def rollup_activity_over_roster(
    *,
    applicable_units: list[tuple[str, str]],
    units_pct: dict[tuple[str, str], float],
) -> tuple[float, list[tuple[str, str]], bool]:
    """Full-roster activity %: every applicable unit counts; missing → 0%.

    Returns ``(avg_pct, photographed_units, is_fully_complete)``.
    ``is_fully_complete`` is True only when every applicable unit is present in
    ``units_pct`` and scored ≥ COMPLETED_STATUS_PCT.
    """
    if not applicable_units:
        return 0.0, [], False
    photographed = [u for u in applicable_units if u in units_pct]
    pcts = [float(units_pct.get(u, 0.0)) for u in applicable_units]
    avg = rollup_photographed_unit_pcts(pcts)
    fully = (
        len(photographed) >= len(applicable_units)
        and all(float(units_pct.get(u, 0.0)) >= COMPLETED_STATUS_PCT for u in applicable_units)
    )
    if fully:
        return 100.0, photographed, True
    if avg >= COMPLETED_STATUS_PCT and not fully:
        avg = 99.0
    return avg, photographed, False


def rollup_floor_finishing_progress(
    flat_progress: list[FlatProgress],
    assessments: list[ActivityAssessment],
) -> float:
    """Floor finishing % from flat + common finishing scopes.

    Mean of every residential flat's finishing % (uncaptured flats / rooms
    already contribute 0% inside each flat). When a Common Area FlatProgress
    entry exists, its roster % is included; otherwise fall back to the mean of
    common activity cards that already have evidence.
    """
    parts: list[float] = []
    common_fp: list[FlatProgress] = []
    for fp in flat_progress:
        if fp.flat_name == _COMMON_AREA_FLAT:
            common_fp.append(fp)
        else:
            parts.append(float(fp.completion_pct))
    if common_fp:
        parts.extend(float(fp.completion_pct) for fp in common_fp)
    else:
        common = [
            a for a in assessments
            if a.activity.section == "common" and a.status in ("in_progress", "completed")
        ]
        if common:
            parts.append(sum(float(a.completion_pct) for a in common) / len(common))
    if not parts:
        return 0.0
    return round(sum(parts) / len(parts), 1)


# Which view surfaces to include with each surface_group call. Openings and
# fixtures both live on walls; cleanliness reads across both walls and floor.
_SURFACE_TO_VIEW_SURFACES: dict[str, tuple[str, ...]] = {
    "ceiling": ("ceiling",),
    "walls": ("walls",),
    "openings": ("walls",),
    "fixtures": ("walls",),
    "floor": ("floor",),
    "cleanliness": ("walls", "floor"),
}

# Concurrent vision-call budget. Raised 3→5 (T7g) — each capture now spawns
# multiple surface-group calls, so 5 stays well under the vLLM's practical
# per-instance concurrency ceiling while roughly halving wall-clock time.
_CAPTURE_CONCURRENCY = 5

# JPEG quality used when rendering locally (matches derived_views_service).
_LOCAL_JPEG_QUALITY = 85

# IDs whose zero-seeded row is required for block-backward and the
# MEP↔door gate (see precedence.py). Fill-forward is disabled in v4.
_MEP_CEILING_ACTIVITY_ID = "flat.mep_ceiling_services_plumbing_fire_gas_3"
_DOOR_SHUTTER_ACTIVITY_IDS: tuple[str, ...] = (
    "flat.main_door_shutter_fixing_temporary_21",
    "flat.internal_door_shutter_fixing_with_hardware_22",
)


_SYSTEM_PROMPT = """
You are a Chartered Civil Engineer scoring ACTUAL OBSERVABLE construction progress
for Flat Finishing Works from site photographs.

You see ONE OR MORE rectilinear photos of ONE surface family (ceiling / walls /
floor) in a single room.

CORE QUESTION (v4.4)
Do NOT answer "How finished does this room look?"
Answer: "What physical portion of THIS SPECIFIC ACTIVITY is visibly completed?"

AREA SCOPE (mandatory):
  Score ONLY checklist items for THIS room type. Do not treat other-area
  activities as incomplete. Absence of toilet/kitchen/balcony work in a
  bedroom photo is not evidence those activities are incomplete — they are
  simply out of scope for this image.
  Completed paint finish supports that underlying primer/putty/punning is done
  for the same covered wall area; the server enforces later⇒earlier inference
  (never invent paint from putty/punning alone).

Order (mandatory):
  1) Identify the physical object/surface/work for the activity
  2) Determine its visible state
  3) Estimate completed / total RELEVANT OBSERVABLE SCOPE
  4) Assign completion_pct
Never reverse this (room-looks-finished → high %).

INTERNAL EVIDENCE CLASS (set on every scored item; used for consistency):
  CONFIRMED_INSTALLED — required work clearly installed/applied; score by scope
  PARTIALLY_INSTALLED — clear partial activity; score proportionally
  MATERIAL_PRESENT_ONLY — material present but not installed → completion_pct MUST be 0
  RELATED_INFRASTRUCTURE_ONLY — related but not proof (box≠wiring done; GI≠boxing;
    white wall≠putty; smooth slab≠FC) → completion_pct MUST be 0
  INSUFFICIENT_STAGE_EVIDENCE — finished-looking but stage unproven (esp. putty) → 0
  NOT_OBSERVABLE — use state not_visible (omit or 0)

STAGE ID (walls/ceilings) — earliest stage you can PROVE:
  RAW → PUNNING → PUTTY 1ST → PUTTY 2ND → PRIMER → FINAL PAINT
Colour ≠ stage. white≠putty; smooth≠2nd putty; white ceiling≠FC/paint.

Return ONLY JSON:
{
  "assessments": [
    {
      "activity_id": "<verbatim checklist id>",
      "evidence_class": "CONFIRMED_INSTALLED | PARTIALLY_INSTALLED | MATERIAL_PRESENT_ONLY | RELATED_INFRASTRUCTURE_ONLY | INSUFFICIENT_STAGE_EVIDENCE | NOT_OBSERVABLE",
      "completion_pct": <integer 0-100>,
      "state": "not_visible | scored",
      "evidence": "<one short factual scope sentence — production style, not review commentary>",
      "confidence": "low | medium | high"
    }
  ]
}

completion_pct = (visibly completed required scope / total observable relevant scope)×100
Continuous 0–100. No default 50%. No inventing later stages from earlier ones.
Server applies later⇒earlier finish-chain inference after scoring.
Confidence ≠ completion. High confidence + low % is valid.

state not_visible → omit or completion_pct 0. Prefer omit over inventing.

HARD RULES:
1. Direct visual evidence only — no likely/probably/expected/sequence.
2. Score each activity from direct visual evidence for THAT stage. The server
   may infer earlier finish stages from a confirmed later paint stage on the
   same surface — do NOT invent later stages (paint) from punning/putty alone.
   Keep other pairs independent (wiring≠switches; GI≠boxing; frame≠shutter;
   shutter≠polish; material≠install).
3. Material present only (leaning/stacked/on floor) = 0%.
4. Negative evidence: ask what COMPLETE would look like; if missing, lower/zero.
5. One component ≠ entire activity — count openings/components/surfaces.
6. 100% only if essentially entire observable relevant scope is complete.
7. Unseen = UNVERIFIED, not complete.
8. Evidence MUST justify the %. If evidence is weaker than the score → LOWER %.
9. Evidence text: factual measurable scope only. Forbidden: "I would keep…",
   "This is reasonable…", "The model says…", "defensible…".

ACTIVITY RULES (v4.3):
WALL PUNNING — completed punned visible area / total relevant visible wall area.
Inspect lower/upper, corners, reveals, columns, patches, grey/raw/rough. Anchors:
0–20 small; 25–40 limited; 45–60 ~half; 65–75 most with clear unfinished; 80–90 only
if unfinished genuinely small; 100 all observable planes. Large unfinished → not 90+.
Punning CAN be high on clearly punned surfaces. Do NOT use "room looks finished".

PUTTY 1ST — white/smooth/pale/finished alone = INSUFFICIENT_STAGE_EVIDENCE → 0%.
Allow partial ONLY with direct first-putty evidence (why it is 1st putty, not mere white).
If cannot distinguish punning vs 1st putty → 0%.

PUTTY 2ND — ABSOLUTE: 0% unless direct 2nd-coat evidence (denser/smoother/opaque than
1st, still unpainted). Smooth/white/uniform NEVER enough. Cannot distinguish 1st vs 2nd → 0%.

CEILING PUNNING — ceiling SURFACE only. Do NOT reduce for wires/pipes/service holes/MEP.
Reduce only for raw/unpunned/damaged ceiling surface.

FALSE CEILING — keep v4.1. Smooth/white/punned/concrete/slab curves/MEP ≠ FC (=0).
Framing: GI/MS grid/channels/hangers only. Boxing: installed gypsum/cement boards only.
GI only → boxing 0%. Localized small frame in mostly punned slab → PARTIAL framing only,
not 100% of whole ceiling.

ELECTRICAL WIRING — boxes/conduits/loose wires/pulled conductors awaiting termination
are RELATED_INFRASTRUCTURE / early rough-in, NOT high completion.
"All visible boxes have wires" ≠ 100%. Score routed/installed wiring SCOPE.
0–10 isolated; 10–25 early; 25–40 meaningful but early; 40–60 substantial unfinished;
60–80 most scope; 80–100 nearly all. If evidence says cannot confirm → must be low/0.

DOOR FRAMES — fixed in actual door openings only. Not shutters, cabinets, lift doors,
leaning frames, look-alikes. One frame can be 100% at CAPTURE level; not flat-level 100%
unless all required openings accounted for.

SHUTTER+HARDWARE — present≠fixed; leaning/propped/on floor = 0%. Need hung + hardware.

WINDOW/UTILITY/SLD — COMBINED component count. 1/3≈33%, 2/3≈67%. Floor/leaning/
stacked/wrapped = MATERIAL_PRESENT_ONLY → 0 for that component.

MODULAR SWITCHES — empty box = 0%. FLOORING — fixed tiles only. CLEANING — debris → 0%.

Evidence examples (good):
"~55% of observable wall area is smooth/punned; large grey lower bands remain unfinished."
"White/smooth walls only; cannot establish first putty vs punning — Putty 1st 0%."
"Boxes and exposed conductors at several points; wiring scope beyond early rough-in not confirmed — ~20%."
"GI channels in one localized ceiling opening; majority of ceiling is punned slab — framing ~25%."
"1 of 3 W3A/utility/SLD components fixed in openings — ~33%."
"Window frame on floor — not installed — 0%."

No prose outside JSON. No markdown fences.
"""


def _pin_location_text(capture: CaptureRef) -> str:
    """Always include the room name (v1 label-bias branch removed in T7d)."""
    room = (capture.room_name or "").strip() or "unknown room"
    flat = (capture.flat_name or "").strip() or "unknown flat"
    return f"Pin location: {room} in {flat}."


def _room_tokens(name: str) -> set[str]:
    lowered = (name or "").lower()
    for sep in ("/", "-", ",", "(", ")", "."):
        lowered = lowered.replace(sep, " ")
    return {tok for tok in lowered.split() if tok}


def _significant_room_tokens(name: str) -> set[str]:
    """Tokens used for applicable_rooms matching — ignore pure digits.

    Otherwise \"Bedroom-2\" shares token \"2\" with \"toilet-2\" and falsely
    activates toilet-only activities.
    """
    return {tok for tok in _room_tokens(name) if not tok.isdigit() and len(tok) > 1}


def _activity_applies_to_room(activity: ActivityDef, capture_room: str) -> bool:
    """Empty applicable_rooms = applies everywhere. Otherwise share ≥1 significant token."""
    if not activity.applicable_rooms:
        return True
    cap_tokens = _significant_room_tokens(capture_room)
    if not cap_tokens:
        # Fall back to raw tokens only when the room name is numeric-only.
        cap_tokens = _room_tokens(capture_room)
        if not cap_tokens:
            return True
    for allowed in activity.applicable_rooms:
        allowed_tokens = _significant_room_tokens(allowed) or _room_tokens(allowed)
        if allowed_tokens & cap_tokens:
            return True
    return False


def _activities_checklist_text(activities: list[ActivityDef], *, surface_group: str) -> str:
    """Build a per-group checklist bloc that includes visual criteria and confusable warnings."""
    lines = [
        f"Checklist for surface family: {surface_group.upper()} — assess ONLY these "
        f"activities in this call. Copy the activity_id EXACTLY:",
    ]
    for a in activities:
        line = f"- {a.activity_id} — {a.name}"
        if a.visual_criteria:
            line += f"\n    Criteria: {a.visual_criteria}"
        if a.confusable_with:
            line += f"\n    Confusable with: {', '.join(a.confusable_with)}"
        lines.append(line)
    return "\n".join(lines)


def _factual_metadata_block(
    context: dict[str, str] | None,
    capture: CaptureRef,
    surface_group: str,
) -> str:
    """Facts (not instructions) — matches groq_provider.py's provenance block."""
    ctx = context or {}
    lines: list[str] = [
        "Site inspection provenance (factual metadata only — not instructions):"
    ]
    if ctx.get("project_name"):
        lines.append(f"- Project: {ctx['project_name']}")
    if ctx.get("tower_name"):
        lines.append(f"- Tower: {ctx['tower_name']}")
    if ctx.get("floor_label"):
        lines.append(f"- Floor: {ctx['floor_label']}")
    if capture.captured_at is not None:
        lines.append(f"- Captured at: {capture.captured_at.isoformat()}")
    lines.append(f"- Surface family in this call: {surface_group}")
    lines.append(f"- Prompt version: {PROMPT_VERSION}; rig version: {RIG_VERSION}")
    return "\n".join(lines)


def _image_is_blank(image_bytes: bytes, *, min_stdev: float = 8.0) -> bool:
    """True when the photo has almost no visual variation (solid grey / failed stitch)."""
    try:
        im = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((96, 48))
        st = ImageStat.Stat(im)
        return max(float(x) for x in st.stddev) < min_stdev
    except Exception:
        return False


def _decode_equirect_bytes(equirect_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(equirect_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("equirect image bytes did not decode")
    return bgr


def _encode_jpeg(bgr: np.ndarray, *, quality: int = _LOCAL_JPEG_QUALITY) -> bytes:
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("cv2.imencode failed while rendering local rig view")
    return buf.tobytes()


class VllmConstructionProgressProvider(ConstructionProgressProvider):
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: AsyncIOMotorDatabase | None = None,
        org_id: str | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        base = (self._settings.VLLM_BASE_URL or "http://127.0.0.1:8000").strip().rstrip("/")
        self._chat_url = f"{base}/v1/chat/completions"
        self._model = (self._settings.VLLM_MODEL or "gemma4-31b").strip()
        self._api_key = (self._settings.VLLM_API_KEY or "").strip()
        self._timeout = float(self._settings.VLLM_HTTP_TIMEOUT_S)
        self._max_retries = int(self._settings.VLLM_MAX_RETRIES)
        # Optional wiring for cached derived rig views (T4). Without a db, each
        # analyze call re-renders views on the fly — still correct, just not
        # cached across runs.
        self._db = db
        self._org_id = org_id

    async def assess_floor_progress(
        self,
        *,
        floor_id: str,
        activities: list[ActivityDef],
        captures: list[CaptureRef],
        as_of: datetime,
        flat_units: list[str] | None = None,
        common_area_units: list[str] | None = None,
        flat_room_rosters: dict[str, list[str]] | None = None,
        context: dict[str, str] | None = None,
    ) -> FloorProgressResult:
        if not captures:
            return FloorProgressResult(
                overall_progress_pct=0.0,
                overall_confidence_pct=0.0,
                activities=[
                    ActivityAssessment(
                        activity=a,
                        status=(
                            "not_observable"
                            if a.observability != "observable"
                            else "not_assessed"
                        ),
                        completion_pct=0.0,
                        confidence_pct=0.0,
                    )
                    for a in activities
                ],
                executive_summary="No captures are available for this floor yet — analysis requires at least one uploaded photo.",
                model=self._model,
            )

        # Absorb org_id from the context if the provider was constructed
        # without one (typical: the factory owns db, the service passes org
        # per call). Needed for derived-views cache keys.
        if context and context.get("org_id") and not self._org_id:
            self._org_id = str(context["org_id"])

        activities_by_id = {a.activity_id: a for a in activities}
        activities_by_name = {a.name.strip().lower(): a for a in activities}

        # Only observable activities are asked of the model (T7i). Concealed
        # activities are not invented via fill-forward in v4.
        observable_flat_acts = [
            a for a in activities if a.section == "flat" and a.observability == "observable"
        ]
        observable_common_acts = [
            a for a in activities if a.section == "common" and a.observability == "observable"
        ]

        # Latest-per-pin dedupe (before/after context dropped in v2 — each
        # surface-group call already sees the current photo alongside its
        # sibling views; older shots would just multiply cost).
        latest_by_pin, standalone = _dedupe_latest_per_pin(captures)
        scoring_captures = standalone + list(latest_by_pin.values())
        skipped_older = len(captures) - len(scoring_captures)
        if skipped_older:
            logger.info(
                "[construction-progress] floor={} — {} older capture(s) on an already-photographed "
                "pin excluded from scoring, kept only as before/after context",
                floor_id, skipped_older,
            )

        semaphore = asyncio.Semaphore(_CAPTURE_CONCURRENCY)

        async def _assess_one(capture: CaptureRef) -> tuple[CaptureRef, dict[str, dict[str, Any]]]:
            async with semaphore:
                try:
                    is_common = capture.flat_name == _COMMON_AREA_FLAT
                    section_acts = observable_common_acts if is_common else observable_flat_acts
                    # Filter by applicable_rooms so a kitchen photo never
                    # gets asked about "Balcony Glass Railing" etc.
                    room_acts = [
                        a for a in section_acts
                        if _activity_applies_to_room(a, capture.room_name)
                    ]
                    if not room_acts:
                        return capture, {}
                    result = await self._assess_capture(
                        capture, room_acts, context=context,
                    )
                    if not result:
                        logger.warning(
                            "[construction-progress] capture={} ({}/{}) returned "
                            "no scorable activities (all not_visible)",
                            capture.capture_id, capture.room_name, capture.flat_name,
                        )
                    return capture, result
                except Exception as exc:
                    logger.warning(
                        "[construction-progress] vLLM assessment failed for capture={}: {}",
                        capture.capture_id, exc,
                    )
                    return capture, {}

        results = await asyncio.gather(*[_assess_one(c) for c in scoring_captures])

        # ── Collapse to per-unit conservative evidence ──────────────────────
        # Unit = (flat_name, room_name). For each (activity, unit) keep the
        # LOWEST completion_pct across captures (incompleteness wins). On a
        # tie, keep the higher-confidence / clearer evidence text.
        per_unit_best: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        # Raw per-CAPTURE signal (not per-unit) — a room's own heatmap status
        # must reflect what THAT capture's own photo showed, not what a
        # sibling room happened to score for the same activity.
        per_capture_completion: dict[str, list[float]] = {}

        for capture, per_capture in results:
            for raw_id, entry in per_capture.items():
                activity = activities_by_id.get(raw_id) or activities_by_name.get(
                    str(raw_id).strip().lower()
                )
                if activity is None:
                    raw_l = str(raw_id).strip().lower().replace(" ", "_").replace("-", "_")
                    activity = next(
                        (
                            a for a in activities
                            if a.activity_id == raw_l
                            or a.activity_id.endswith("." + raw_l)
                            or a.name.strip().lower().replace(" ", "_") == raw_l
                        ),
                        None,
                    )
                if activity is None:
                    continue
                activity_id = activity.activity_id
                conf = float(entry["confidence_pct"])
                pct = float(entry["completion_pct"])
                evidence_text = str(entry.get("evidence") or "")
                if conf >= _MIN_ROOM_CONFIDENCE and (pct > 0 or conf >= _MIN_EVIDENCE_CONFIDENCE):
                    per_capture_completion.setdefault(capture.capture_id, []).append(pct)
                if not capture.room_name:
                    continue
                unit = (capture.flat_name, capture.room_name)
                unit_map = per_unit_best.setdefault(unit, {})
                unit_map[activity_id] = prefer_lower_unit_evidence(
                    unit_map.get(activity_id),
                    pct=pct,
                    conf=conf,
                    capture_id=capture.capture_id,
                    evidence=evidence_text,
                )

        # ── Precedence per room (T7h / v4.5) ────────────────────────────────
        # Later⇒earlier finish chain: confirmed paint raises primer/putty/wall
        # punning up to the same coverage %. Never invent paint from putty.
        # Block-backward + MEP↔door gate still apply after that fill.
        _apply_precedence_per_room(per_unit_best, activities_by_id)

        # ── Split into strict / lenient dicts by confidence ────────────────
        per_activity_unit_pct: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_conf: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_evidence: dict[str, dict[tuple[str, str], str]] = {}
        per_activity_room_pct: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_room_conf: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_room_evidence: dict[str, dict[tuple[str, str], str]] = {}
        per_activity_room_evidence_text: dict[str, dict[tuple[str, str], str]] = {}

        for unit, act_map in per_unit_best.items():
            for aid, e in act_map.items():
                pct = float(e["pct"])
                conf = float(e["conf"])
                capture_id = str(e.get("capture_id") or "")
                evidence_text = str(e.get("evidence") or "")
                if conf >= _MIN_ROOM_CONFIDENCE:
                    per_activity_room_pct.setdefault(aid, {})[unit] = pct
                    per_activity_room_conf.setdefault(aid, {})[unit] = conf
                    per_activity_room_evidence.setdefault(aid, {})[unit] = capture_id
                    per_activity_room_evidence_text.setdefault(aid, {})[unit] = evidence_text
                if conf >= _MIN_EVIDENCE_CONFIDENCE:
                    per_activity_unit_pct.setdefault(aid, {})[unit] = pct
                    per_activity_unit_conf.setdefault(aid, {})[unit] = conf
                    per_activity_unit_evidence.setdefault(aid, {})[unit] = capture_id

        # ── Rosters (unchanged behaviour) ──────────────────────────────────
        flat_room_roster: list[tuple[str, str]] = [
            (flat_name, room_name)
            for flat_name, room_names in (flat_room_rosters or {}).items()
            for room_name in room_names
        ]
        common_room_roster: list[tuple[str, str]] = [
            (_COMMON_AREA_FLAT, room_name) for room_name in (common_area_units or [])
        ]

        assessments: list[ActivityAssessment] = []
        for activity in activities:
            units_pct = per_activity_unit_pct.get(activity.activity_id)
            if not units_pct:
                # Nobody has photographed an applicable area for this activity.
                # Concealed / document-only → not_observable; else not_assessed
                # (inactive — not "No Photos Yet" / incomplete).
                empty_status: ActivityStatus = (
                    "not_observable" if activity.observability != "observable" else "not_assessed"
                )
                assessments.append(
                    ActivityAssessment(
                        activity=activity, status=empty_status,
                        completion_pct=0.0, confidence_pct=0.0, evidence_capture_ids=[],
                    )
                )
                continue

            roster = flat_room_roster if activity.section == "flat" else common_room_roster
            # Full applicable roster (not only photographed rooms). Uncaptured
            # rooms count as 0% so a few finished photos cannot read as 100%.
            if roster:
                applicable = [
                    u for u in roster
                    if _activity_applies_to_room(activity, u[1])
                ]
            else:
                applicable = list(units_pct.keys())

            if not applicable:
                empty_status = (
                    "not_observable" if activity.observability != "observable" else "not_assessed"
                )
                assessments.append(
                    ActivityAssessment(
                        activity=activity, status=empty_status,
                        completion_pct=0.0, confidence_pct=0.0, evidence_capture_ids=[],
                    )
                )
                continue

            avg_pct, photographed, fully_complete = rollup_activity_over_roster(
                applicable_units=applicable,
                units_pct=units_pct,
            )
            if not photographed:
                empty_status = (
                    "not_observable" if activity.observability != "observable" else "not_assessed"
                )
                assessments.append(
                    ActivityAssessment(
                        activity=activity, status=empty_status,
                        completion_pct=0.0, confidence_pct=0.0, evidence_capture_ids=[],
                    )
                )
                continue

            units_conf = per_activity_unit_conf.get(activity.activity_id, {})
            confs = [units_conf[u] for u in photographed if u in units_conf]
            avg_conf = sum(confs) / len(confs) if confs else 0.0

            units_evidence = per_activity_unit_evidence.get(activity.activity_id, {})
            candidate_units = [u for u in photographed if units_evidence.get(u)]
            evidence = [
                units_evidence[u] for u in sorted(candidate_units, key=lambda u: -units_pct.get(u, 0.0))
            ][:3]
            status: ActivityStatus = (
                "completed" if fully_complete
                else _status_for_pct(avg_pct, has_evidence=True)
            )
            assessments.append(
                ActivityAssessment(
                    activity=activity, status=status,
                    completion_pct=round(avg_pct, 1), confidence_pct=round(avg_conf, 1),
                    evidence_capture_ids=evidence,
                )
            )

        flat_progress = _build_flat_progress(
            activities_by_id=activities_by_id,
            per_activity_unit_pct=per_activity_room_pct,
            per_activity_unit_conf=per_activity_room_conf,
            per_activity_unit_evidence=per_activity_room_evidence,
            per_activity_unit_evidence_text=per_activity_room_evidence_text,
            flat_room_rosters=flat_room_rosters or {},
            section="flat",
        )
        # Common Area Finishing Works — same room-level roster breakdown as flats.
        if common_area_units:
            common_progress = _build_flat_progress(
                activities_by_id=activities_by_id,
                per_activity_unit_pct=per_activity_room_pct,
                per_activity_unit_conf=per_activity_room_conf,
                per_activity_unit_evidence=per_activity_room_evidence,
                per_activity_unit_evidence_text=per_activity_room_evidence_text,
                flat_room_rosters={_COMMON_AREA_FLAT: list(common_area_units)},
                section="common",
            )
            flat_progress = list(flat_progress) + list(common_progress)

        determined = [a for a in assessments if a.confidence_pct > 0]
        overall_progress_pct = rollup_floor_finishing_progress(flat_progress, assessments)
        overall_confidence_pct = round(sum(a.confidence_pct for a in determined) / len(determined), 1) if determined else 0.0

        executive_summary = _build_executive_summary(assessments, overall_progress_pct, len(captures))

        return FloorProgressResult(
            overall_progress_pct=overall_progress_pct,
            overall_confidence_pct=overall_confidence_pct,
            activities=assessments,
            executive_summary=executive_summary,
            model=self._model,
            per_capture_completion=per_capture_completion,
            flat_progress=flat_progress,
        )

    # ── Per-capture path (T4 + T7a/b) ──────────────────────────────────────

    async def _assess_capture(
        self,
        capture: CaptureRef,
        activities: list[ActivityDef],
        *,
        context: dict[str, str] | None = None,
    ) -> dict[str, dict[str, Any]]:
        if not activities:
            return {}

        try:
            views = await self._get_views(capture)
        except Exception as exc:
            logger.warning(
                "[construction-progress] view prep failed for capture={}: {}",
                capture.capture_id, exc,
            )
            return {}
        if not views:
            return {}

        # Skip a capture only if EVERY view is blank (T4 step 3). A single
        # non-blank view is enough to run its surface group.
        non_blank = [(spec, b) for spec, b in views if not _image_is_blank(b)]
        if not non_blank:
            logger.warning(
                "[construction-progress] capture={} ({}/{}) — every view is blank; skipping",
                capture.capture_id, capture.room_name, capture.flat_name,
            )
            return {}

        # Group activities by surface_group; each group is one vision call.
        by_group: dict[str, list[ActivityDef]] = {}
        for a in activities:
            by_group.setdefault(a.surface_group or "walls", []).append(a)

        async def _call_group(group: str, acts: list[ActivityDef]) -> dict[str, dict[str, Any]]:
            target_surfaces = _SURFACE_TO_VIEW_SURFACES.get(group, ("walls",))
            # Phone photos carry a single view whose surface is "all";
            # accept it for every group.
            selected = [
                (spec, b) for spec, b in non_blank
                if spec.surface == "all" or spec.surface in target_surfaces
            ]
            if not selected:
                return {}
            return await self._call_surface_group(
                capture=capture,
                surface_group=group,
                activities=acts,
                views=selected,
                context=context,
            )

        group_results = await asyncio.gather(*[
            _call_group(g, acts) for g, acts in by_group.items()
        ])

        out: dict[str, dict[str, Any]] = {}
        for res in group_results:
            for aid, entry in res.items():
                existing = out.get(aid)
                if existing is None or entry["confidence_pct"] >= existing["confidence_pct"]:
                    out[aid] = entry
        return out

    async def _get_views(self, capture: CaptureRef) -> list[tuple[ViewSpec, bytes]]:
        """Return the 6 rig views for a panorama, or one 'photo' view for a phone shot."""
        image_bytes, _mime = await download_image(capture.image_url, timeout=self._timeout)
        dims = measure_image(image_bytes)
        if dims and is_equirectangular(dims[0], dims[1]):
            views: list[tuple[ViewSpec, bytes]] | None = None
            if self._db is not None and self._org_id:
                try:
                    views = await get_or_render_views(
                        self._db, capture.capture_id, self._org_id, image_bytes,
                    )
                except Exception as exc:
                    logger.warning(
                        "[construction-progress] derived_views cache path failed capture={} "
                        "— falling back to render_rig: {}", capture.capture_id, exc,
                    )
                    views = None
            if views is None:
                equirect_bgr = _decode_equirect_bytes(image_bytes)
                rendered = render_rig(equirect_bgr, DEFAULT_RIG)
                views = []
                for spec, bgr in rendered:
                    try:
                        views.append((spec, _encode_jpeg(bgr)))
                    except Exception as exc:
                        logger.warning(
                            "[construction-progress] encode failed for view {} capture={}: {}",
                            spec.name, capture.capture_id, exc,
                        )
            # 1280² q85 should already fit, but fold through the shared image
            # budget so a caller with a smaller limit still works.
            return [(spec, resize_if_needed(b)) for spec, b in views]

        # Phone photo passes through unchanged (single image, single view).
        single = resize_if_needed(image_bytes)
        photo_spec = ViewSpec(
            name="photo",
            yaw_deg=0.0,
            pitch_deg=0.0,
            hfov_deg=0.0,
            surface="all",
        )
        return [(photo_spec, single)]

    async def _call_surface_group(
        self,
        *,
        capture: CaptureRef,
        surface_group: str,
        activities: list[ActivityDef],
        views: list[tuple[ViewSpec, bytes]],
        context: dict[str, str] | None,
    ) -> dict[str, dict[str, Any]]:
        metadata_block = _factual_metadata_block(context, capture, surface_group)
        location_line = _pin_location_text(capture)
        checklist_text = _activities_checklist_text(activities, surface_group=surface_group)

        text_intro = (
            f"{metadata_block}\n\n"
            f"{location_line}\n\n"
            f"{checklist_text}\n\n"
            f"Score each activity above using ONLY the {len(views)} photo(s) below. "
            f"Return continuous completion_pct = (completed observable scope / "
            f"total observable relevant scope) × 100. Prefer \"not_visible\" "
            f"(completion_pct 0) when the activity's surface is not shown. "
            f"Classify evidence_class first; score only this activity's observable "
            f"completed scope (not how finished the room looks). "
            f"Identify the actual finishing stage before scoring putty/paint. "
            f"Do not infer, fill-forward, or use material presence as install. "
            f"Evidence sentence must be factual production scope — no review commentary. "
            f"Follow the JSON schema in the system message exactly."
        )

        content: list[dict[str, Any]] = [
            {"type": "text", "text": text_intro},
        ]
        for spec, view_bytes in views:
            b64 = base64.b64encode(view_bytes).decode("ascii")
            content.append({
                "type": "text",
                "text": f"View: {spec.name} (surface={spec.surface}, yaw={spec.yaw_deg:.0f}°)",
            })
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": 0.1,
            "max_tokens": 2048,
            "response_format": {"type": "json_object"},
        }

        raw = await self._chat_completion(
            payload,
            log_label=f"construction-progress capture={capture.capture_id} group={surface_group}",
        )

        valid_ids = {a.activity_id for a in activities}
        out: dict[str, dict[str, Any]] = {}
        for item in raw.get("assessments") or []:
            if not isinstance(item, dict):
                continue
            activity_id = str(
                item.get("activity_id") or item.get("id") or item.get("activity") or item.get("name") or ""
            ).strip()
            if not activity_id or activity_id not in valid_ids:
                continue
            state = str(item.get("state") or "").strip().lower()
            evidence_class = str(
                item.get("evidence_class") or item.get("evidenceClass") or ""
            ).strip()
            if state == "not_visible" or evidence_class.upper() == "NOT_OBSERVABLE":
                continue

            confidence = str(item.get("confidence") or "").strip().lower()
            conf_pct = _CONFIDENCE_TO_PCT.get(confidence, _CONFIDENCE_TO_PCT["low"])
            evidence_text = str(item.get("evidence") or "").strip()[:400]

            pct: float | None = None
            raw_pct = item.get("completion_pct")
            if raw_pct is None:
                raw_pct = item.get("completionPct")
            if raw_pct is not None:
                try:
                    pct = float(raw_pct)
                except (TypeError, ValueError):
                    pct = None
                if pct is not None:
                    pct = max(0.0, min(100.0, pct))

            # Legacy / fallback: map discrete state buckets when no pct given.
            if pct is None:
                if state in _STATE_TO_PCT:
                    pct = _STATE_TO_PCT[state]
                elif state in ("", "scored"):
                    # Scored without a number — cannot invent a percentage.
                    continue
                else:
                    continue

            pct = reconcile_pct_with_evidence(
                activity_id, pct, evidence_text, evidence_class=evidence_class,
            )

            # Treat explicit 0 with "scored" / not_started as real evidence of
            # incompleteness; skip only pure not_visible (handled above).
            prev = out.get(activity_id)
            # Within one surface-group response, incompleteness wins (lower %).
            if (
                prev is None
                or pct < prev["completion_pct"]
                or (pct == prev["completion_pct"] and conf_pct > prev["confidence_pct"])
            ):
                out[activity_id] = {
                    "completion_pct": pct,
                    "confidence_pct": conf_pct,
                    "evidence": evidence_text,
                }
        return out

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _chat_completion(self, payload: dict[str, Any], *, log_label: str) -> dict[str, Any]:
        last_error: Exception | None = None
        started = time.perf_counter()

        for attempt in range(self._max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(self._chat_url, headers=self._headers(), json=payload)

                if response.status_code >= 500 and attempt < self._max_retries:
                    last_error = RuntimeError(f"vLLM API error: {response.status_code}")
                    continue
                if response.status_code == 429 and attempt < self._max_retries:
                    await asyncio.sleep(min(2.0 * (attempt + 1), 30.0))
                    last_error = RuntimeError("vLLM API rate limited: 429")
                    continue

                response.raise_for_status()
                body = response.json()
                latency_ms = (time.perf_counter() - started) * 1000
                choices = body.get("choices") or []
                if not choices:
                    raise RuntimeError("vLLM API returned no choices")
                raw_content = (choices[0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)
                logger.info("{} completed model={} latency_ms={:.0f}", log_label, self._model, latency_ms)
                return parsed
            except httpx.TimeoutException as exc:
                last_error = exc
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code < 500:
                    raise RuntimeError(f"vLLM API rejected request: {exc.response.status_code}") from exc
            except Exception as exc:
                last_error = exc

        raise RuntimeError(f"{log_label} failed after retries: {last_error}") from last_error


# ── Free-function helpers ───────────────────────────────────────────────────

def _dedupe_latest_per_pin(
    captures: list[CaptureRef],
) -> tuple[dict[str, CaptureRef], list[CaptureRef]]:
    """Group by pin_id; keep the most recent capture per pin as scoring
    evidence. Captures with no pin_id each stand alone (nothing to collapse).
    """
    latest_by_pin: dict[str, CaptureRef] = {}
    standalone: list[CaptureRef] = []
    for capture in captures:
        if not capture.pin_id:
            standalone.append(capture)
            continue
        current = latest_by_pin.get(capture.pin_id)
        if current is None:
            latest_by_pin[capture.pin_id] = capture
            continue
        new_is_later = (
            capture.captured_at is not None
            and (current.captured_at is None or capture.captured_at > current.captured_at)
        )
        if new_is_later:
            latest_by_pin[capture.pin_id] = capture
    return latest_by_pin, standalone


def _apply_precedence_per_room(
    per_unit_best: dict[tuple[str, str], dict[str, dict[str, Any]]],
    activities_by_id: dict[str, ActivityDef],
) -> None:
    """Run precedence.apply_precedence for each (flat, room) unit in place.

    Seeds wall-finish chain, MEP, door-shutter, common putty/paint, and
    concealed activity ids at 0% so block-backward, paint⇒putty, and the
    MEP↔door gate have anchors.
    """
    from app.services.construction_progress_providers.precedence import (
        COMMON_PAINT_IDS,
        COMMON_PUTTY_IDS,
        PAINT_IMPLIES_PUTTY_EVIDENCE,
    )

    concealed_flat_ids = {
        aid for aid, act in activities_by_id.items()
        if act.observability == "concealed" and act.section == "flat"
    }
    seed_ids: set[str] = (
        set(WALL_FINISH_CHAIN)
        | {_MEP_CEILING_ACTIVITY_ID}
        | set(_DOOR_SHUTTER_ACTIVITY_IDS)
        | set(COMMON_PUTTY_IDS)
        | set(COMMON_PAINT_IDS)
        | concealed_flat_ids
    )

    for unit, act_map in per_unit_best.items():
        room_input: dict[str, dict[str, Any]] = {}
        for aid, e in act_map.items():
            room_input[aid] = {
                "completionPct": float(e["pct"]),
                "confidencePct": float(e["conf"]),
                "evidence": str(e.get("evidence") or ""),
            }
        for aid in seed_ids:
            room_input.setdefault(aid, {"completionPct": 0.0, "confidencePct": 0.0})

        adjusted = apply_precedence(room_input)
        for aid, adj in adjusted.items():
            raw_pct = adj.get("completionPct")
            if raw_pct is None:
                raw_pct = adj.get("completion_pct")
            try:
                new_pct = float(raw_pct or 0.0)
            except (TypeError, ValueError):
                continue
            evidence_adj = str(adj.get("evidence") or "")
            inferred = evidence_adj.startswith("Inferred from")
            capture_adj = str(adj.get("capture_id") or "")
            if not capture_adj:
                ids = adj.get("evidenceCaptureIds") or []
                if isinstance(ids, list) and ids:
                    capture_adj = str(ids[0] or "")
            if aid in act_map:
                act_map[aid]["pct"] = new_pct
                if inferred:
                    act_map[aid]["evidence"] = evidence_adj
                    # Floor rollups require conf >= 50; keep inferred fills visible.
                    act_map[aid]["conf"] = float(
                        adj.get("confidencePct") or _CONFIDENCE_TO_PCT["medium"]
                    )
                    if capture_adj and not act_map[aid].get("capture_id"):
                        act_map[aid]["capture_id"] = capture_adj
            elif new_pct > 0.0:
                act_map[aid] = {
                    "pct": new_pct,
                    "conf": float(adj.get("confidencePct") or _CONFIDENCE_TO_PCT["medium"]),
                    "capture_id": capture_adj,
                    "evidence": evidence_adj or PAINT_IMPLIES_PUTTY_EVIDENCE,
                }
            # else: stayed at 0% and wasn't in the map — don't add noise.


def _build_flat_progress(
    *,
    activities_by_id: dict[str, ActivityDef],
    per_activity_unit_pct: dict[str, dict[tuple[str, str], float]],
    per_activity_unit_conf: dict[str, dict[tuple[str, str], float]],
    per_activity_unit_evidence: dict[str, dict[tuple[str, str], str]],
    per_activity_unit_evidence_text: dict[str, dict[tuple[str, str], str]],
    flat_room_rosters: dict[str, list[str]],
    section: str = "flat",
) -> list[FlatProgress]:
    """Build Flat / Common Finishing Works breakdown.

    Work progress uses the FULL room roster; uncaptured rooms contribute 0%.
    A scope is fully complete only when every required roster room is
    photographed and every scored applicable activity in those rooms is 100%.
    """
    section_activity_ids = {
        aid for aid, a in activities_by_id.items() if a.section == section
    }
    flats: list[FlatProgress] = []
    for flat_name, room_names in flat_room_rosters.items():
        room_list = list(room_names)
        seen = {str(r) for r in room_list}
        extras: set[str] = set()
        for units in per_activity_unit_pct.values():
            for fname, rname in units:
                if fname == flat_name and rname and rname not in seen:
                    extras.add(rname)
        if extras:
            room_list.extend(sorted(extras))
        rooms_required = len(room_list)
        rooms: list[RoomProgress] = []
        rooms_complete = 0
        photographed_room_names: list[str] = []
        for room_name in room_list:
            unit = (flat_name, room_name)
            room_activities: list[RoomActivityAssessment] = []
            for activity_id in section_activity_ids:
                act_def = activities_by_id[activity_id]
                if not _activity_applies_to_room(act_def, room_name):
                    continue
                units_pct = per_activity_unit_pct.get(activity_id)
                if not units_pct or unit not in units_pct:
                    continue
                capture_id = per_activity_unit_evidence.get(activity_id, {}).get(unit) or ""
                pct = units_pct[unit]
                if act_def.observability == "concealed" or act_def.observability == "document_only":
                    room_status: ActivityStatus = "not_observable"
                elif pct >= COMPLETED_STATUS_PCT:
                    room_status = "completed"
                elif pct > 0 or bool(capture_id):
                    room_status = "in_progress"
                else:
                    room_status = "no_evidence"
                room_activities.append(
                    RoomActivityAssessment(
                        activity_id=activity_id,
                        activity_name=act_def.name,
                        completion_pct=pct,
                        confidence_pct=per_activity_unit_conf.get(activity_id, {}).get(unit, 0.0),
                        evidence_capture_ids=[capture_id] if capture_id else [],
                        evidence=per_activity_unit_evidence_text.get(activity_id, {}).get(unit, ""),
                        status=room_status,
                    )
                )
            room_activities.sort(key=lambda a: activities_by_id[a.activity_id].sequence_index)
            has_photo = bool(room_activities)
            if has_photo:
                photographed_room_names.append(room_name)
            is_complete = bool(room_activities) and all(
                a.completion_pct >= COMPLETED_STATUS_PCT for a in room_activities
            )
            if is_complete:
                rooms_complete += 1
            rooms.append(RoomProgress(room_name=room_name, is_complete=is_complete, activities=room_activities))

        rooms_photographed = len(photographed_room_names)
        # WIP % = mean across the FULL roster; uncaptured rooms contribute 0%
        # so sparse photo coverage cannot read as 80%+ flat progress.
        room_work_pcts: list[float] = []
        for room in rooms:
            if room.room_name not in photographed_room_names:
                room_work_pcts.append(0.0)
                continue
            if room.is_complete:
                room_work_pcts.append(100.0)
                continue
            scorable = [a for a in room.activities if a.status != "not_observable"]
            if not scorable:
                room_work_pcts.append(0.0)
                continue
            avg = sum(a.completion_pct for a in scorable) / len(scorable)
            room_work_pcts.append(min(avg, 99.0))
        if room_work_pcts:
            completion_pct = round(sum(room_work_pcts) / len(room_work_pcts), 1)
        else:
            completion_pct = 0.0
        all_required_covered = rooms_photographed >= rooms_required and rooms_required > 0
        is_fully_complete = all_required_covered and rooms_complete >= rooms_required
        # Block 100% until every required area is photographed and complete.
        if is_fully_complete:
            completion_pct = 100.0
        elif completion_pct >= 100.0 and not is_fully_complete:
            completion_pct = 99.0

        flats.append(
            FlatProgress(
                flat_name=flat_name,
                completion_pct=completion_pct,
                rooms_complete=rooms_complete,
                rooms_total=rooms_required,
                rooms=rooms,
                rooms_required=rooms_required,
                rooms_photographed=rooms_photographed,
                is_fully_complete=is_fully_complete,
            )
        )
    return flats


def _status_for_pct(pct: float, *, has_evidence: bool = False) -> ActivityStatus:
    """Map completion % to status.

    When relevant evidence captures exist, never return ``no_evidence``
    ("No Photos Yet") — even at 0% completion (area photographed, work not
    started / scored zero).
    """
    if pct >= COMPLETED_STATUS_PCT:
        return "completed"
    if pct > 0:
        return "in_progress"
    if has_evidence:
        return "in_progress"
    return "no_evidence"


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"vLLM returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("vLLM response JSON must be an object")
    return data


def _build_executive_summary(assessments: list[ActivityAssessment], overall_pct: float, image_count: int) -> str:
    determined = [a for a in assessments if a.confidence_pct > 0]
    if not determined:
        return (
            f"{image_count} image(s) were analyzed but no finishing activities could be confidently "
            "identified yet — more captures covering different rooms may be needed."
        )
    completed = [a for a in determined if a.status == "completed"]
    in_progress = [a for a in determined if a.status == "in_progress"]
    not_yet_assessed_count = len(assessments) - len(determined)

    def _names(items: list[ActivityAssessment], n: int) -> list[str]:
        ordered = sorted(items, key=lambda a: a.activity.sequence_index)
        return [a.activity.name for a in ordered[:n]]

    parts = [f"Based on {image_count} analyzed image(s), this floor is approximately {overall_pct:.0f}% complete across the full finishing checklist."]
    completed_names = _names(completed, 3)
    if completed_names:
        parts.append(f"{', '.join(completed_names)} {'appears' if len(completed_names) == 1 else 'appear'} complete.")
    in_progress_names = _names(in_progress, 3)
    if in_progress_names:
        parts.append(f"{', '.join(in_progress_names)} {'is' if len(in_progress_names) == 1 else 'are'} in progress.")
    if not_yet_assessed_count:
        parts.append(f"{not_yet_assessed_count} activit{'y' if not_yet_assessed_count == 1 else 'ies'} could not be confirmed from the available photos.")
    return " ".join(parts)
