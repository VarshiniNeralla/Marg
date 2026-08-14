"""Unit tests for DrishtiService.ask()'s validation guardrail — the single
most important behavior in the whole feature: an LLM response must never
reach the caller unless it validates against DrishtiAnswer, and a
malformed/failing LLM call must degrade to a safe fallback rather than ever
raising or leaking raw/invalid data."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import drishti_service as service_module
from app.services.drishti_llm_client import DrishtiLLMError
from app.services.drishti_query_planner import QueryPlan
from app.services.drishti_service import DrishtiService, _FALLBACK_ANSWER_TEXT


class _FakeConversationCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}
        self._next_id = 1
        self.last_update = None

    async def find_one(self, query):
        oid = query.get("_id")
        return self.docs.get(str(oid))

    async def insert_one(self, doc):
        new_id = f"conv{self._next_id}"
        self._next_id += 1
        doc["_id"] = new_id
        self.docs[new_id] = doc
        return SimpleNamespace(inserted_id=new_id)

    async def update_one(self, query, update):
        self.last_update = update
        oid = str(query.get("_id"))
        doc = self.docs.get(oid)
        if not doc:
            return
        if "$push" in update:
            for key, val in update["$push"].items():
                doc.setdefault(key, [])
                doc[key].extend(val.get("$each", [val]))
        if "$set" in update:
            doc.update(update["$set"])


class _FakeProjectsCollection:
    async def find_one(self, query):
        return {"name": "Test Project"}


def _make_db(conversations: _FakeConversationCollection):
    db = MagicMock()
    collections = {
        "drishti_conversations": conversations,
        "projects": _FakeProjectsCollection(),
    }
    db.__getitem__.side_effect = lambda name: collections[name]
    return db


_PROJECT_CONTEXT = {
    "projectId": "p1", "overallProgressPct": 50.0,
    "floorsAnalyzed": 1, "floorsNotYetAnalyzed": 0,
    "summaryCards": {}, "towers": [],
}
_PLAN = QueryPlan(intent="general", resolved_scope_for_persistence={})


def _wire_common_mocks(monkeypatch):
    monkeypatch.setattr(
        service_module.DrishtiContextService,
        "get_project_context",
        AsyncMock(return_value=_PROJECT_CONTEXT),
    )
    monkeypatch.setattr(
        service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=_PLAN)
    )


class TestAskValidationGuardrail:
    @pytest.mark.asyncio
    async def test_valid_response_persists_correctly(self, monkeypatch):
        _wire_common_mocks(monkeypatch)
        monkeypatch.setattr(
            service_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={"answer": "Progress is on track.", "facts": ["50% complete"]}),
        )
        conversations = _FakeConversationCollection()
        db = _make_db(conversations)
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "how are we doing?")

        assert result["message"]["content"] == "Progress is on track."
        assert result["message"]["structuredPayload"]["facts"] == ["50% complete"]
        stored = conversations.docs[result["conversationId"]]
        assert len(stored["messages"]) == 2
        assert stored["messages"][0]["role"] == "user"
        assert stored["messages"][1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_malformed_then_valid_succeeds_on_retry(self, monkeypatch):
        _wire_common_mocks(monkeypatch)
        call_count = {"n": 0}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return {"not_the_right_shape": True}  # missing required "answer" field
            return {"answer": "Recovered on retry."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "question")

        assert call_count["n"] == 2
        assert result["message"]["content"] == "Recovered on retry."

    @pytest.mark.asyncio
    async def test_malformed_on_both_attempts_falls_back_safely(self, monkeypatch):
        _wire_common_mocks(monkeypatch)
        monkeypatch.setattr(
            service_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(return_value={"totally": "wrong shape"}),
        )
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        # Must not raise.
        result = await service.ask("org1", "user1", "manager", "p1", "question")

        assert result["message"]["content"] == _FALLBACK_ANSWER_TEXT
        assert result["message"]["structuredPayload"]["facts"] == []
        assert result["message"]["structuredPayload"]["recommendations"] == []

    @pytest.mark.asyncio
    async def test_llm_error_on_both_attempts_falls_back_safely(self, monkeypatch):
        _wire_common_mocks(monkeypatch)
        monkeypatch.setattr(
            service_module.drishti_llm_client,
            "chat_completion_json",
            AsyncMock(side_effect=DrishtiLLMError("connection refused")),
        )
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "question")

        assert result["message"]["content"] == _FALLBACK_ANSWER_TEXT


_ROOM_STATUS_FLOOR_SNAPSHOT = {
    "floorId": "f1",
    "overallProgressPct": 55.0,
    "flatProgress": [
        {
            "flatName": "Flat 02", "completionPct": 55.0,
            "rooms": [
                {
                    "roomName": "Bedroom-3", "capturesCount": 2,
                    "activities": [{"activityId": "a1", "activityName": "Wall Punning", "completionPct": 70.0, "status": "in_progress"}],
                },
            ],
        },
    ],
}


def _wire_room_scoped_mocks(monkeypatch, *, plan_overrides=None):
    """Wires a plan that resolves to a specific room, and a floor snapshot
    fetch that returns _ROOM_STATUS_FLOOR_SNAPSHOT — used to exercise the
    resolution-status propagation and targeted-payload assembly paths."""
    plan_kwargs = dict(
        intent="room_status", floor_id="f1", floor_name="Floor 1",
        flat_name="Flat 02", room_name="Bedroom-3",
        resolution_status={"flat": "found", "room": "found"},
        resolved_scope_for_persistence={},
    )
    plan_kwargs.update(plan_overrides or {})
    plan = QueryPlan(**plan_kwargs)

    monkeypatch.setattr(
        service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
    )
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)
    monkeypatch.setattr(
        service_module.DrishtiContextService, "get_floor_context",
        AsyncMock(return_value=_ROOM_STATUS_FLOOR_SNAPSHOT),
    )
    return plan


class TestResolutionStatusPropagation:
    @pytest.mark.asyncio
    async def test_found_room_never_triggers_generic_fallback_text(self, monkeypatch):
        _wire_room_scoped_mocks(monkeypatch)
        monkeypatch.setattr(
            service_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"answer": "Bedroom-3 is 70% complete on Wall Punning."}),
        )
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "how is bedroom-3 doing")

        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT

    @pytest.mark.asyncio
    async def test_not_configured_room_payload_carries_explicit_status_not_generic_fallback(self, monkeypatch):
        """A room that doesn't exist in the roster must surface an explicit
        resolutionStatus in the facts payload the LLM sees — it must NOT
        silently degrade to the generic "couldn't structure a confident
        answer" text, which is reserved for genuine LLM/validation failures."""
        captured_payload = {}

        async def fake_get_room_context(self, org_id, floor_id, flat_name, room_name, snapshot=None):
            captured_payload["called"] = True
            return {"flatName": flat_name, "roomName": room_name, "room": None, "resolutionStatus": "not_configured"}

        _wire_room_scoped_mocks(monkeypatch)
        monkeypatch.setattr(service_module.DrishtiContextService, "get_room_context", fake_get_room_context)
        monkeypatch.setattr(
            service_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"answer": "Master Suite is not configured for Flat 02."}),
        )
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "what about the master suite")

        assert captured_payload["called"] is True
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


class TestJsonDumpsRegression:
    @pytest.mark.asyncio
    async def test_facts_payload_serialized_as_valid_json_not_python_repr(self, monkeypatch):
        """Locks in the json.dumps(..., default=str) fix — a Python dict
        containing None/True renders as invalid-JSON tokens ("None"/"True")
        under str(), which the LLM would then have to guess at."""
        _wire_common_mocks(monkeypatch)
        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "question")

        prompt = captured["user_prompt"]
        # The project facts payload always includes a None (floorsNotYetAnalyzed
        # is an int here, but overallProgressPct/summaryCards can be None/{});
        # assert the JSON-valid tokens appear, not Python-repr tokens.
        assert "None" not in prompt
        assert "True" not in prompt or '"true"' in prompt.lower()


class TestTargetedPayloadAssembly:
    @pytest.mark.asyncio
    async def test_room_status_excludes_whole_floor_snapshot_key(self, monkeypatch):
        """For room/common-area/activity/ranking intents, the coarse
        floor-wide snapshot must be absent — only the targeted sub-object is
        sent, so the LLM never has to search a floor-wide dump itself."""
        _wire_room_scoped_mocks(monkeypatch)
        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "how is bedroom-3 doing")

        prompt = captured["user_prompt"]
        assert '"room"' in prompt
        assert '"executiveSummary"' not in prompt  # only present in the coarse floor-wide payload
