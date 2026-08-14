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
