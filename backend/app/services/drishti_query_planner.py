"""
Query planning for Drishti — decides which data to fetch for a given
question, and resolves every entity the question refers to against REAL
project data before any retrieval happens.

There is no existing NLU/intent-classification layer anywhere in this repo,
and real project/tower/floor/flat/room/common-area/activity names are free
text (not a fixed enum), so a keyword/regex heuristic alone can't generalize
across orgs. This module uses a first, cheap LLM classification call to get
intent + rough scope hints, then resolves those hints against the project's
actual known entity names via fuzzy matching — never trusting the LLM's raw
string as an id, and never letting the LLM search or calculate anything
itself.

Resolution happens in TWO phases because tower/floor candidates are cheap
(always available from the project rollup) while flat/room/common-area
candidates require a floor snapshot that's only worth fetching once a floor
is already in scope:

  Phase 1 (`plan`): classify intent + resolve tower/floor (cheap, no
  snapshot needed) — mirrors the original single-phase design for the parts
  that don't need floor-level data.

  Phase 2 (`resolve_entities`): given the floor snapshot DrishtiService
  already had to fetch for retrieval, resolve flat/room/common-area/activity
  names against that snapshot's ACTUAL roster — never a blind guess.

A defensive fallback layer sits underneath every resolution step: if
classification fails outright, or a hint doesn't match anything real, the
planner falls back to the conversation's previous scope, then to
project-level — it never raises and never blocks the user from getting
*some* answer. Crucially, failing to match an entity is NOT treated as a
planner failure — it produces an explicit "not_configured" resolution
status that the answer prompt is told to phrase honestly, rather than
silently discarding the question.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from app.services import drishti_llm_client
from app.services.construction_progress_providers.activities import activities_as_dicts
from app.services.drishti_prompts import DRISHTI_CLASSIFIER_PROMPT
from app.services.flat_finishing_rosters import _COMMON_AREA_CANONICAL

_COMMON_AREA_FLAT = "Common Area"

_VALID_INTENTS = {
    "project_overview", "tower_status", "floor_status", "flat_status",
    "room_status", "common_area_status", "location_activities",
    "activity_status", "common_area_activity_status", "activity_list",
    "activity_ranking", "flat_ranking", "common_area_ranking",
    "unfinished_work", "capture_gap", "management_summary",
    "forecast", "comparison", "quality_query", "general",
}

# Intents that need a floor's actual flat/room/common-area roster resolved
# against real data before retrieval — anything narrower than "whole floor".
_INTENTS_NEEDING_FLOOR_SNAPSHOT = {
    "flat_status", "room_status", "common_area_status", "location_activities",
    "activity_status", "common_area_activity_status", "activity_list",
    "activity_ranking", "flat_ranking", "common_area_ranking",
    "unfinished_work", "capture_gap", "comparison",
}

# Valid values for scopeHints.activityListStatus — mirrors the real
# ActivityStatus taxonomy (construction_progress_providers/base.py) exactly,
# so a listing question can never invent a status that doesn't exist.
_VALID_ACTIVITY_LIST_STATUSES = {"in_progress", "completed", "not_assessed", "not_observable", "no_evidence"}

_RANKING_INTENTS = {
    "activity_ranking", "flat_ranking", "common_area_ranking", "unfinished_work",
}

# Category keywords a manager actually says ("tiling", "MEP", "painting")
# rarely match one single activity name by string similarity — e.g.
# "tiling"/"tiles" shares no substring and no useful difflib ratio with the
# real activity name "Vitrified Flooring". Plain fuzzy matching against
# ALL_ACTIVITIES' names alone (see `_resolve_activity_ids`) silently fails
# for exactly these common, everyday terms, so each keyword is mapped here
# to every real activity id it plausibly covers (built from the frozen ids
# in construction_progress_providers/activities.py — never invents an id,
# only groups existing ones). Checked BEFORE falling back to name-similarity
# matching, and can resolve to multiple ids (e.g. "MEP" legitimately spans
# both MEP-named activities plus the closely related plumbing/electrical
# work items) — callers must be prepared to search/report on more than one
# activity for a single keyword.
_ACTIVITY_KEYWORD_ALIASES: dict[str, list[str]] = {
    "tiling": [
        "flat.vitrified_flooring_16", "flat.toilet_utility_balcony_flooring_14",
        "flat.toilet_utility_dado_15", "flat.toilet_grouting_30",
        "common.corridor_flooring_3", "common.staircase_flooring_8",
    ],
    "tiles": [
        "flat.vitrified_flooring_16", "flat.toilet_utility_balcony_flooring_14",
        "flat.toilet_utility_dado_15", "flat.toilet_grouting_30",
        "common.corridor_flooring_3", "common.staircase_flooring_8",
    ],
    "flooring": [
        "flat.floor_screed_1", "flat.vitrified_flooring_16",
        "flat.toilet_utility_balcony_flooring_14",
        "common.corridor_flooring_3", "common.staircase_flooring_8",
    ],
    "floor": [
        "flat.floor_screed_1", "flat.vitrified_flooring_16",
        "flat.toilet_utility_balcony_flooring_14",
        "common.corridor_flooring_3", "common.staircase_flooring_8",
    ],
    "painting": [
        "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26",
        "flat.primer_1st_coat_paint_27", "flat.final_coat_paint_37",
        "common.putty_1st_coat_4", "common.putty_2nd_coat_5",
        "common.primer_1st_coat_paint_6", "common.painting_2nd_coat_9",
    ],
    "paint": [
        "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26",
        "flat.primer_1st_coat_paint_27", "flat.final_coat_paint_37",
        "common.putty_1st_coat_4", "common.putty_2nd_coat_5",
        "common.primer_1st_coat_paint_6", "common.painting_2nd_coat_9",
    ],
    "punning": ["flat.ceiling_punning_2", "flat.wall_punning_4", "common.wall_punning_works_1"],
    "putty": [
        "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26",
        "common.putty_1st_coat_4", "common.putty_2nd_coat_5",
    ],
    "false ceiling": [
        "flat.false_ceiling_framing_6", "flat.false_ceiling_boxing_24",
        "flat.false_ceiling_in_toilets_sitouts_utilities_28", "common.false_ceiling_works_2",
    ],
    "ceiling": [
        "flat.ceiling_punning_2", "flat.false_ceiling_framing_6", "flat.false_ceiling_boxing_24",
        "flat.false_ceiling_in_toilets_sitouts_utilities_28", "common.false_ceiling_works_2",
    ],
    "electrical": [
        "flat.electrical_wiring_23", "flat.modular_switches_sockets_signal_booster_fixing_31",
        "flat.fa_fixing_32", "common.mep_works_fire_fighting_electrical_0",
    ],
    "electricity": [
        "flat.electrical_wiring_23", "flat.modular_switches_sockets_signal_booster_fixing_31",
        "flat.fa_fixing_32", "common.mep_works_fire_fighting_electrical_0",
    ],
    "plumbing": [
        "flat.mep_ceiling_services_plumbing_fire_gas_3", "flat.plumbing_pvc_waterline_7",
        "flat.plumbing_diverter_flush_valve_fixing_10", "flat.cp_fixtures_sanitary_fixtures_34",
        "flat.waterproofing_8", "flat.gas_meter_fixing_33",
    ],
    "mep": [
        "flat.mep_ceiling_services_plumbing_fire_gas_3", "flat.electrical_wiring_23",
        "flat.plumbing_pvc_waterline_7", "flat.plumbing_diverter_flush_valve_fixing_10",
        "flat.fa_fixing_32", "flat.gas_meter_fixing_33",
        "common.mep_works_fire_fighting_electrical_0",
    ],
    "doors": [
        "flat.main_door_frame_5", "flat.toilet_door_frame_9", "flat.internal_door_frames_18",
        "flat.main_door_shutter_fixing_temporary_21", "flat.internal_door_shutter_fixing_with_hardware_22",
        "flat.main_door_internal_door_polishing_36", "common.fire_doors_shaft_doors_7",
    ],
    "windows": [
        "flat.window_w3a_utility_door_sld_fixing_20", "flat.ventilator_fixing_11",
    ],
    "doors/windows": [
        "flat.main_door_frame_5", "flat.toilet_door_frame_9", "flat.internal_door_frames_18",
        "flat.main_door_shutter_fixing_temporary_21", "flat.internal_door_shutter_fixing_with_hardware_22",
        "flat.main_door_internal_door_polishing_36", "common.fire_doors_shaft_doors_7",
        "flat.window_w3a_utility_door_sld_fixing_20", "flat.ventilator_fixing_11",
    ],
    "cleaning": ["flat.normal_cleaning_29", "flat.deep_cleaning_38"],
}


def _resolve_activity_ids(hint: str, all_activities: list[dict[str, Any]]) -> list[str]:
    """Resolves a user's activity keyword to every real activity id it
    plausibly covers. Checks the category-keyword alias map first (case-
    insensitive exact match on the whole hint, since that's how the
    classifier is prompted to phrase `activityName`), then falls back to
    single-activity name-similarity matching for a hint that already names
    one specific real activity (e.g. "wall punning", "final coat paint")."""
    normalized = hint.strip().lower()
    alias_ids = _ACTIVITY_KEYWORD_ALIASES.get(normalized)
    if alias_ids:
        valid_ids = {a["activityId"] for a in all_activities}
        return [aid for aid in alias_ids if aid in valid_ids]

    names = [a["name"] for a in all_activities]
    match = _closest_match(hint, names)
    if not match:
        return []
    matched_def = next(a for a in all_activities if a["name"] == match)
    return [matched_def["activityId"]]


def _scan_question_for_activity_keyword(question: str) -> Optional[str]:
    """Deterministic safety net, independent of the LLM classifier: scans
    the raw question text for any known category keyword/activity name. A
    small local classifier model does not reliably populate `activityName`
    for every intent that needs it (confirmed in practice: a real "painting
    works in the Common Areas" question came back from the model with no
    activityName set at all, silently producing an empty facts payload and
    forcing the answer model to improvise from stale conversation history
    instead of real data). This never REPLACES the classifier's own
    activityName when present — it only fills the gap when the classifier
    left it empty but the question plainly names a category."""
    lower = question.lower()
    for keyword in _ACTIVITY_KEYWORD_ALIASES:
        if re.search(rf"\b{re.escape(keyword)}\b", lower):
            return keyword
    for activity in activities_as_dicts():
        if activity["name"].lower() in lower:
            return activity["name"]
    return None


_FLATS_SCOPE_PATTERN = re.compile(r"\bflats?\b|\bapartments?\b|\bunits?\b", re.IGNORECASE)
_COMMON_AREAS_SCOPE_PATTERN = re.compile(r"\bcommon\s+areas?\b|\bshared\s+spaces?\b", re.IGNORECASE)


def _scan_question_for_activity_list_scope(question: str) -> Optional[str]:
    """Deterministic safety net for "activity_list" location scoping — a
    bare follow-up like "in the flats?" must reliably narrow (or, from a
    prior common-area scope, RE-scope) the listing to flats only, without
    depending on the classifier consistently populating a location hint for
    this intent. Checked in addition to (not instead of) the classifier's
    own flatName/commonAreaName hints — see `plan()`."""
    if _FLATS_SCOPE_PATTERN.search(question):
        return "flats"
    if _COMMON_AREAS_SCOPE_PATTERN.search(question):
        return "common_areas"
    return None


def _scan_question_for_common_area(question: str) -> Optional[str]:
    """Same safety net as `_scan_question_for_activity_keyword`, for common
    area names — a "what other activities are pending in the Lift Lobby"
    question must resolve "Lift Lobby" even if the classifier mis-set
    commonAreaName to null for an unexpected intent choice."""
    lower = question.lower()
    for name in _COMMON_AREA_CANONICAL:
        if re.search(rf"\b{re.escape(name.lower())}\b", lower):
            return name
    # Common colloquial aliases the canonical-name scan above would miss.
    aliases = {
        "elevator lobby": "Lift Lobby", "lift": "Lift Lobby",
        "stairs": "Staircase", "stairwell": "Staircase", "stair case": "Staircase",
        "main lobby": "Entrance Lobby",
    }
    for alias, canonical in aliases.items():
        if re.search(rf"\b{re.escape(alias)}\b", lower):
            return canonical
    return None


# Deterministic safety net for flat/floor identifiers named directly in the
# raw question — a real production bug: "what about flat 02 of floor 1?"
# was answered "no entry for Flat 02 mapped to Floor 1" because the
# classifier's scopeHints did not reliably carry a clean flatName/floorName
# for this phrasing (word order "flat X OF floor Y" is less common in
# training data than "floor Y's flat X"), and relying on the classifier
# alone for these two hints has repeatedly proven unreliable in this
# codebase (see _scan_question_for_activity_keyword/_scan_question_for_common_area
# docstrings for the same lesson learned earlier this session). These scans
# run directly against the question text, independent of the classifier,
# and only fill a gap — they never override a hint the classifier DID supply.
_FLAT_NUMBER_PATTERN = re.compile(
    r"\b(?:flat|apartment|unit)\s*[-#]?\s*(\d+)\b", re.IGNORECASE,
)
_FLOOR_NUMBER_PATTERN = re.compile(
    r"\bfloor\s*[-#]?\s*(\d+)\b", re.IGNORECASE,
)


def _scan_question_for_flat_name(question: str) -> Optional[str]:
    match = _FLAT_NUMBER_PATTERN.search(question)
    if not match:
        return None
    return f"Flat {int(match.group(1)):02d}"


def _scan_question_for_floor_name(question: str) -> Optional[str]:
    match = _FLOOR_NUMBER_PATTERN.search(question)
    if not match:
        return None
    return f"Floor {int(match.group(1))}"


# Regex patterns matched against the raw question text for the two intents
# most prone to LLM misclassification in practice — both involve a subtler
# distinction ("all common areas" vs "one area"; "everything here" vs "one
# thing") that prose-only classifier instructions did not reliably produce
# from a small local model, even after being spelled out in detail.
_COMMON_AREA_ACTIVITY_PATTERN = re.compile(
    r"\b(?:in|across|for)\s+(?:the\s+)?common\s+area", re.IGNORECASE,
)
_LOCATION_ACTIVITIES_PATTERN = re.compile(
    r"\b(?:other|else)\b.{0,30}\bactivit", re.IGNORECASE,
)
# Requires an actual location signal ("in/at the <place>") alongside the
# "other activities" phrasing above — a bare "which activities are in
# progress" (a pure activity_list status question, no location named) must
# NOT be corrected into location_activities just because it contains the
# word "which" near "activities"; only "...OTHER activities... IN <place>"
# should. Matched separately from the canonical common-area list so it also
# covers a named flat/room ("...other activities pending in Bedroom-3").
_LOCATION_SIGNAL_PATTERN = re.compile(r"\b(?:in|at|for)\s+(?:the\s+)?\w", re.IGNORECASE)


def _correct_intent_from_question(intent: str, question: str) -> str:
    """Deterministic post-classification correction for the two patterns
    confirmed to trip up the classifier in practice: a question that
    explicitly says "in/across the Common Area(s)" alongside an activity
    category must aggregate across every unit (`common_area_activity_status`),
    never one named unit or one activity found "anywhere"; and a question
    asking for "other activities" AT A NAMED LOCATION that was scoped down
    to a specific place (activity_status/common_area_status/activity_list
    all being about ONE axis each) really means "everything here"
    (`location_activities`). Never overrides an intent that's already
    correct or unrelated — only nudges these two specific confusions. The
    location-signal requirement matters: a bare "which activities are in
    progress" (no location named at all) is a legitimate activity_list
    question and must NOT be corrected just because "which"/"activities"
    both appear — only "...OTHER activities...IN <place>" should."""
    if _COMMON_AREA_ACTIVITY_PATTERN.search(question) and intent in ("activity_status", "common_area_status"):
        return "common_area_activity_status"
    if (
        _LOCATION_ACTIVITIES_PATTERN.search(question)
        and _LOCATION_SIGNAL_PATTERN.search(question)
        and intent in ("activity_status", "general", "common_area_status", "activity_list")
    ):
        return "location_activities"
    return intent


# Intents whose retrieval is legitimately project-wide by default — a stale
# floor/tower from an unrelated earlier turn must NEVER silently narrow one
# of these down to one location just because the current question didn't
# repeat the location; each already has its own project-wide code path
# (`find_activity_across_project`, `get_common_area_category_status_across_project`,
# `_rooms_across_project`) that only activates when floor_id is falsy.
_PROJECT_WIDE_BY_DEFAULT_INTENTS = {
    "activity_status", "common_area_activity_status", "activity_list",
    "activity_ranking", "unfinished_work",
}


@dataclass
class QueryPlan:
    intent: str
    tower_id: Optional[str] = None
    tower_name: Optional[str] = None
    floor_id: Optional[str] = None
    floor_name: Optional[str] = None
    # Populated instead of floor_id/floor_name when the question names TWO OR
    # MORE floors at once ("progress for Floor 1 and Floor 2") — floor_status
    # is the only intent that consumes this; every other intent keeps using
    # the single floor_id/floor_name fields untouched.
    floor_ids: list[str] = field(default_factory=list)
    floor_names: list[str] = field(default_factory=list)
    flat_name: Optional[str] = None
    room_name: Optional[str] = None
    common_area_name: Optional[str] = None
    activity_name: Optional[str] = None
    activity_id: Optional[str] = None
    # Every real activity id a category keyword ("tiling", "MEP", "painting",
    # "doors") legitimately maps to — a keyword is rarely one single named
    # activity in this data model. `activity_id` (above) is kept as the
    # first entry for callers/tests that only care about one id; new code
    # should search across all of `activity_ids`.
    activity_ids: list[str] = field(default_factory=list)
    # For "activity_list" intent — which real ActivityStatus value(s) the
    # user wants listed ("which activities are in progress", "what are
    # those 27 activities [that were previously summarized as in progress]").
    activity_list_statuses: list[str] = field(default_factory=list)
    # For "activity_list" intent — narrows the LOCATION side of the listing
    # independent of flat_name/common_area_name (which name ONE specific
    # unit): "flats" = every real flat, no common areas; "common_areas" =
    # every common-area unit, no flats; None = everything (the default).
    activity_list_scope: Optional[str] = None
    ranking_target: Optional[str] = None
    ranking_direction: Optional[str] = None
    needs_forecast: bool = False
    needs_quality_notes: bool = False
    # Per-entity: "found" | "not_configured" | "configured_no_evidence" — set
    # during phase 2 once a snapshot is available to check against; empty
    # for entities that were never requested. NEVER used to trigger the
    # generic LLM-failure fallback text — that's reserved for genuine
    # LLM/validation errors only (see drishti_service.py).
    resolution_status: dict[str, str] = field(default_factory=dict)
    resolved_scope_for_persistence: dict[str, Any] = field(default_factory=dict)

    @property
    def needs_floor_snapshot(self) -> bool:
        return bool(self.floor_id) and self.intent in _INTENTS_NEEDING_FLOOR_SNAPSHOT


class DrishtiQueryPlanner:
    async def plan(
        self,
        question: str,
        conversation_history: list[dict[str, Any]],
        known_entities: dict[str, Any],
        previous_scope: dict[str, Any],
    ) -> QueryPlan:
        """Phase 1 — classify intent, resolve tower/floor (cheap, no
        snapshot). Flat/room/common-area/activity hints are carried on the
        plan as raw (unresolved) strings for phase 2 to pick up via
        `resolve_entities` once a floor snapshot is available."""
        try:
            raw = await self._classify(question, conversation_history, known_entities)
        except Exception:
            return self._fallback_plan(previous_scope)

        intent = str(raw.get("intent") or "").strip()
        if intent not in _VALID_INTENTS:
            return self._fallback_plan(previous_scope)

        intent = _correct_intent_from_question(intent, question)
        scope_hints = raw.get("scopeHints") or {}
        tower_id, tower_name = self._resolve_tower(scope_hints.get("towerName"), known_entities)
        floor_id, floor_name = self._resolve_floor(scope_hints.get("floorName"), known_entities)
        floor_ids, floor_names = self._resolve_floors(scope_hints.get("floorNames"), known_entities)

        # Deterministic safety net: a small local classifier model does not
        # reliably populate floorName for every phrasing that names a floor
        # (e.g. "flat 02 OF floor 1" — less common word order than "floor
        # 1's flat 02"), confirmed live — a "Floor N" question with no
        # classifier-provided floorName silently fell through to whatever
        # the sticky-scope fallback below produced (or nothing at all), even
        # though the floor number was sitting right there in the question.
        # Never overrides a hint the classifier DID resolve.
        if not floor_id and not floor_ids:
            scanned_floor_name = _scan_question_for_floor_name(question)
            if scanned_floor_name:
                floor_id, floor_name = self._resolve_floor(scanned_floor_name, known_entities)

        # Sticky tower/floor fallback for follow-ups ("why is that?") that
        # don't restate scope — only when the intent isn't explicitly
        # project-wide and nothing new was resolved. Intents in
        # `_PROJECT_WIDE_BY_DEFAULT_INTENTS` (activity_status,
        # common_area_activity_status, activity_list, activity_ranking,
        # unfinished_work) are explicitly excluded: a real bug traced to
        # this exact line let a stale floor from an unrelated earlier turn
        # silently narrow "how is MEP progressing ACROSS THE PROJECT" down
        # to just one floor, so it reported "not_configured" for an
        # activity that genuinely existed and was scored on other floors.
        if (
            not tower_id and not floor_id
            and intent not in ("project_overview", "general")
            and intent not in _PROJECT_WIDE_BY_DEFAULT_INTENTS
        ):
            tower_id = previous_scope.get("towerId")
            tower_name = previous_scope.get("towerName")
            floor_id = previous_scope.get("floorId")
            floor_name = previous_scope.get("floorName")

        ranking_target = scope_hints.get("rankingTarget") or None
        ranking_direction = scope_hints.get("rankingDirection") or None
        raw_statuses = scope_hints.get("activityListStatuses") or []
        activity_list_statuses = [s for s in raw_statuses if s in _VALID_ACTIVITY_LIST_STATUSES]

        activity_name_hint = scope_hints.get("activityName") or None
        common_area_hint = scope_hints.get("commonAreaName") or None

        # Deterministic safety net: a small local classifier model does not
        # reliably populate activityName/commonAreaName for every intent
        # that structurally needs them — confirmed in practice, not just in
        # theory (see `_scan_question_for_activity_keyword`'s docstring).
        # Never overrides a hint the classifier DID provide; only fills a
        # gap for intents whose entire retrieval path depends on it.
        if not activity_name_hint and intent in (
            "activity_status", "common_area_activity_status", "activity_ranking", "unfinished_work",
        ):
            activity_name_hint = _scan_question_for_activity_keyword(question)
        if not common_area_hint and intent in ("common_area_status", "location_activities"):
            common_area_hint = _scan_question_for_common_area(question)

        activity_list_scope = None
        if intent == "activity_list":
            activity_list_scope = _scan_question_for_activity_list_scope(question)

        flat_name_hint = scope_hints.get("flatName") or None
        if not flat_name_hint and intent in (
            "flat_status", "room_status", "activity_status", "location_activities",
        ):
            flat_name_hint = _scan_question_for_flat_name(question)

        plan = QueryPlan(
            intent=intent,
            tower_id=tower_id, tower_name=tower_name,
            floor_id=floor_id, floor_name=floor_name,
            floor_ids=floor_ids, floor_names=floor_names,
            # Raw hints carried through for phase 2 to resolve against a
            # real snapshot; sticky fallback for these happens there too,
            # once we know whether phase-2 resolution found anything.
            flat_name=flat_name_hint,
            room_name=scope_hints.get("roomName") or None,
            common_area_name=common_area_hint,
            activity_name=activity_name_hint,
            activity_list_statuses=activity_list_statuses,
            activity_list_scope=activity_list_scope,
            ranking_target=ranking_target,
            ranking_direction=ranking_direction,
            needs_forecast=bool(raw.get("needsForecast")),
            needs_quality_notes=bool(raw.get("needsQualityNotes")),
        )
        return plan

    async def _classify(
        self, question: str, conversation_history: list[dict[str, Any]], known_entities: dict[str, Any]
    ) -> dict[str, Any]:
        towers = [t.get("towerName") for t in known_entities.get("towers", [])]
        floors = [f.get("floorName") for t in known_entities.get("towers", []) for f in t.get("floors", [])]
        activity_names = [a["name"] for a in activities_as_dicts()]
        history_lines = [
            f"{m.get('role')}: {m.get('content')}" for m in conversation_history[-6:]
        ]
        user_prompt = (
            f"Known towers: {towers}\n"
            f"Known floors: {floors}\n"
            f"Known common areas (project-wide vocabulary, may not all exist on every floor): {_COMMON_AREA_CANONICAL}\n"
            f"Known activities (project-wide vocabulary): {activity_names}\n"
            f"Recent conversation:\n" + "\n".join(history_lines) + "\n\n"
            f"Question: {question}"
        )
        return await drishti_llm_client.chat_completion_json(
            DRISHTI_CLASSIFIER_PROMPT, user_prompt, max_tokens=400, temperature=0.0,
        )

    # ── Phase 2 — resolve flat/room/common-area/activity against real data ──

    def resolve_entities(
        self, plan: QueryPlan, floor_snapshot: Optional[dict[str, Any]], previous_scope: dict[str, Any],
    ) -> QueryPlan:
        """Given the floor snapshot DrishtiService fetched for retrieval
        (or None if no floor is in scope / the floor was never analyzed),
        fuzzy-resolve flat/room/common-area names against that snapshot's
        REAL roster, and activity name against the project-invariant
        activity list. Sets `resolution_status` per entity that was
        requested. Never raises — an unresolvable hint just carries forward
        as `not_configured` for the answer prompt to phrase honestly."""
        flat_progress = (floor_snapshot or {}).get("flatProgress", []) if floor_snapshot else []
        real_flats = [f for f in flat_progress if str(f.get("flatName") or "") != _COMMON_AREA_FLAT]
        common_flat = next((f for f in flat_progress if str(f.get("flatName") or "") == _COMMON_AREA_FLAT), None)

        # ── Flat ──
        # "activity_list" defaults to project-wide — a prior turn's specific
        # flat must not silently narrow a fresh "which activities are X"
        # question down to just that flat.
        flat_hint = plan.flat_name or (
            previous_scope.get("flatName")
            if plan.intent not in ("project_overview", "general", "activity_list")
            else None
        )
        resolved_flat_name = None
        if flat_hint:
            flat_hint = _strip_trailing_location_qualifier(flat_hint)
            candidates = [f.get("flatName") or "" for f in real_flats]
            match = _closest_identifier_match(flat_hint, candidates)
            if match:
                resolved_flat_name = match
                plan.resolution_status["flat"] = "found"
            elif floor_snapshot is not None:
                plan.resolution_status["flat"] = "not_configured"
            resolved_flat_name = resolved_flat_name or flat_hint
        plan.flat_name = resolved_flat_name

        # ── Room (within the resolved flat) ──
        room_hint = plan.room_name or (previous_scope.get("roomName") if plan.intent not in ("project_overview", "general") else None)
        if room_hint and resolved_flat_name:
            room_hint = _strip_trailing_location_qualifier(room_hint)
            flat_doc = next((f for f in real_flats if f.get("flatName") == resolved_flat_name), None)
            room_candidates = [r.get("roomName") or "" for r in (flat_doc or {}).get("rooms", [])]
            match = _closest_identifier_match(room_hint, room_candidates)
            plan.room_name = match or room_hint
            if floor_snapshot is not None:
                plan.resolution_status["room"] = "found" if match else "not_configured"
        elif room_hint:
            plan.room_name = room_hint

        # ── Common area ──
        # "common_area_activity_status" means "aggregate across ALL common
        # areas" by design — never carry forward one previously-named unit
        # onto it, or the whole point of asking for every unit is defeated.
        # "activity_list" defaults to project-wide (every flat AND common
        # area) unless THIS turn explicitly narrows it — a stale
        # commonAreaName from an unrelated earlier turn must never silently
        # narrow "which activities are X" down to common areas only, which
        # previously made a bare follow-up like "in the flats?" appear to
        # have no flat data at all even though it plainly does.
        common_area_hint = plan.common_area_name or (
            previous_scope.get("commonAreaName")
            if plan.intent not in ("project_overview", "general", "common_area_activity_status", "activity_list")
            else None
        )
        if common_area_hint:
            # Canonicalize against the project-wide vocabulary first (handles
            # aliases/typos like "elevator lobby" -> "Lift Lobby"), then
            # confirm the canonical name actually exists on THIS floor.
            canonical = _closest_match(common_area_hint, _COMMON_AREA_CANONICAL) or common_area_hint
            if common_flat is not None:
                on_floor_candidates = [r.get("roomName") or "" for r in common_flat.get("rooms", [])]
                match = _closest_match(canonical, on_floor_candidates) or _closest_match(common_area_hint, on_floor_candidates)
                plan.common_area_name = match or canonical
                if floor_snapshot is not None:
                    plan.resolution_status["commonArea"] = "found" if match else "not_configured"
            else:
                plan.common_area_name = canonical
                if floor_snapshot is not None:
                    plan.resolution_status["commonArea"] = "not_configured"

        # ── Activity (project-invariant vocabulary, no snapshot needed) ──
        activity_hint = plan.activity_name
        if activity_hint:
            all_activities = activities_as_dicts()
            matched_ids = _resolve_activity_ids(activity_hint, all_activities)
            if matched_ids:
                plan.activity_ids = matched_ids
                plan.activity_id = matched_ids[0]
                # Keep activity_name as the user's own wording when it maps to
                # several real activities (a category keyword like "tiling" or
                # "MEP") — there is no single "matched name" to report back in
                # that case; only collapse to one canonical name for an exact/
                # near-exact single match.
                if len(matched_ids) == 1:
                    plan.activity_name = next(a["name"] for a in all_activities if a["activityId"] == matched_ids[0])
            else:
                plan.activity_name = activity_hint
                plan.activity_id = None
                plan.activity_ids = []

        plan.resolved_scope_for_persistence = {
            "towerId": plan.tower_id, "towerName": plan.tower_name,
            "floorId": plan.floor_id, "floorName": plan.floor_name,
            "flatName": plan.flat_name, "roomName": plan.room_name,
            "commonAreaName": plan.common_area_name, "activityName": plan.activity_name,
        }
        return plan

    def _resolve_tower(
        self, hint: Optional[str], known_entities: dict[str, Any]
    ) -> tuple[Optional[str], Optional[str]]:
        if not hint:
            return None, None
        towers = known_entities.get("towers", [])
        names = [t.get("towerName") or "" for t in towers]
        match = _closest_match(hint, names)
        if not match:
            return None, None
        for t in towers:
            if t.get("towerName") == match:
                return t.get("towerId"), t.get("towerName")
        return None, None

    def _resolve_floor(
        self, hint: Optional[str], known_entities: dict[str, Any]
    ) -> tuple[Optional[str], Optional[str]]:
        if not hint:
            return None, None
        all_floors = [f for t in known_entities.get("towers", []) for f in t.get("floors", [])]
        names = [f.get("floorName") or "" for f in all_floors]
        match = _closest_match(hint, names)
        if not match:
            return None, None
        for f in all_floors:
            if f.get("floorName") == match:
                return f.get("floorId"), f.get("floorName")
        return None, None

    def _resolve_floors(
        self, hints: Optional[list[str]], known_entities: dict[str, Any]
    ) -> tuple[list[str], list[str]]:
        """Resolves a "floorNames" list (2+ floors named in one question,
        e.g. "Floor 1 and Floor 2") against the real floor roster the same
        fuzzy-match way `_resolve_floor` does for a single name. Silently
        drops any hint that doesn't match a real floor rather than raising —
        the rest of the plan still proceeds with whatever DID resolve."""
        if not hints:
            return [], []
        all_floors = [f for t in known_entities.get("towers", []) for f in t.get("floors", [])]
        names = [f.get("floorName") or "" for f in all_floors]
        resolved_ids: list[str] = []
        resolved_names: list[str] = []
        for hint in hints:
            match = _closest_match(hint, names)
            if not match:
                continue
            for f in all_floors:
                if f.get("floorName") == match and f.get("floorId") not in resolved_ids:
                    resolved_ids.append(f.get("floorId"))
                    resolved_names.append(f.get("floorName"))
                    break
        return resolved_ids, resolved_names

    def _fallback_plan(self, previous_scope: dict[str, Any]) -> QueryPlan:
        has_scope = any(previous_scope.get(k) for k in ("towerId", "floorId", "flatName"))
        return QueryPlan(
            intent="general" if not has_scope else "floor_status",
            tower_id=previous_scope.get("towerId"),
            tower_name=previous_scope.get("towerName"),
            floor_id=previous_scope.get("floorId"),
            floor_name=previous_scope.get("floorName"),
            flat_name=previous_scope.get("flatName"),
            room_name=previous_scope.get("roomName"),
            common_area_name=previous_scope.get("commonAreaName"),
            activity_name=previous_scope.get("activityName"),
            resolved_scope_for_persistence=dict(previous_scope),
        )


def _closest_match(hint: str, candidates: list[str]) -> Optional[str]:
    candidates = [c for c in candidates if c]
    if not candidates:
        return None
    hint_lower = hint.strip().lower()
    for c in candidates:
        if c.strip().lower() == hint_lower:
            return c
    for c in candidates:
        if hint_lower in c.strip().lower() or c.strip().lower() in hint_lower:
            return c
    matches = difflib.get_close_matches(hint, candidates, n=1, cutoff=0.6)
    return matches[0] if matches else None


_TRAILING_DIGITS = re.compile(r"(\d+)\s*$")

# Strips a trailing tower/floor qualifier clause from a flat/room hint before
# digit-matching — a real production bug: the classifier (or a user's own
# phrasing, "flat 02 OF FLOOR 1") sometimes returns the flat/room hint with
# the floor name still attached, e.g. "Flat 02 of Floor 1". _TRAILING_DIGITS
# matches digits at the END of the string, so on that unstripped hint it
# would grab "1" (from "Floor 1") instead of "02" — searching for a flat
# ending in 1 and missing "Flat 02" entirely, reported as "not_configured"
# even though the flat plainly exists. Stripping this clause first ensures
# the trailing-digit extraction always operates on the flat/room's own
# number, never a floor/tower number that happens to trail the hint.
_TRAILING_LOCATION_QUALIFIER = re.compile(
    r"\s+(?:of|on|in)\s+(?:the\s+)?(?:tower|floor)\s+\S+\s*$", re.IGNORECASE,
)


def _strip_trailing_location_qualifier(hint: str) -> str:
    return _TRAILING_LOCATION_QUALIFIER.sub("", hint).strip()


def _closest_identifier_match(hint: str, candidates: list[str]) -> Optional[str]:
    """Like `_closest_match`, but for identifier-style names (flat/room
    labels such as "Flat 02", "Bedroom-3") where a plain similarity ratio is
    dangerously permissive — "Flat 99" and "Flat 02" score ~0.71 under
    difflib despite naming two entirely different flats. When BOTH the hint
    and a candidate end in digits, require those digits to match exactly
    before falling back to plain fuzzy matching (which still handles
    non-numeric aliases like "master bedroom" -> "Bedroom-1")."""
    candidates = [c for c in candidates if c]
    if not candidates:
        return None
    hint_lower = hint.strip().lower()
    for c in candidates:
        if c.strip().lower() == hint_lower:
            return c

    hint_digits = _TRAILING_DIGITS.search(hint.strip())
    if hint_digits:
        hint_number = int(hint_digits.group(1))
        for c in candidates:
            c_digits = _TRAILING_DIGITS.search(c.strip())
            if c_digits and int(c_digits.group(1)) == hint_number:
                return c
        # Both are numbered but no candidate shares the hint's number —
        # never fall through to a same-prefix/fuzzy match that would
        # silently pick a different flat/room number.
        return None

    for c in candidates:
        if hint_lower in c.strip().lower() or c.strip().lower() in hint_lower:
            return c
    matches = difflib.get_close_matches(hint, candidates, n=1, cutoff=0.6)
    return matches[0] if matches else None
