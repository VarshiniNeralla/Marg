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


class TestActivityCategoryKeywordResolution:
    """Regression coverage for the exact reported bug: "tiling"/"tiles" share
    no substring and no useful difflib similarity with any real activity name
    (e.g. "Vitrified Flooring"), so plain fuzzy matching alone always failed
    for these everyday category keywords, silently leaving activity_id/
    activity_ids empty and the whole activity-search path dead."""

    def test_tiling_keyword_resolves_to_multiple_real_activity_ids(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="tiling")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_ids
        assert "flat.vitrified_flooring_16" in resolved.activity_ids
        assert len(resolved.activity_ids) > 1
        assert resolved.activity_id == resolved.activity_ids[0]

    def test_tiles_keyword_also_resolves(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="tiles")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_ids

    def test_mep_keyword_resolves_to_multiple_real_activity_ids(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="MEP")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert "common.mep_works_fire_fighting_electrical_0" in resolved.activity_ids
        assert "flat.electrical_wiring_23" in resolved.activity_ids

    def test_keyword_matching_is_case_insensitive(self):
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="Painting")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_ids

    def test_single_specific_activity_name_still_collapses_to_one_canonical_name(self):
        # "wall punning works" names one specific real activity — unlike a
        # category keyword, this should still resolve to a single canonical
        # activity_name (not just a raw hint carried through).
        plan = QueryPlan(intent="activity_status", floor_id="f2", activity_name="wall punning works")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert len(resolved.activity_ids) == 1
        assert resolved.activity_name != "wall punning works"  # collapsed to the canonical name


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


class TestCommonAreaActivityStatusNeverInheritsOneUnit:
    """"What is the status of painting in the Common Areas" must aggregate
    ALL units — a previously-discussed single unit (e.g. "Corridor" from an
    earlier turn) must never leak into this intent and narrow it back down
    to one location, defeating the whole point of the question."""

    def test_does_not_carry_over_previous_common_area_name(self):
        plan = QueryPlan(intent="common_area_activity_status", floor_id="f2", activity_name="painting")
        previous_scope = {"commonAreaName": "Corridor"}
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, previous_scope)
        assert resolved.common_area_name is None

    def test_still_resolves_the_activity_category(self):
        plan = QueryPlan(intent="common_area_activity_status", floor_id="f2", activity_name="painting")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_ids
        assert "common.primer_1st_coat_paint_6" in resolved.activity_ids


class TestLocationActivitiesResolution:
    """"What OTHER activities are pending in the Lift Lobby" — the location
    must resolve like common_area_status does, independent of any
    previously-discussed activity name."""

    def test_resolves_common_area_location(self):
        plan = QueryPlan(intent="location_activities", floor_id="f2", common_area_name="lift lobby")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.common_area_name == "Lift Lobby"
        assert resolved.resolution_status["commonArea"] == "found"

    def test_resolves_flat_room_location(self):
        plan = QueryPlan(intent="location_activities", floor_id="f2", flat_name="Flat 02", room_name="bedroom 3")
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.flat_name == "Flat 02"
        assert resolved.room_name == "Bedroom-3"

    def test_ignores_stale_activity_name_from_previous_turn(self):
        # The previous turn discussed "Wall Punning" in the Lift Lobby; this
        # follow-up asks for everything else — activity_name must not force
        # this into a single-activity search.
        plan = QueryPlan(intent="location_activities", floor_id="f2", common_area_name="Lift Lobby", activity_name=None)
        resolved = DrishtiQueryPlanner().resolve_entities(plan, _FLOOR_SNAPSHOT, {})
        assert resolved.activity_ids == []


class TestDeterministicMisclassificationRecovery:
    """Regression coverage for a real production failure: the LLM
    classifier itself does not reliably pick "common_area_activity_status"/
    "location_activities" or populate their required scope hints, even with
    a detailed prose intent guide. These tests simulate the classifier
    getting it WRONG (wrong intent, empty hints) and verify the deterministic
    keyword-scan/intent-correction safety net recovers the right answer
    anyway — the system must not be fully dependent on classifier accuracy
    for these two intents."""

    @pytest.mark.asyncio
    async def test_recovers_common_area_activity_status_when_classifier_says_activity_status(self, monkeypatch):
        # Simulates exactly what was observed: the model chose
        # "activity_status" and left activityName empty for a "painting
        # works in the Common Areas" question.
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "activity_status", "scopeHints": {}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="What is the status of the painting works in the Common Areas?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "common_area_activity_status"
        assert plan.activity_name == "painting"

    @pytest.mark.asyncio
    async def test_recovers_location_activities_when_classifier_says_general(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "general", "scopeHints": {}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="What other activities are pending in the Lift Lobby?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "location_activities"
        assert plan.common_area_name == "Lift Lobby"

    @pytest.mark.asyncio
    async def test_recovers_location_activities_when_classifier_says_activity_status(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "activity_status", "scopeHints": {"activityName": "wall punning"}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="What other activities are pending in the Lift Lobby?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "location_activities"
        assert plan.common_area_name == "Lift Lobby"

    @pytest.mark.asyncio
    async def test_does_not_override_a_correct_classifier_hint(self, monkeypatch):
        # The classifier already got it right — the fallback must not
        # second-guess a hint that IS present.
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={
                "intent": "common_area_activity_status",
                "scopeHints": {"activityName": "MEP"},
            }),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="What is the status of the painting works in the Common Areas?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "common_area_activity_status"
        assert plan.activity_name == "MEP"

    @pytest.mark.asyncio
    async def test_unrelated_question_intent_is_not_touched(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "floor_status", "scopeHints": {"floorName": "Floor 2"}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="How is Floor 2 progressing?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.intent == "floor_status"


class TestActivityListScopeDoesNotLeakAcrossTurns:
    """Regression coverage for a real production bug: after a
    common-area-scoped "activity_list" answer, the bare follow-up "in the
    flats?" returned "no data for activities within the flats" because a
    stale commonAreaName from the PRIOR turn silently narrowed the fresh
    question back down to common areas only."""

    @pytest.mark.asyncio
    async def test_bare_flats_followup_clears_stale_common_area_scope(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={
                "intent": "activity_list",
                "scopeHints": {"activityListStatuses": ["in_progress"]},
            }),
        )
        previous_scope = {"commonAreaName": "Corridor"}
        plan = await DrishtiQueryPlanner().plan(
            question="in the flats ?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope=previous_scope,
        )
        assert plan.common_area_name is None
        assert plan.activity_list_scope == "flats"

    @pytest.mark.asyncio
    async def test_bare_common_areas_followup_clears_stale_flat_scope(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={
                "intent": "activity_list",
                "scopeHints": {"activityListStatuses": ["completed"]},
            }),
        )
        previous_scope = {"flatName": "Flat 02"}
        plan = await DrishtiQueryPlanner().plan(
            question="what about common areas?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope=previous_scope,
        )
        assert plan.flat_name is None
        assert plan.activity_list_scope == "common_areas"

    @pytest.mark.asyncio
    async def test_scope_preserving_followup_stays_unscoped(self, monkeypatch):
        # "what are those 27 activities" doesn't name a new location — it
        # must not be forced into flats-only or common-areas-only.
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={
                "intent": "activity_list",
                "scopeHints": {"activityListStatuses": ["in_progress"]},
            }),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="what are those 27 activities?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={"commonAreaName": "Corridor"},
        )
        assert plan.activity_list_scope is None
        assert plan.common_area_name is None


class TestProjectWideIntentsNeverInheritStaleFloor:
    """Regression coverage for a real production bug: after a floor-scoped
    question (e.g. "What is the status of the Lift Lobby?" on Floor 2), a
    genuinely project-wide follow-up like "How is MEP progressing across
    the project?" silently inherited Floor 2's stale floor_id via the
    sticky tower/floor carryover, got routed through the single-floor
    retrieval path instead of the real project-wide search, and reported
    "not_configured" for an activity that plainly existed on other floors."""

    @pytest.mark.asyncio
    async def test_activity_status_across_project_does_not_inherit_previous_floor(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "activity_status", "scopeHints": {"activityName": "MEP"}}),
        )
        previous_scope = {"floorId": "f1", "floorName": "Floor 1", "commonAreaName": "Lift Lobby"}
        plan = await DrishtiQueryPlanner().plan(
            question="How is MEP progressing across the project?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope=previous_scope,
        )
        assert plan.floor_id is None
        assert plan.tower_id is None

    @pytest.mark.asyncio
    async def test_common_area_activity_status_does_not_inherit_previous_floor(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "common_area_activity_status", "scopeHints": {"activityName": "painting"}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="What is the status of the painting works in the Common Areas?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={"floorId": "f2", "floorName": "Floor 2"},
        )
        assert plan.floor_id is None

    @pytest.mark.asyncio
    async def test_activity_list_does_not_inherit_previous_floor(self, monkeypatch):
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "activity_list", "scopeHints": {"activityListStatuses": ["in_progress"]}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="Which activities are in progress?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={"floorId": "f2", "floorName": "Floor 2"},
        )
        assert plan.floor_id is None

    @pytest.mark.asyncio
    async def test_location_anchored_intent_still_inherits_floor_for_followups(self, monkeypatch):
        # Sanity check the fix is scoped correctly: a genuinely
        # location-anchored follow-up (not project-wide by nature) must
        # still inherit the sticky floor — this must NOT regress.
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "common_area_status", "scopeHints": {"commonAreaName": "Corridor"}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="How is the Corridor doing?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={"floorId": "f2", "floorName": "Floor 2"},
        )
        assert plan.floor_id == "f2"

    @pytest.mark.asyncio
    async def test_explicit_floor_name_still_overrides_project_wide_default(self, monkeypatch):
        # If the user DOES name a floor for one of these intents, that
        # explicit floor must still be honored (the exclusion only stops
        # STALE inheritance, never an explicitly-named floor this turn).
        monkeypatch.setattr(
            planner_module.drishti_llm_client, "chat_completion_json",
            AsyncMock(return_value={"intent": "activity_status", "scopeHints": {"activityName": "MEP", "floorName": "Floor 2"}}),
        )
        plan = await DrishtiQueryPlanner().plan(
            question="How is MEP progressing on Floor 2?",
            conversation_history=[], known_entities=_KNOWN_ENTITIES, previous_scope={},
        )
        assert plan.floor_id == "f2"


class TestLocationActivitiesCorrectionRequiresLocationSignal:
    """A second regression, found while fixing the first: the original
    "other activities" correction pattern matched ANY "which/what/other/all
    ... activities" phrasing, including a bare status question with no
    location at all ("which activities are in progress?"), incorrectly
    reclassifying a legitimate project-wide activity_list question into a
    location-anchored one that then wrongly inherited a stale floor."""

    def test_bare_status_question_is_not_corrected(self):
        from app.services.drishti_query_planner import _correct_intent_from_question
        assert _correct_intent_from_question("activity_list", "Which activities are in progress?") == "activity_list"
        assert _correct_intent_from_question("activity_list", "What activities have not started?") == "activity_list"

    def test_other_activities_at_a_location_is_still_corrected(self):
        from app.services.drishti_query_planner import _correct_intent_from_question
        assert _correct_intent_from_question(
            "activity_status", "What other activities are pending in the Lift Lobby?",
        ) == "location_activities"
        assert _correct_intent_from_question(
            "activity_list", "What other activities are pending in the Lift Lobby?",
        ) == "location_activities"
