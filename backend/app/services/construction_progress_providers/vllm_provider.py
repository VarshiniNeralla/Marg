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

from app.services.llm_usage_context import note_llm_call
from app.core.config import Settings, get_settings
from app.services import bedrock_converse
from app.services.derived_views_service import get_or_render_views
from app.services.image_fetch import download_image, resize_if_needed
from app.services.panorama_service import is_equirectangular, measure_image
from app.services.panorama_views import DEFAULT_RIG, RIG_VERSION, ViewSpec, render_rig
from app.services.construction_progress_providers.activities import (
    ALL_ACTIVITIES,
    ActivityDef,
)
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
from app.services.construction_progress_providers.activity_rules import render_rule_block
from app.services.construction_progress_providers.evidence_selection import (
    Observation,
    resolve_observations,
)
from app.services.construction_progress_providers.progress_aggregation import (
    DETECTION_INFERRED,
    flat_metrics,
    room_metrics,
    status_for_pct,
)
from app.services.construction_progress_providers.sequence_inference import apply_sequence_inference

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
PROMPT_VERSION = "v4.6-activity-rules"

# Scoring-level (legacy-catalog) definitions, used to score a merged core activity's components.
_SCORING_BY_ID: dict[str, ActivityDef] = {a.activity_id: a for a in ALL_ACTIVITIES}

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

# Scope bands the model may report. The SERVER turns state + band into a number.
_BAND_RANGES: dict[str, tuple[float, float]] = {
    "1-25": (1.0, 25.0),
    "26-50": (26.0, 50.0),
    "51-75": (51.0, 75.0),
    "76-99": (76.0, 99.0),
}
_BAND_MIDPOINT: dict[str, float] = {"1-25": 13.0, "26-50": 38.0, "51-75": 63.0, "76-99": 88.0}
# Models sometimes paraphrase the state names; map the common variants instead of dropping the answer.
_STATE_ALIASES: dict[str, str] = {
    "partial": "in_progress", "partially_complete": "in_progress", "partially_done": "in_progress",
    "started": "in_progress", "ongoing": "in_progress", "in-progress": "in_progress",
    "nearly_complete": "mostly_complete", "almost_complete": "mostly_complete", "mostly_done": "mostly_complete",
    "done": "completed", "finished": "completed", "complete": "completed",
    "not-started": "not_started", "none": "not_started", "not_done": "not_started",
    "cannot_determine": "unable_to_determine", "unclear": "unable_to_determine",
}
_UNABLE_STATES = frozenset({"unable_to_determine", "unable", "unknown", "cannot_determine", "undetermined"})


def clean_str_list(value: Any, limit: int = 4) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    for v in value:
        text = str(v or "").strip()[:120]
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def pct_from_assessment(state: str, item: dict[str, Any]) -> tuple[float | None, bool]:
    """(completion %, unable) for one assessment. The model gives a state (+ optional band); we own the number.

    ``unable`` is True when the model said the state cannot be established: that is *unknown*, not 0 %.
    A legacy numeric ``completion_pct`` is still honoured, clamped into the state's band.
    """
    state = _STATE_ALIASES.get(state, state)
    if state in _UNABLE_STATES:
        return None, True
    band = str(item.get("scope_done_band") or "").strip().replace(" ", "")
    band = band if band in _BAND_RANGES else ""
    numeric: float | None = None
    raw_num = item.get("completion_pct", item.get("completionPct"))
    if raw_num is not None:
        try:
            numeric = max(0.0, min(100.0, float(raw_num)))
        except (TypeError, ValueError):
            numeric = None

    if state == "not_started":
        return 0.0, False
    if state in ("completed", "complete"):
        return 100.0, False
    if state in ("in_progress", "mostly_complete"):
        lo, hi = (1.0, 75.0) if state == "in_progress" else (76.0, 99.0)
        if band:
            lo, hi = _BAND_RANGES[band]
            if numeric is not None:
                return max(lo, min(hi, numeric)), False
            return _BAND_MIDPOINT[band], False
        if numeric is not None:
            return max(lo, min(hi, numeric)), False
        return _STATE_TO_PCT.get(state, 40.0), False
    # Legacy: "scored" / "early" / empty state with a number.
    if numeric is not None:
        return numeric, False
    if state in _STATE_TO_PCT:
        return _STATE_TO_PCT[state], False
    return None, False


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
You are a Chartered Civil Engineer assessing the ACTUAL, OBSERVABLE state of construction
finishing activities from site photographs of ONE surface family in ONE room.

For EACH checklist activity answer: "What can I physically see about THIS activity?"
Never answer "How finished does the room look?".

Every checklist item below comes with its own rules: what to look for, how to read
started / partial / complete, what is NOT proof, and when you must answer
unable_to_determine. Follow them literally; they override any general impression.

STATE (choose exactly one per activity)
  not_started          the relevant surface or objects are clearly visible and show no sign of this activity
  in_progress          part of the activity is visibly done and part is not
  mostly_complete      nearly all of the observable scope is done, small gaps remain
  completed            essentially all of the observable scope is done
  unable_to_determine  the area is in view but this activity's state cannot be established reliably
                       (look-alikes, stage unclear, concealed, too far, blurred). This is NOT zero
                       progress and NOT a guess.
  not_visible          the relevant surface is not in these photos at all (omit the item instead)

SCOPE BAND - only for in_progress / mostly_complete: the share of the observable relevant
scope that is visibly done: "1-25", "26-50", "51-75" or "76-99". The server converts state +
band into numbers and does ALL aggregation. Do NOT output a percentage.

RULES
1. Direct visual evidence only. No "likely / expected / probably / because the next stage
   exists". The server infers earlier stages from later ones; you must not.
2. Material present (stacked, leaning, on the floor, wrapped) is NOT work done.
3. Related items are not proof (box != wiring done; GI frame != boxing; white wall != putty;
   smooth slab != false ceiling; frame != shutter).
4. If you cannot tell stages apart, answer unable_to_determine. Never default to
   not_started or completed.
5. Activities that do not belong to this room type are out of scope: omit them.
6. indicators_found: 0-4 short phrases for what you actually saw. indicators_missing: 0-4 short
   phrases for what would normally be visible if the work were further along.
7. explanation: ONE factual sentence naming what you saw. No review commentary, no hedging
   phrases such as "I would keep" or "this is reasonable".
8. evidence_views: the names of the views (as labelled before each image) where the evidence is visible.
9. Confidence is about how sure you are of the STATE, not how complete the work is.

evidence_class (consistency check, set on every item):
  CONFIRMED_INSTALLED | PARTIALLY_INSTALLED | MATERIAL_PRESENT_ONLY |
  RELATED_INFRASTRUCTURE_ONLY | INSUFFICIENT_STAGE_EVIDENCE | NOT_OBSERVABLE

Return ONLY this JSON:
{
  "assessments": [
    {
      "activity_id": "<verbatim checklist id>",
      "state": "not_started | in_progress | mostly_complete | completed | unable_to_determine | not_visible",
      "scope_done_band": "1-25 | 26-50 | 51-75 | 76-99 | null",
      "confidence": "low | medium | high",
      "evidence_class": "<one of the classes above>",
      "indicators_found": ["..."],
      "indicators_missing": ["..."],
      "explanation": "<one factual sentence>",
      "evidence_views": ["<view name>"]
    }
  ]
}
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


def _room_matches(room_names: frozenset[str], capture_room: str) -> bool:
    cap_tokens = _significant_room_tokens(capture_room) or _room_tokens(capture_room)
    if not cap_tokens:
        return False
    return any(
        (_significant_room_tokens(r) or _room_tokens(r)) & cap_tokens for r in room_names
    )


def _merge_components_per_unit(
    per_unit_best: dict[tuple[str, str], dict[str, dict[str, Any]]],
    core_activities: list[ActivityDef],
) -> None:
    """Fold component results into their headline activity, in place, then drop the rest.

    A headline activity with ``components`` (e.g. Punning Works = ceiling + wall punning) scores a room as
    the MEAN of the components that were actually established there. A component the photos did not show
    (or could not determine) is "unknown", not 0. Confidence is the weakest component's; evidence captures
    are the union of the components' supporting captures. Everything that is not a core activity is removed
    so it can never leak into a report.
    """
    core_ids = {a.activity_id for a in core_activities}
    for act_map in per_unit_best.values():
        for core in core_activities:
            if not core.components:
                continue
            present = [act_map[c] for c in core.components if c in act_map]
            if not present:
                continue
            known = [e for e in present if e.get("pct") is not None]
            if not known:
                merged = dict(max(present, key=lambda e: float(e.get("conf") or 0.0)))
                act_map[core.activity_id] = merged
                continue
            ranked = sorted(known, key=lambda e: -float(e["pct"]))
            evidence_ids: list[str] = []
            for e in ranked:
                ids = e["evidence_ids"] if "evidence_ids" in e else ([e.get("capture_id")] if e.get("capture_id") else [])
                for cid in ids or []:
                    if cid and cid not in evidence_ids:
                        evidence_ids.append(cid)
            views: list[str] = []
            for e in ranked:
                for v in e.get("views") or []:
                    if v not in views:
                        views.append(v)
            detections = {e.get("detection") or "direct" for e in known}
            pct = sum(float(e["pct"]) for e in known) / len(known)
            review_reasons = [e.get("review_reason") for e in known if e.get("review_required")]
            act_map[core.activity_id] = {
                "pct": pct,
                "conf": min(float(e["conf"]) for e in known),
                "capture_id": evidence_ids[0] if evidence_ids else "",
                "evidence": " | ".join(str(e.get("evidence")) for e in ranked if e.get("evidence"))[:400],
                "evidence_ids": evidence_ids[:3],
                "status": status_for_pct(pct),
                "detection": "direct" if "direct" in detections else DETECTION_INFERRED,
                "inferred_from": next((e.get("inferred_from") for e in known if e.get("inferred_from")), ""),
                "indicators_found": list(dict.fromkeys(i for e in ranked for i in e.get("indicators_found") or []))[:6],
                "indicators_missing": list(dict.fromkeys(i for e in ranked for i in e.get("indicators_missing") or []))[:6],
                "explanation": " ".join(str(e.get("explanation")) for e in ranked if e.get("explanation"))[:600],
                "views": views,
                "review_required": bool(review_reasons),
                "review_reason": str(review_reasons[0]) if review_reasons else "",
                "last_captured_at": max((e.get("last_captured_at") for e in known if e.get("last_captured_at")), default=None),
            }
        for aid in [k for k in act_map if k not in core_ids]:
            del act_map[aid]


def _activity_applies_to_room(activity: ActivityDef, capture_room: str) -> bool:
    """Empty applicable_rooms = applies everywhere. Otherwise share ≥1 significant token.

    ``excluded_rooms`` always wins: an activity never applies to a room matching it.
    """
    if activity.excluded_rooms and _room_matches(activity.excluded_rooms, capture_room):
        return False
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
        block = render_rule_block(a.activity_id)
        if block:
            lines.append(block)
            continue
        line = f"- {a.activity_id} - {a.name}"
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
        self._use_bedrock = bedrock_converse.is_enabled(self._settings)
        if self._use_bedrock:
            self._model = bedrock_converse.model_id(self._settings)
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

        # `activities` are the headline (core) activities that get reported. The model is
        # asked about their scoring-level components (a merged activity such as Punning
        # Works is scored as ceiling + wall punning), merged back after precedence.
        activities_by_id = {a.activity_id: a for a in activities}
        scoring_acts: list[ActivityDef] = []
        _seen_scoring: set[str] = set()
        for _core in activities:
            for _aid in (_core.components or (_core.activity_id,)):
                if _aid in _seen_scoring:
                    continue
                _seen_scoring.add(_aid)
                scoring_acts.append(_SCORING_BY_ID.get(_aid, _core if not _core.components else None))
        scoring_acts = [a for a in scoring_acts if a is not None]
        scoring_by_id = {a.activity_id: a for a in scoring_acts}
        activities_by_name = {a.name.strip().lower(): a for a in scoring_acts}

        # Only observable activities are asked of the model (T7i). Concealed
        # activities are not invented via fill-forward in v4.
        observable_flat_acts = [
            a for a in scoring_acts if a.section == "flat" and a.observability == "observable"
        ]
        observable_common_acts = [
            a for a in scoring_acts if a.section == "common" and a.observability == "observable"
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
        usage_totals: dict[str, float] = {}

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
                        capture, room_acts, context=context, usage_totals=usage_totals,
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

        # -- Collect every capture's reading per (room, activity) --------------
        # Unit = (flat_name, room_name). Readings are NOT collapsed to the lowest capture any more:
        # evidence_selection.resolve_observations picks the value (conservative, newest-wins, conflicts
        # flagged) AND the supporting evidence captures (only ones that show the work).
        observations: dict[tuple[str, str], dict[str, list[Observation]]] = {}
        capture_dates: dict[str, datetime | None] = {c.capture_id: c.captured_at for c in scoring_captures}
        # Raw per-CAPTURE signal (not per-unit) - a room's own heatmap status
        # must reflect what THAT capture's own photo showed, not what a
        # sibling room happened to score for the same activity.
        per_capture_completion: dict[str, list[float]] = {}

        for capture, per_capture in results:
            for raw_id, entry in per_capture.items():
                activity = scoring_by_id.get(raw_id) or activities_by_name.get(
                    str(raw_id).strip().lower()
                )
                if activity is None:
                    raw_l = str(raw_id).strip().lower().replace(" ", "_").replace("-", "_")
                    activity = next(
                        (
                            a for a in scoring_acts
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
                raw_pct = entry.get("completion_pct")
                pct = None if raw_pct is None else float(raw_pct)
                evidence_text = str(entry.get("evidence") or "")
                if pct is not None and conf >= _MIN_ROOM_CONFIDENCE and (pct > 0 or conf >= _MIN_EVIDENCE_CONFIDENCE):
                    per_capture_completion.setdefault(capture.capture_id, []).append(pct)
                if not capture.room_name:
                    continue
                unit = (capture.flat_name, capture.room_name)
                observations.setdefault(unit, {}).setdefault(activity_id, []).append(
                    Observation(
                        capture_id=capture.capture_id,
                        pct=pct,
                        conf=conf,
                        evidence=evidence_text,
                        indicators_found=tuple(entry.get("indicators_found") or ()),
                        indicators_missing=tuple(entry.get("indicators_missing") or ()),
                        explanation=str(entry.get("explanation") or ""),
                        views=tuple(entry.get("views") or ()),
                        captured_at=capture.captured_at,
                        evidence_class=str(entry.get("evidence_class") or ""),
                    )
                )

        per_unit_best: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        for unit, by_activity in observations.items():
            per_unit_best[unit] = {
                aid: resolved
                for aid, obs_list in by_activity.items()
                if (resolved := resolve_observations(obs_list))
            }

        # -- Sequence inference per room (configurable dependency graph) -------
        # A directly detected later activity may prove an earlier one; those are stored as INFERRED, never
        # as direct detections, and sequence conflicts are flagged for review instead of being zeroed.
        for unit_map in per_unit_best.values():
            apply_sequence_inference(unit_map)
        _merge_components_per_unit(per_unit_best, activities)

        # -- Split into strict / lenient dicts by confidence --------------------
        per_activity_unit_pct: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_conf: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_evidence: dict[str, dict[tuple[str, str], str]] = {}
        per_activity_room_pct: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_room_conf: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_room_evidence: dict[str, dict[tuple[str, str], str]] = {}
        per_activity_room_evidence_text: dict[str, dict[tuple[str, str], str]] = {}
        per_activity_room_entry: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}

        for unit, act_map in per_unit_best.items():
            for aid, e in act_map.items():
                conf = float(e["conf"])
                capture_id = str(e.get("capture_id") or "")
                evidence_text = str(e.get("evidence") or "")
                if e.get("pct") is None:
                    # Could not be established: kept for the room card ("Unable to determine"),
                    # never counted as 0 % and never part of a floor-level average.
                    per_activity_room_entry.setdefault(aid, {})[unit] = e
                    per_activity_room_pct.setdefault(aid, {})[unit] = 0.0
                    per_activity_room_conf.setdefault(aid, {})[unit] = conf
                    per_activity_room_evidence.setdefault(aid, {})[unit] = ""
                    per_activity_room_evidence_text.setdefault(aid, {})[unit] = evidence_text
                    continue
                pct = float(e["pct"])
                if conf >= _MIN_ROOM_CONFIDENCE:
                    per_activity_room_pct.setdefault(aid, {})[unit] = pct
                    per_activity_room_conf.setdefault(aid, {})[unit] = conf
                    per_activity_room_evidence.setdefault(aid, {})[unit] = capture_id
                    per_activity_room_evidence_text.setdefault(aid, {})[unit] = evidence_text
                    per_activity_room_entry.setdefault(aid, {})[unit] = e
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

            room_entries = per_activity_room_entry.get(activity.activity_id, {})
            evidence: list[str] = []
            evidence_details: list[dict[str, Any]] = []
            for u in sorted(photographed, key=lambda u: -units_pct.get(u, 0.0)):
                entry_u = room_entries.get(u) or {}
                for cid in (entry_u.get("evidence_ids") or [])[:1]:
                    if cid and cid not in evidence:
                        evidence.append(cid)
                        evidence_details.append({
                            "captureId": cid,
                            "role": entry_u.get("detection") or "direct",
                            "flatName": u[0],
                            "roomName": u[1],
                            "views": list(entry_u.get("views") or []),
                            "capturedAt": entry_u.get("last_captured_at"),
                            "confidencePct": round(float(entry_u.get("conf") or 0.0), 1),
                        })
                if len(evidence) >= 3:
                    break
            observed_n = len([u for u in applicable if u in units_pct])
            detections = {(room_entries.get(u) or {}).get("detection") or "direct" for u in photographed}
            detection_type = (
                "inferred" if detections == {"inferred"}
                else "mixed" if "inferred" in detections
                else "direct"
            )
            review_flags = [
                (room_entries.get(u) or {}).get("review_reason") for u in photographed
                if (room_entries.get(u) or {}).get("review_required")
            ]
            status: ActivityStatus = (
                "completed" if fully_complete
                else _status_for_pct(avg_pct, has_evidence=True)
            )
            assessments.append(
                ActivityAssessment(
                    activity=activity, status=status,
                    completion_pct=round(avg_pct, 1), confidence_pct=round(avg_conf, 1),
                    evidence_capture_ids=evidence,
                    assessment_status=status_for_pct(round(avg_pct, 1)),
                    detection_type=detection_type,
                    coverage_pct=round(observed_n / len(applicable) * 100, 1) if applicable else 0.0,
                    review_required=bool(review_flags),
                    review_reason=str(review_flags[0]) if review_flags else "",
                    evidence_details=evidence_details,
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
            per_activity_unit_entry=per_activity_room_entry,
            capture_dates=capture_dates,
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
                per_activity_unit_entry=per_activity_room_entry,
                capture_dates=capture_dates,
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
            prompt_tokens=int(usage_totals.get("prompt_tokens", 0)),
            completion_tokens=int(usage_totals.get("completion_tokens", 0)),
            total_tokens=int(usage_totals.get("total_tokens", 0)),
            latency_ms=usage_totals.get("latency_ms", 0.0),
            scored_capture_ids=[c.capture_id for c in scoring_captures],
            last_inspection=max((c.captured_at for c in scoring_captures if c.captured_at), default=None),
        )

    # ── Per-capture path (T4 + T7a/b) ──────────────────────────────────────

    async def _assess_capture(
        self,
        capture: CaptureRef,
        activities: list[ActivityDef],
        *,
        context: dict[str, str] | None = None,
        usage_totals: dict[str, float] | None = None,
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
            call_usage: dict[str, Any] = {}
            result = await self._call_surface_group(
                capture=capture,
                surface_group=group,
                activities=acts,
                views=selected,
                context=context,
                usage_out=call_usage,
            )
            if usage_totals is not None and call_usage:
                usage_totals["prompt_tokens"] = usage_totals.get("prompt_tokens", 0) + call_usage.get("prompt_tokens", 0)
                usage_totals["completion_tokens"] = usage_totals.get("completion_tokens", 0) + call_usage.get("completion_tokens", 0)
                usage_totals["total_tokens"] = usage_totals.get("total_tokens", 0) + call_usage.get("total_tokens", 0)
                usage_totals["latency_ms"] = usage_totals.get("latency_ms", 0.0) + call_usage.get("latency_ms", 0.0)
            return result

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
        usage_out: dict[str, Any] | None = None,
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
            usage_out=usage_out,
        )

        valid_ids = {a.activity_id for a in activities}
        view_names = {spec.name for spec, _ in views}
        out: dict[str, dict[str, Any]] = {}
        for item in raw.get("assessments") or []:
            if not isinstance(item, dict):
                continue
            activity_id = str(
                item.get("activity_id") or item.get("id") or item.get("activity") or item.get("name") or ""
            ).strip()
            if not activity_id or activity_id not in valid_ids:
                continue
            state = str(item.get("state") or item.get("status") or "").strip().lower().replace(" ", "_")
            evidence_class = str(
                item.get("evidence_class") or item.get("evidenceClass") or ""
            ).strip()
            if state in ("not_visible", "not_applicable") or evidence_class.upper() == "NOT_OBSERVABLE":
                continue

            confidence = str(item.get("confidence") or "").strip().lower()
            conf_pct = _CONFIDENCE_TO_PCT.get(confidence, _CONFIDENCE_TO_PCT["low"])
            explanation = str(item.get("explanation") or "").strip()[:600]
            evidence_text = str(item.get("evidence") or explanation or "").strip()[:400]

            pct, unable = pct_from_assessment(state, item)
            if pct is None and not unable:
                # Scored without anything we can turn into a number - cannot invent one.
                continue
            if pct is not None:
                pct = reconcile_pct_with_evidence(
                    activity_id, pct, evidence_text, evidence_class=evidence_class,
                )

            result_item = {
                "completion_pct": pct,
                "confidence_pct": conf_pct,
                "evidence": evidence_text,
                "explanation": explanation or evidence_text,
                "indicators_found": clean_str_list(item.get("indicators_found")),
                "indicators_missing": clean_str_list(item.get("indicators_missing")),
                "views": [v for v in clean_str_list(item.get("evidence_views")) if v in view_names],
                "evidence_class": evidence_class,
                "state": state,
            }
            prev = out.get(activity_id)
            # Within one surface-group response, incompleteness wins (lower %); a number beats "unknown".
            if (
                prev is None
                or (prev["completion_pct"] is None and pct is not None)
                or (
                    pct is not None
                    and prev["completion_pct"] is not None
                    and (
                        pct < prev["completion_pct"]
                        or (pct == prev["completion_pct"] and conf_pct > prev["confidence_pct"])
                    )
                )
            ):
                out[activity_id] = result_item
        return out

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _chat_completion(
        self,
        payload: dict[str, Any],
        *,
        log_label: str,
        usage_out: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self._use_bedrock:
            return await self._bedrock_chat_completion(payload, log_label=log_label, usage_out=usage_out)

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
                _u = body.get("usage") or {}
                # Billed now, whether or not the reply parses below (see llm_usage_context).
                note_llm_call(self._model, _u.get("prompt_tokens"), _u.get("completion_tokens"), _u.get("total_tokens"), latency_ms)
                choices = body.get("choices") or []
                if not choices:
                    raise RuntimeError("vLLM API returned no choices")
                raw_content = (choices[0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)
                logger.info("{} completed model={} latency_ms={:.0f}", log_label, self._model, latency_ms)
                if usage_out is not None:
                    usage = body.get("usage") or {}
                    usage_out["prompt_tokens"] = int(usage.get("prompt_tokens") or 0)
                    usage_out["completion_tokens"] = int(usage.get("completion_tokens") or 0)
                    usage_out["total_tokens"] = int(usage.get("total_tokens") or 0)
                    usage_out["latency_ms"] = latency_ms
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

    async def _bedrock_chat_completion(
        self,
        payload: dict[str, Any],
        *,
        log_label: str,
        usage_out: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Same call through Amazon Bedrock (LLM_BACKEND=bedrock); same return contract."""
        last_error: Exception | None = None
        started = time.perf_counter()

        for attempt in range(self._max_retries + 1):
            try:
                body = await bedrock_converse.chat_completion(payload, self._settings)
                latency_ms = (time.perf_counter() - started) * 1000
                _u = body.get("usage") or {}
                note_llm_call(self._model, _u.get("prompt_tokens"), _u.get("completion_tokens"), _u.get("total_tokens"), latency_ms)
                raw_content = (body["choices"][0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)
                logger.info("{} completed model={} backend=bedrock latency_ms={:.0f}", log_label, self._model, latency_ms)
                if usage_out is not None:
                    usage = body.get("usage") or {}
                    usage_out["prompt_tokens"] = int(usage.get("prompt_tokens") or 0)
                    usage_out["completion_tokens"] = int(usage.get("completion_tokens") or 0)
                    usage_out["total_tokens"] = int(usage.get("total_tokens") or 0)
                    usage_out["latency_ms"] = latency_ms
                return parsed
            except bedrock_converse.BedrockChatError as exc:
                last_error = exc
                if not exc.retryable:
                    raise RuntimeError(f"{log_label} rejected by Bedrock: {exc}") from exc
                await asyncio.sleep(min(2.0 * (attempt + 1), 30.0))
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
    per_activity_unit_entry: dict[str, dict[tuple[str, str], dict[str, Any]]] | None = None,
    capture_dates: dict[str, Any] | None = None,
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
    entries_by_activity = per_activity_unit_entry or {}
    dates = capture_dates or {}
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
        room_results: list[dict[str, Any]] = []
        for room_name in room_list:
            unit = (flat_name, room_name)
            room_activities: list[RoomActivityAssessment] = []
            applicable_ids = [
                aid for aid in section_activity_ids
                if _activity_applies_to_room(activities_by_id[aid], room_name)
            ]
            for activity_id in sorted(applicable_ids, key=lambda a: activities_by_id[a].sequence_index):
                act_def = activities_by_id[activity_id]
                units_pct = per_activity_unit_pct.get(activity_id)
                if not units_pct or unit not in units_pct:
                    continue
                entry = entries_by_activity.get(activity_id, {}).get(unit)
                capture_id = per_activity_unit_evidence.get(activity_id, {}).get(unit) or ""
                unknown = bool(entry) and entry.get("pct") is None
                pct = 0.0 if unknown else units_pct[unit]
                evidence_ids = (
                    list(entry.get("evidence_ids") or []) if entry is not None
                    else ([capture_id] if capture_id else [])
                )
                detection = (entry or {}).get("detection") or "direct"
                if unknown:
                    room_status: ActivityStatus = "not_assessed"
                elif act_def.observability == "concealed" or act_def.observability == "document_only":
                    room_status = "not_observable"
                elif pct >= COMPLETED_STATUS_PCT:
                    room_status = "completed"
                elif pct > 0 or (entry is None and bool(capture_id)):
                    room_status = "in_progress"
                else:
                    room_status = "no_evidence"
                details = [
                    {
                        "captureId": cid,
                        "role": detection,
                        "flatName": flat_name,
                        "roomName": room_name,
                        "views": list((entry or {}).get("views") or []),
                        "capturedAt": dates.get(cid),
                        "confidencePct": round(float((entry or {}).get("conf") or 0.0), 1),
                    }
                    for cid in evidence_ids
                ]
                room_activities.append(
                    RoomActivityAssessment(
                        activity_id=activity_id,
                        activity_name=act_def.name,
                        completion_pct=pct,
                        confidence_pct=per_activity_unit_conf.get(activity_id, {}).get(unit, 0.0),
                        evidence_capture_ids=evidence_ids,
                        evidence=per_activity_unit_evidence_text.get(activity_id, {}).get(unit, ""),
                        status=room_status,
                        assessment_status=status_for_pct(None if unknown else pct),
                        detection_type=detection,
                        visual_indicators_found=list((entry or {}).get("indicators_found") or []),
                        visual_indicators_missing=list((entry or {}).get("indicators_missing") or []),
                        explanation=str((entry or {}).get("explanation") or ""),
                        review_required=bool((entry or {}).get("review_required")),
                        review_reason=str((entry or {}).get("review_reason") or ""),
                        evidence_details=details,
                        inferred_from=str((entry or {}).get("inferred_from") or ""),
                        last_captured_at=(entry or {}).get("last_captured_at"),
                    )
                )
            # Numbers come from the ONE aggregation module (progress_aggregation) - never re-derived here.
            metrics = room_metrics(
                {
                    "capturesCount": 1 if room_activities else 0,
                    "activities": [
                        {
                            "activityId": a.activity_id,
                            "completionPct": a.completion_pct,
                            "assessmentStatus": a.assessment_status,
                            "status": a.status,
                            "reviewRequired": a.review_required,
                        }
                        for a in room_activities
                    ],
                },
                applicable_ids,
            )
            room_results.append(metrics)
            rooms.append(RoomProgress(room_name=room_name, is_complete=metrics["isComplete"], activities=room_activities))

        fm = flat_metrics(room_results, rooms_required)
        flats.append(
            FlatProgress(
                flat_name=flat_name,
                completion_pct=fm["completionPct"],
                rooms_complete=fm["roomsComplete"],
                rooms_total=rooms_required,
                rooms=rooms,
                rooms_required=rooms_required,
                rooms_photographed=fm["roomsPhotographed"],
                is_fully_complete=fm["isFullyComplete"],
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
