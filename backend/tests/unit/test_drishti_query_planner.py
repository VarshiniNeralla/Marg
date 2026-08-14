"""Unit tests for DrishtiQueryPlanner's fuzzy-match resolution and fallback
behavior. The LLM classification call is mocked via monkeypatching
`app.services.drishti_llm_client.chat_completion_json` so these tests never
make a network call."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.services import drishti_query_planner as planner_module
from app.services.drishti_query_planner import DrishtiQueryPlanner


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
