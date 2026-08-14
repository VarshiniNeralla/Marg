"""
Query planning for Drishti — decides which data to fetch for a given
question.

There is no existing NLU/intent-classification layer anywhere in this repo,
and real project/tower/floor/flat names are free text (not a fixed enum), so
a keyword/regex heuristic alone can't generalize across orgs. This module
uses a first, cheap LLM classification call to get intent + rough scope
hints, then resolves those hints against the project's actual known entity
names via fuzzy matching — never trusting the LLM's raw string as an id.

A defensive fallback layer sits underneath the LLM call: if classification
fails outright, or scope hints don't match anything real, the planner falls
back to the conversation's previous scope, then to project-level — it never
raises and never blocks the user from getting *some* answer.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from typing import Any, Optional

from app.services import drishti_llm_client
from app.services.drishti_prompts import DRISHTI_CLASSIFIER_PROMPT

_VALID_INTENTS = {
    "project_overview", "tower_status", "floor_status", "flat_status",
    "forecast", "comparison", "quality_query", "general",
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
    needs_forecast: bool = False
    needs_quality_notes: bool = False
    resolved_scope_for_persistence: dict[str, Any] = field(default_factory=dict)


class DrishtiQueryPlanner:
    async def plan(
        self,
        question: str,
        conversation_history: list[dict[str, Any]],
        known_entities: dict[str, Any],
        previous_scope: dict[str, Any],
    ) -> QueryPlan:
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
        flat_name = self._resolve_flat(scope_hints.get("flatName"), known_entities)
        room_name = scope_hints.get("roomName") or None

        # Nothing resolved and this isn't an explicit project-wide question —
        # fall back to sticky context from the prior turn rather than losing
        # scope on a short follow-up like "why is that?"
        if not any([tower_id, floor_id, flat_name]) and intent not in ("project_overview", "general"):
            tower_id = tower_id or previous_scope.get("towerId")
            tower_name = tower_name or previous_scope.get("towerName")
            floor_id = floor_id or previous_scope.get("floorId")
            floor_name = floor_name or previous_scope.get("floorName")
            flat_name = flat_name or previous_scope.get("flatName")
            room_name = room_name or previous_scope.get("roomName")

        resolved_scope = {
            "towerId": tower_id, "towerName": tower_name,
            "floorId": floor_id, "floorName": floor_name,
            "flatName": flat_name, "roomName": room_name,
        }

        return QueryPlan(
            intent=intent,
            tower_id=tower_id, tower_name=tower_name,
            floor_id=floor_id, floor_name=floor_name,
            flat_name=flat_name, room_name=room_name,
            needs_forecast=bool(raw.get("needsForecast")),
            needs_quality_notes=bool(raw.get("needsQualityNotes")),
            resolved_scope_for_persistence=resolved_scope,
        )

    async def _classify(
        self, question: str, conversation_history: list[dict[str, Any]], known_entities: dict[str, Any]
    ) -> dict[str, Any]:
        towers = [t.get("towerName") for t in known_entities.get("towers", [])]
        floors = [f.get("floorName") for t in known_entities.get("towers", []) for f in t.get("floors", [])]
        history_lines = [
            f"{m.get('role')}: {m.get('content')}" for m in conversation_history[-6:]
        ]
        user_prompt = (
            f"Known towers: {towers}\n"
            f"Known floors: {floors}\n"
            f"Recent conversation:\n" + "\n".join(history_lines) + "\n\n"
            f"Question: {question}"
        )
        return await drishti_llm_client.chat_completion_json(
            DRISHTI_CLASSIFIER_PROMPT, user_prompt, max_tokens=300, temperature=0.0,
        )

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

    def _resolve_flat(self, hint: Optional[str], known_entities: dict[str, Any]) -> Optional[str]:
        # Flat names aren't part of `known_entities` (project/tower/floor
        # rollup only carries floor-level data) — pass the hint through as-is
        # and let DrishtiContextService.get_flat_context do its own
        # case-insensitive match against the floor's actual roster.
        return hint or None

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
