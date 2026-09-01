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


class _FakeFindCursor:
    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        return self._docs


class _FakeConversationCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}
        self._next_id = 1
        self.last_update = None

    async def find_one(self, query):
        oid = query.get("_id")
        return self.docs.get(str(oid))

    def find(self, query):
        matches = [
            d for d in self.docs.values()
            if d.get("orgId") == query.get("orgId") and d.get("userId") == query.get("userId")
        ]
        return _FakeFindCursor(matches)

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


class TestAnswerCallUsesBoundedMaxTokens:
    """Regression coverage for a real production bug: the answer-generation
    LLM call had no max_tokens override, so it fell back to the shared
    global VLLM_MAX_TOKENS default (20000) — a value sized for the UNRELATED
    vision-analysis provider, not a short JSON answer. Combined with the
    model's 32768-token context window, a moderately large facts payload
    (e.g. a two-floor question, ~12.7K input tokens) pushed input+output
    over the limit, and the vLLM server's 400 response was silently
    swallowed into the exact same generic fallback text used for a genuine
    malformed-JSON failure — confirmed live by replaying the real request
    directly against the vLLM server and capturing its actual error body."""

    @pytest.mark.asyncio
    async def test_answer_call_passes_bounded_max_tokens(self, monkeypatch):
        _wire_common_mocks(monkeypatch)
        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["kwargs"] = kwargs
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "question")

        assert captured["kwargs"].get("max_tokens") == service_module._ANSWER_MAX_TOKENS
        assert service_module._ANSWER_MAX_TOKENS < 20000


class TestCaptureGapAcrossProject:
    """Regression coverage for a real production bug: "How many total rooms
    are captured?" (intent=capture_gap, no floor named) answered "the
    provided data does not specify" even though every activity/capture
    count was sitting right in the underlying snapshots. capture_gap had a
    floor-scoped path only — unlike activity_status/
    common_area_activity_status/activity_list, which already had a
    project-wide counterpart — so a project-wide capture question got
    neither "captureGaps" nor "capturedRooms" in its payload at all."""

    @pytest.mark.asyncio
    async def test_capture_gap_with_no_floor_aggregates_across_project(self, monkeypatch):
        plan = QueryPlan(intent="capture_gap", floor_id=None, resolved_scope_for_persistence={})
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)

        snapshot_f1 = {
            "floorId": "f1",
            "flatProgress": [
                {"flatName": "Flat 01", "rooms": [
                    {"roomName": "Kitchen", "capturesCount": 2, "pinNumbers": [1, 2]},
                    {"roomName": "Bedroom-1", "capturesCount": 0, "pinNumbers": []},
                ]},
            ],
        }
        snapshot_f2 = {
            "floorId": "f2",
            "flatProgress": [
                {"flatName": "Flat 02", "rooms": [
                    {"roomName": "Living Room", "capturesCount": 1, "pinNumbers": [3]},
                ]},
            ],
        }
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_latest_snapshots_for_floors",
            AsyncMock(return_value={"f1": snapshot_f1, "f2": snapshot_f2}),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "2 rooms have been captured across the project so far."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "How many total rooms are captured?")

        prompt = captured["user_prompt"]
        assert '"capturedRooms"' in prompt
        assert '"captureGaps"' in prompt
        assert '"Kitchen"' in prompt
        assert '"Living Room"' in prompt
        assert '"Bedroom-1"' in prompt
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


class TestForecastReachableWithoutFloor:
    """Regression coverage for a real production bug: "When is Project A
    projected to finish?" (intent=project_overview, needs_forecast=True, no
    floor named) never even reached the forecast-assembly block. A blanket
    `if not plan.floor_id: return payload` guard sat BEFORE the forecast
    block, so any project-wide question returned a payload with no
    "forecast" key at all — confirmed by calling _assemble_facts_payload
    directly against live data. The LLM was then truthfully told there was
    no forecast data, and (separately) sometimes hallucinated a fabricated
    date instead of reporting it as missing. Fixed by scoping the early
    return to only the floor-only-dependent blocks."""

    @pytest.mark.asyncio
    async def test_project_wide_forecast_question_reaches_forecast_block(self, monkeypatch):
        plan = QueryPlan(
            intent="project_overview", needs_forecast=True,
            resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: p)
        monkeypatch.setattr(
            service_module.DrishtiForecastService, "forecast_project",
            AsyncMock(return_value={"status": "ok", "meanDaysToComplete": 10.0}),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "When is this project projected to finish?")

        assert '"forecast"' in captured["user_prompt"]
        assert '"meanDaysToComplete": 10.0' in captured["user_prompt"]

    @pytest.mark.asyncio
    async def test_project_wide_quality_query_reaches_quality_notes_block(self, monkeypatch):
        plan = QueryPlan(
            intent="quality_query", needs_quality_notes=True,
            resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: p)
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_quality_notes",
            AsyncMock(return_value=[{"note": "cracked tile in Flat 02"}]),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "Are there any quality issues project-wide?")

        assert '"qualityNotes"' in captured["user_prompt"]
        assert "cracked tile" in captured["user_prompt"]


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


class TestMultiFloorStatusPayload:
    """Regression coverage for a real production bug, in two parts. Part 1:
    "What is the progress percentage for Floor 1 and Floor 2?" resolved to
    at most one floor_id (or none), so the LLM was handed almost no floor
    data and answered "not provided" for floors that had genuinely been
    analyzed. Part 2 (found immediately after fixing part 1): the first fix
    only special-cased "floor_status" — a DIFFERENT multi-floor question
    ("Which rooms have been captured in Floor 1 and Floor 2?", intent
    capture_gap) still fell through to nothing, because every other intent
    never learned about floor_ids at all. The real fix re-runs the SAME
    single-floor assembly once per named floor (via `dataclasses.replace`
    on the plan) so EVERY intent — not just floor_status — automatically
    gets multi-floor support, merged under "byFloor"."""

    def _wire_multi_floor_mocks(self, monkeypatch, plan, snapshots, *, coverage=None):
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        # Real resolve_entities is exercised elsewhere (test_drishti_query_planner.py);
        # here it just needs to be a harmless identity passthrough so the
        # recursive per-floor call in _assemble_facts_payload doesn't need a
        # live snapshot-fuzzy-matching implementation to run.
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: p)

        async def fake_get_floor_context(self, org_id, floor_id):
            return snapshots.get(floor_id)

        monkeypatch.setattr(service_module.DrishtiContextService, "get_floor_context", fake_get_floor_context)
        monkeypatch.setattr(
            service_module.DrishtiContextService, "compute_capture_coverage",
            AsyncMock(return_value=coverage or {"coveragePct": 5.5}),
        )

    @pytest.mark.asyncio
    async def test_floor_status_reports_each_named_floor_individually(self, monkeypatch):
        plan = QueryPlan(
            intent="floor_status",
            floor_ids=["f1", "f2"], floor_names=["Floor 1", "Floor 2"],
            resolved_scope_for_persistence={},
        )
        self._wire_multi_floor_mocks(monkeypatch, plan, {
            "f1": {"overallProgressPct": 5.0, "flatProgress": []},
            "f2": {"overallProgressPct": 2.0, "flatProgress": []},
        })

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Floor 1 is 5% complete; Floor 2 is 2% complete."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask(
            "org1", "user1", "manager", "p1",
            "What is the progress percentage for Floor 1 and Floor 2?",
        )

        prompt = captured["user_prompt"]
        assert '"byFloor"' in prompt
        assert '"Floor 1"' in prompt and '"Floor 2"' in prompt
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT

    @pytest.mark.asyncio
    async def test_unanalyzed_floor_reports_analyzed_false_not_missing(self, monkeypatch):
        """A named floor that was never captured must still appear in
        "byFloor" with its "floor" sub-object showing no snapshot — never
        silently dropped, which would make it indistinguishable from a
        floor the classifier failed to resolve at all."""
        plan = QueryPlan(
            intent="floor_status",
            floor_ids=["f1"], floor_names=["Floor 1"],
            resolved_scope_for_persistence={},
        )
        self._wire_multi_floor_mocks(monkeypatch, plan, {"f1": None}, coverage={"coveragePct": 0.0})

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Floor 1 has not been analyzed yet."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "What about Floor 1?")

        prompt = captured["user_prompt"]
        assert '"byFloor"' in prompt
        assert '"snapshot": null' in prompt

    @pytest.mark.asyncio
    async def test_capture_gap_intent_also_works_across_multiple_floors(self, monkeypatch):
        """The exact second bug from the live report: "Which rooms have been
        captured in Floor 1 and Floor 2?" is intent=capture_gap, not
        floor_status — a hand-written floor_status-only branch would miss
        this entirely. The generic per-floor recursion must cover it too."""
        plan = QueryPlan(
            intent="capture_gap",
            floor_ids=["f1", "f2"], floor_names=["Floor 1", "Floor 2"],
            resolved_scope_for_persistence={},
        )
        flat_progress_f1 = [{
            "flatName": "Flat 01", "rooms": [
                {"roomName": "Bedroom-1", "capturesCount": 1, "pinNumbers": [1], "activities": []},
            ],
        }]
        flat_progress_f2 = [{
            "flatName": "Flat 03", "rooms": [
                {"roomName": "Kitchen", "capturesCount": 0, "pinNumbers": [], "activities": []},
            ],
        }]
        self._wire_multi_floor_mocks(monkeypatch, plan, {
            "f1": {"overallProgressPct": 5.0, "flatProgress": flat_progress_f1},
            "f2": {"overallProgressPct": 2.0, "flatProgress": flat_progress_f2},
        })

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Bedroom-1 has been captured on Floor 1; Kitchen has not been captured on Floor 2."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask(
            "org1", "user1", "manager", "p1",
            "Which rooms have been captured in Floor 1 and Floor 2?",
        )

        prompt = captured["user_prompt"]
        assert '"byFloor"' in prompt
        assert '"capturedRooms"' in prompt
        assert '"captureGaps"' in prompt
        assert '"Bedroom-1"' in prompt
        assert '"Kitchen"' in prompt
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


class TestConversationTimestampsSerializeAsUtc:
    """Locks in the fix for a real bug: Mongo/BSON round-trips a stored
    UTC datetime as naive (tzinfo stripped), and a naive datetime serializes
    without a Z/+00:00 suffix — which the frontend's `new Date(...)` then
    misreads as LOCAL time, showing the wrong clock time in the chat
    sidebar/history. Every timestamp DrishtiService hands back from a
    Mongo-read document must carry explicit UTC tzinfo."""

    @pytest.mark.asyncio
    async def test_list_conversations_reattaches_utc_to_naive_mongo_datetime(self):
        from datetime import datetime

        conversations = _FakeConversationCollection()
        # Simulate exactly what Motor/BSON returns after a round-trip: a
        # naive datetime, even though the value itself is UTC wall-clock.
        naive_updated_at = datetime(2026, 8, 17, 6, 8, 0)
        conversations.docs["conv1"] = {
            "_id": "conv1", "orgId": "org1", "userId": "user1", "projectId": "p1",
            "projectName": "Test Project", "title": "How much time will it take",
            "updatedAt": naive_updated_at,
        }
        db = _make_db(conversations)
        service = DrishtiService(db)

        result = await service.list_conversations("org1", "user1", "p1")

        assert len(result) == 1
        assert result[0]["updatedAt"].tzinfo is not None

    @pytest.mark.asyncio
    async def test_get_conversation_reattaches_utc_to_all_timestamp_fields(self):
        from datetime import datetime

        conversations = _FakeConversationCollection()
        naive = datetime(2026, 8, 17, 6, 8, 0)
        conversations.docs["conv1"] = {
            "_id": "conv1", "orgId": "org1", "userId": "user1", "projectId": "p1",
            "projectName": "Test Project", "title": "Chat",
            "scope": {}, "createdAt": naive, "updatedAt": naive,
            "messages": [
                {"messageId": "m1", "role": "user", "content": "hi", "structuredPayload": None, "createdAt": naive},
            ],
        }
        db = _make_db(conversations)
        service = DrishtiService(db)

        result = await service.get_conversation("org1", "user1", "conv1")

        assert result["createdAt"].tzinfo is not None
        assert result["updatedAt"].tzinfo is not None
        assert result["messages"][0]["createdAt"].tzinfo is not None


class TestProjectWideActivitySearch:
    """Regression coverage for the bug where an activity_status question
    with no floor/flat/room in scope ("what is the current status of
    tiling") short-circuited on the floor-scope guard in
    _assemble_facts_payload before ever calling find_activity_across_project
    — even though the planner had already resolved a real activity_id."""

    @pytest.mark.asyncio
    async def test_activity_status_with_no_floor_searches_whole_project(self, monkeypatch):
        plan = QueryPlan(
            intent="activity_status", floor_id=None, activity_name="tiling",
            activity_id="flat.vitrified_flooring_16",
            activity_ids=["flat.vitrified_flooring_16", "common.corridor_flooring_3"],
            resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)

        called_with = {}

        async def fake_find_activity(self, org_id, project_context, activity_ids):
            called_with["activity_ids"] = activity_ids
            return {"activityIds": activity_ids, "hits": [{"floorName": "Floor 2", "activity": {"completionPct": 42.0}}], "resolutionStatus": "found"}

        monkeypatch.setattr(service_module.DrishtiContextService, "find_activity_across_project", fake_find_activity)

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            return {"answer": "Vitrified Flooring is 42% complete on Floor 2."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "what is the current status of tiling")

        assert called_with["activity_ids"] == ["flat.vitrified_flooring_16", "common.corridor_flooring_3"]
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT
        assert "42" in result["message"]["content"]

    @pytest.mark.asyncio
    async def test_activity_ranking_with_no_floor_ranks_across_project(self, monkeypatch):
        plan = QueryPlan(
            intent="activity_ranking", floor_id=None, ranking_target="activity",
            activity_id="flat.vitrified_flooring_16",
            activity_ids=["flat.vitrified_flooring_16"], resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_latest_snapshots_for_floors",
            AsyncMock(return_value={}),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "ok"}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        # Must not raise even with zero floors/snapshots — an empty ranking,
        # not a short-circuited/absent payload key.
        await service.ask("org1", "user1", "manager", "p1", "which activity is fastest across the project")

        assert '"ranking"' in captured["user_prompt"]


class TestActivityListFollowUp:
    """Regression coverage for the exact reported bug: a follow-up like
    "what are those 27 activities?" after a summary-count answer got "not
    listed in the current payload" — because no intent ever fetched the
    real per-activity list behind an aggregate count. activity_list must
    carry the real names/locations, not just re-explain the same number."""

    @pytest.mark.asyncio
    async def test_activity_list_with_no_floor_lists_across_project(self, monkeypatch):
        plan = QueryPlan(
            intent="activity_list", floor_id=None,
            activity_list_statuses=["in_progress"], resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)

        snapshot = {
            "floorId": "f1",
            "flatProgress": [
                {"flatName": "Flat 01", "rooms": [
                    {"roomName": "Kitchen", "capturesCount": 1, "activities": [
                        {"activityId": "flat.vitrified_flooring_16", "activityName": "Vitrified Flooring", "completionPct": 60.0, "status": "in_progress"},
                    ]},
                ]},
            ],
        }
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_latest_snapshots_for_floors",
            AsyncMock(return_value={"f1": snapshot}),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Vitrified Flooring is in progress at 60% in Flat 01's Kitchen."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "what are those activities in progress?")

        assert '"activityList"' in captured["user_prompt"]
        assert "Vitrified Flooring" in captured["user_prompt"]
        assert "Vitrified Flooring" in result["message"]["content"]

    @pytest.mark.asyncio
    async def test_activity_list_scoped_to_floor_uses_floor_snapshot(self, monkeypatch):
        plan = QueryPlan(
            intent="activity_list", floor_id="f1", floor_name="Floor 1",
            activity_list_statuses=["not_assessed"], resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)
        snapshot = {
            "floorId": "f1",
            "flatProgress": [
                {"flatName": "Flat 02", "rooms": [
                    {"roomName": "Toilet", "capturesCount": 0, "activities": [
                        {"activityId": "flat.toilet_grouting_30", "activityName": "Toilet Grouting", "completionPct": 0.0, "status": "not_assessed"},
                    ]},
                ]},
            ],
        }
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_floor_context", AsyncMock(return_value=snapshot),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Toilet Grouting in Flat 02's Toilet has not been assessed yet."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        await service.ask("org1", "user1", "manager", "p1", "which activities are not assessed on floor 1")

        assert '"activityList"' in captured["user_prompt"]
        assert "Toilet Grouting" in captured["user_prompt"]

    @pytest.mark.asyncio
    async def test_not_started_statuses_pull_from_floor_level_rollup_not_empty_rooms(self, monkeypatch):
        """The exact live bug: "what are those 101 activities that did not
        start" (statuses not_assessed + no_evidence) returned an empty list
        because real uncaptured rooms have activities: [] — the room-level
        source structurally cannot contain a not_assessed entry. Every
        snapshot's separate per-floor "activities" rollup DOES carry these
        statuses (by activity name, no room location) and must be merged in."""
        plan = QueryPlan(
            intent="activity_list", floor_id="f1", floor_name="Floor 1",
            activity_list_statuses=["not_assessed", "no_evidence"], resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)

        # Realistic production shape: rooms have NO activities at all yet
        # (never captured), but the floor-level rollup has real statuses.
        snapshot = {
            "floorId": "f1",
            "flatProgress": [
                {"flatName": "Flat 01", "rooms": [
                    {"roomName": "Bedroom-1", "capturesCount": 0, "activities": []},
                ]},
            ],
            "activities": [
                {"activityId": "flat.main_door_frame_5", "name": "Main Door Frame", "status": "not_assessed"},
                {"activityId": "flat.wall_punning_4", "name": "Wall Punning", "status": "in_progress"},
            ],
        }
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_floor_context", AsyncMock(return_value=snapshot),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Main Door Frame has not been assessed yet on Floor 1."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask(
            "org1", "user1", "manager", "p1", "what are those activities that did not start on floor 1",
        )

        prompt = captured["user_prompt"]
        assert '"Main Door Frame"' in prompt
        assert '"Wall Punning"' not in prompt  # in_progress must not leak into a not-started listing
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


_LIFT_LOBBY_FLOOR_SNAPSHOT = {
    "floorId": "f1",
    "flatProgress": [
        {
            "flatName": "Common Area",
            "rooms": [
                {
                    "roomName": "Lift Lobby", "capturesCount": 4,
                    "activities": [
                        {"activityId": "common.wall_punning_works_1", "activityName": "Wall Punning Works", "completionPct": 85.0, "status": "in_progress"},
                        {"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 0.0, "status": "not_assessed"},
                        {"activityId": "common.false_ceiling_works_2", "activityName": "False Ceiling Works", "completionPct": 15.0, "status": "in_progress"},
                    ],
                },
                {
                    "roomName": "Corridor", "capturesCount": 3,
                    "activities": [
                        {"activityId": "common.primer_1st_coat_paint_6", "activityName": "Primer & 1st Coat Paint", "completionPct": 30.0, "status": "in_progress"},
                    ],
                },
            ],
        },
    ],
}


class TestLocationActivitiesEndToEnd:
    """Reproduces the exact reported bug: "What other activities are
    pending in the Lift Lobby?" previously answered "the provided data does
    not list any other activities" even though Wall Punning Works, Primer &
    1st Coat Paint, and False Ceiling Works were all present in the
    snapshot for that exact location."""

    @pytest.mark.asyncio
    async def test_lift_lobby_follow_up_returns_every_activity_not_just_previous_one(self, monkeypatch):
        plan = QueryPlan(
            intent="location_activities", floor_id="f1", floor_name="Floor 1",
            common_area_name="Lift Lobby", resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_floor_context",
            AsyncMock(return_value=_LIFT_LOBBY_FLOOR_SNAPSHOT),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Besides Wall Punning Works, the Lift Lobby also has Primer & 1st Coat Paint (not yet assessed) and False Ceiling Works (15% in progress)."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "what other activities are pending in the lift lobby?")

        assert '"locationActivities"' in captured["user_prompt"]
        assert "Wall Punning Works" in captured["user_prompt"]
        assert "False Ceiling Works" in captured["user_prompt"]
        assert "Primer & 1st Coat Paint" in captured["user_prompt"]
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


class TestCommonAreaActivityStatusEndToEnd:
    """Reproduces the exact reported bug: "What is the status of the
    painting works in the Common Areas?" previously answered "the provided
    data does not contain specific activity hits" even though Primer & 1st
    Coat Paint was scored 30% in progress on the Corridor."""

    @pytest.mark.asyncio
    async def test_painting_across_common_areas_aggregates_all_units(self, monkeypatch):
        plan = QueryPlan(
            intent="common_area_activity_status", floor_id="f1", floor_name="Floor 1",
            activity_name="painting",
            activity_ids=[
                "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26", "flat.primer_1st_coat_paint_27", "flat.final_coat_paint_37",
                "common.putty_1st_coat_4", "common.putty_2nd_coat_5", "common.primer_1st_coat_paint_6", "common.painting_2nd_coat_9",
            ],
            resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_floor_context",
            AsyncMock(return_value=_LIFT_LOBBY_FLOOR_SNAPSHOT),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "Corridor's Primer & 1st Coat Paint is 30% in progress; Lift Lobby's painting has not been assessed yet."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "what is the status of the painting works in the common areas?")

        assert '"commonAreaActivity"' in captured["user_prompt"]
        assert "Corridor" in captured["user_prompt"]
        assert "Lift Lobby" in captured["user_prompt"]
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT


class TestActivityListFlatsFollowUpEndToEnd:
    """Reproduces the exact reported bug: after "which activities are
    currently configured and being tracked" (answered from Common Area
    data), the bare follow-up "in the flats?" answered "there is no data
    provided for activities within the flats" — because a stale
    commonAreaName scope leaked across turns and silently kept narrowing
    the listing to common areas only."""

    @pytest.mark.asyncio
    async def test_flats_followup_returns_real_flat_activity_data_project_wide(self, monkeypatch):
        plan = QueryPlan(
            intent="activity_list", floor_id=None,
            activity_list_statuses=["in_progress"], activity_list_scope="flats",
            resolved_scope_for_persistence={},
        )
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=_PROJECT_CONTEXT),
        )
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
        monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, snap, prev: plan)

        snapshot = {
            "floorId": "f1",
            "flatProgress": [
                {"flatName": "Flat 02", "rooms": [
                    {"roomName": "Bedroom-4", "capturesCount": 2, "activities": [
                        {"activityId": "flat.wall_punning_4", "activityName": "Wall Punning", "completionPct": 90.0, "status": "in_progress"},
                    ]},
                ]},
                {"flatName": "Common Area", "rooms": [
                    {"roomName": "Corridor", "capturesCount": 3, "activities": [
                        {"activityId": "common.wall_punning_works_1", "activityName": "Wall Punning Works", "completionPct": 85.0, "status": "in_progress"},
                    ]},
                ]},
            ],
        }
        monkeypatch.setattr(
            service_module.DrishtiContextService, "get_latest_snapshots_for_floors",
            AsyncMock(return_value={"f1": snapshot}),
        )

        captured = {}

        async def fake_chat(system_prompt, user_prompt, **kwargs):
            captured["user_prompt"] = user_prompt
            return {"answer": "In the flats, Wall Punning is 90% in progress in Flat 02's Bedroom-4."}

        monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
        db = _make_db(_FakeConversationCollection())
        service = DrishtiService(db)

        result = await service.ask("org1", "user1", "manager", "p1", "in the flats ?")

        prompt = captured["user_prompt"]
        assert '"activityList"' in prompt
        # The flat's activity must be present...
        assert "Flat 02" in prompt
        assert "Wall Punning\"" in prompt or "\"Wall Punning\"" in prompt
        # ...and the common-area room must NOT have leaked into a flats-only listing.
        assert "Corridor" not in prompt
        assert result["message"]["content"] != _FALLBACK_ANSWER_TEXT
