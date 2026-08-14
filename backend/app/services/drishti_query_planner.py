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
    "room_status", "common_area_status", "activity_status",
    "activity_ranking", "flat_ranking", "common_area_ranking",
    "unfinished_work", "capture_gap", "management_summary",
    "forecast", "comparison", "quality_query", "general",
}

# Intents that need a floor's actual flat/room/common-area roster resolved
# against real data before retrieval — anything narrower than "whole floor".
_INTENTS_NEEDING_FLOOR_SNAPSHOT = {
    "flat_status", "room_status", "common_area_status", "activity_status",
    "activity_ranking", "flat_ranking", "common_area_ranking",
    "unfinished_work", "capture_gap", "comparison",
}

_RANKING_INTENTS = {
    "activity_ranking", "flat_ranking", "common_area_ranking", "unfinished_work",
}


@dataclass
class QueryPlan:
    intent: str
    tower_id: Optional[str] = None
    tower_name: Optional[str] = None
    floor_id: Optional[str] = None
    floor_name: Optional[str] = None
    flat_name: Optional[str] = None
    room_name: Optional[str] = None
    common_area_name: Optional[str] = None
    activity_name: Optional[str] = None
    activity_id: Optional[str] = None
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

        scope_hints = raw.get("scopeHints") or {}
        tower_id, tower_name = self._resolve_tower(scope_hints.get("towerName"), known_entities)
        floor_id, floor_name = self._resolve_floor(scope_hints.get("floorName"), known_entities)

        # Sticky tower/floor fallback for follow-ups ("why is that?") that
        # don't restate scope — only when the intent isn't explicitly
        # project-wide and nothing new was resolved.
        if not tower_id and not floor_id and intent not in ("project_overview", "general"):
            tower_id = previous_scope.get("towerId")
            tower_name = previous_scope.get("towerName")
            floor_id = previous_scope.get("floorId")
            floor_name = previous_scope.get("floorName")

        ranking_target = scope_hints.get("rankingTarget") or None
        ranking_direction = scope_hints.get("rankingDirection") or None

        plan = QueryPlan(
            intent=intent,
            tower_id=tower_id, tower_name=tower_name,
            floor_id=floor_id, floor_name=floor_name,
            # Raw hints carried through for phase 2 to resolve against a
            # real snapshot; sticky fallback for these happens there too,
            # once we know whether phase-2 resolution found anything.
            flat_name=scope_hints.get("flatName") or None,
            room_name=scope_hints.get("roomName") or None,
            common_area_name=scope_hints.get("commonAreaName") or None,
            activity_name=scope_hints.get("activityName") or None,
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
        flat_hint = plan.flat_name or (previous_scope.get("flatName") if plan.intent not in ("project_overview", "general") else None)
        resolved_flat_name = None
        if flat_hint:
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
            flat_doc = next((f for f in real_flats if f.get("flatName") == resolved_flat_name), None)
            room_candidates = [r.get("roomName") or "" for r in (flat_doc or {}).get("rooms", [])]
            match = _closest_identifier_match(room_hint, room_candidates)
            plan.room_name = match or room_hint
            if floor_snapshot is not None:
                plan.resolution_status["room"] = "found" if match else "not_configured"
        elif room_hint:
            plan.room_name = room_hint

        # ── Common area ──
        common_area_hint = plan.common_area_name or (
            previous_scope.get("commonAreaName") if plan.intent not in ("project_overview", "general") else None
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
            names = [a["name"] for a in all_activities]
            match = _closest_match(activity_hint, names)
            if match:
                matched_def = next(a for a in all_activities if a["name"] == match)
                plan.activity_name = match
                plan.activity_id = matched_def["activityId"]
            else:
                plan.activity_name = activity_hint
                plan.activity_id = None

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
