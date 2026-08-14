"""Unit tests for DrishtiQueryPlanner's fuzzy-match resolution and fallback
behavior. The LLM classification call is mocked via monkeypatching
`app.services.drishti_llm_client.chat_completion_json` so these tests never
make a network call."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.services import drishti_query_planner as planner_module
from app.services.drishti_query_planner import DrishtiQueryPlanner, QueryPlan


_KNOWN_ENTITIES = {
    "towers": [
        {
            "towerId": "t1", "towerName": "Tower A",
            "floors": [
                {"floorId": "f1", "floorName": "Floor 1"},
                {"floorId": "f2", "floorName": "Floor 2"},
            ],
        },
        {
            "towerId": "t2", "towerName": "Tower B",
            "floors": [{"floorId": "f3", "floorName": "Floor 3"}],
        },
    ],
}


class TestFuzzyMatchResolution:
    @pytest.mark.asyncio
    async def test_resolves_close_floor_name_to_real_id(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={
                "intent": "floor_status",
                "scopeHints": {"towerName": None, "floorName": "floor 2", "flatName": None, "roomName": None},
                "needsForecast": False,
                "needsQualityNotes": False,
            }),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="how is floor 2 doing",
            conversation_history=[],
            known_entities=_KNOWN_ENTITIES,
            previous_scope={},
        )
        assert plan.intent == "floor_status"
        assert plan.floor_id == "f2"
        assert plan.floor_name == "Floor 2"

    @pytest.mark.asyncio
    async def test_unmatchable_scope_falls_back_to_previous_scope(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={
                "intent": "floor_status",
                "scopeHints": {"towerName": None, "floorName": "Nonexistent Floor Z", "flatName": None, "roomName": None},
                "needsForecast": False,
                "needsQualityNotes": False,
            }),
        )
        previous_scope = {"towerId": "t1", "towerName": "Tower A", "floorId": "f1", "floorName": "Floor 1"}
        plan = await DrishtiQueryPlanner().plan(
            question="why is that behind",
            conversation_history=[],
            known_entities=_KNOWN_ENTITIES,
            previous_scope=previous_scope,
        )
        assert plan.floor_id == "f1"
        assert plan.floor_name == "Floor 1"

    @pytest.mark.asyncio
    async def test_invalid_intent_falls_back_to_general(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={"intent": "not_a_real_intent", "scopeHints": {}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="asdf", conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "general"

    @pytest.mark.asyncio
    async def test_llm_call_raising_falls_back_to_general(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(side_effect=RuntimeError("timeout")),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="how is the project doing",
            conversation_history=[],
            known_entities=_KNOWN_ENTITIES,
            previous_scope={},
        )
        assert plan.intent == "general"

    @pytest.mark.asyncio
    async def test_llm_call_raising_with_previous_scope_falls_back_to_scoped(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(side_effect=RuntimeError("timeout")),
        )
        previous_scope = {"floorId": "f2", "floorName": "Floor 2"}
        plan = await DrishtiQueryPlanner().plan(
            question="what about now",
            conversation_history=[],
            known_entities=_KNOWN_ENTITIES,
            previous_scope=previous_scope,
        )
        assert plan.floor_id == "f2"


# ── Phase-2 entity resolution (flat/room/common-area/activity) ─────────────

_FLOOR_SNAPSHOT = {
    "floorId": "f2",
    "flatProgress": [
        {
            "flatName": "Flat 02", "completionPct": 60.0,
            "rooms": [
                {"roomName": "Bedroom-3", "activities": [], "capturesCount": 2},
                {"roomName": "Kitchen", "activities": [], "capturesCount": 1},
            ],
        },
        {
            "flatName": "Common Area", "completionPct": 40.0,
            "rooms": [
                {"roomName": "Corridor", "activities": [], "capturesCount": 3},
                {"roomName": "Lift Lobby", "activities": [], "capturesCount": 0},
            ],
        },
    ],
}


class TestFlatNameFuzzyResolution:
    def test_resolves_near_miss_flat_name(self):
        plan = QueryPlan(intent="flat_status", floor_id="f2", flat_name="flat 2")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.flat_name == "Flat 02"
        assert resolved.resolution_status["flat"] == "found"

    def test_unmatchable_flat_name_marked_not_configured(self):
        plan = QueryPlan(intent="flat_status", floor_id="f2", flat_name="Flat 99")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.resolution_status["flat"] == "not_configured"


class TestRoomNameResolution:
    def test_resolves_room_within_identified_flat(self):
        plan = QueryPlan(intent="room_status", floor_id="f2", flat_name="Flat 02", room_name="bedroom 3")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.room_name == "Bedroom-3"
        assert resolved.resolution_status["room"] == "found"

    def test_room_not_in_flat_roster_marked_not_configured(self):
        plan = QueryPlan(intent="room_status", floor_id="f2", flat_name="Flat 02", room_name="Master Suite")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.resolution_status["room"] == "not_configured"


class TestCommonAreaNameResolution:
    def test_resolves_alias_against_canonical_and_floor_roster(self):
        plan = QueryPlan(intent="common_area_status", floor_id="f2", common_area_name="elevator lobby")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.common_area_name == "Lift Lobby"
        assert resolved.resolution_status["commonArea"] == "found"

    def test_exact_canonical_name_resolves(self):
        plan = QueryPlan(intent="common_area_status", floor_id="f2", common_area_name="corridor")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.common_area_name == "Corridor"
        assert resolved.resolution_status["commonArea"] == "found"

    def test_valid_canonical_name_not_on_this_floor_marked_not_configured(self):
        plan = QueryPlan(intent="common_area_status", floor_id="f2", common_area_name="staircase")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.resolution_status["commonArea"] == "not_configured"


class TestActivityNameResolution:
    def test_resolves_near_miss_activity_name(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="wall punning works")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_name is not None
        assert resolved.activity_id is not None
        assert resolved.activity_id.startswith("flat.") or resolved.activity_id.startswith("common.")

    def test_unmatchable_activity_name_keeps_raw_hint_no_id(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="quantum flux capacitor install")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_id is None


class TestRankingHintDetection:
    @pytest.mark.asyncio
    async def test_ranking_target_and_direction_flow_through(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={
                "intent": "flat_ranking",
                "scopeHints": {
                    "towerName": None, "floorName": "Floor 2", "flatName": None, "roomName": None,
                    "commonAreaName": None, "activityName": None,
                    "rankingTarget": "flat", "rankingDirection": "least_progressed",
                },
                "needsForecast": False, "needsQualityNotes": False,
            }),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="which flat is furthest behind on floor 2",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.ranking_target == "flat"
        assert plan.ranking_direction == "least_progressed"


class TestResolvedScopePersistence:
    def test_includes_common_area_and_activity_keys(self):
        plan = QueryPlan(intent="common_area_status", floor_id="f2", common_area_name="corridor")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert "commonAreaName" in resolved.resolved_scope_for_persistence
        assert "activityName" in resolved.resolved_scope_for_persistence
        assert resolved.resolved_scope_for_persistence["commonAreaName"] == "Corridor"
