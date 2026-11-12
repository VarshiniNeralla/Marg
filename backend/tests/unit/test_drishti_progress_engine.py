"""Drishti understands the v4.6 construction-progress results.

Covers: what the model is shown (`drishti_view`), the deterministic analytics (unknown is never 0%),
batched snapshot reads agreeing with the dashboard, and the answer prompt explaining the new concepts.
"""
from __future__ import annotations

import copy
import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import drishti_analytics
from app.services import drishti_service as service_module
from app.services.construction_progress_providers.activities import CORE_IDS
from app.services.construction_progress_service import present_snapshot_doc
from app.services.drishti_context_service import DrishtiContextService
from app.services.drishti_prompts import DRISHTI_ANSWER_PROMPT, DRISHTI_CLASSIFIER_PROMPT
from app.services.drishti_query_planner import QueryPlan
from app.services.drishti_service import DrishtiService
from app.services.drishti_view import activity_basis, compact_activity, prepare_payload_for_llm
from tests.unit.test_drishti_service import _FakeConversationCollection, _make_db

PUTTY, PAINT, FLOOR = "flat.putty_1st_coat_25", "flat.primer_1st_coat_paint_27", "flat.vitrified_flooring_16"
PUTTY2 = "flat.putty_2nd_coat_26"


def _activity(aid, name, pct, assessment, status, **extra):
    base = {
        "activityId": aid, "activityName": name, "completionPct": pct, "status": status,
        "assessmentStatus": assessment, "detectionType": "direct", "confidencePct": 91.0,
        "evidenceCaptureIds": ["c1", "c2"], "evidence": "", "reviewRequired": False,
        "evidenceDetails": [{"captureId": "c1", "views": ["north"], "capturedAt": "2026-11-10T10:12:25Z"}],
    }
    base.update(extra)
    return base


def stored_snapshot():
    """A snapshot as the engine stores it (naive datetimes, stale numbers on purpose)."""
    assert {PUTTY, PAINT, FLOOR} <= set(CORE_IDS)
    return {
        "_id": "s1", "orgId": "org1", "floorId": "f6", "snapshotDate": datetime(2026, 11, 12, 9, 34),
        "overallProgressPct": 99.0, "overallStatus": "completed",     # stale - must be recalculated
        "summaryCards": {
            "lastInspection": datetime(2026, 11, 10, 10, 12, 25), "analysedAt": datetime(2026, 11, 12, 9, 41),
            "avgConfidencePct": 80.0, "imagesAnalyzed": 2,
        },
        "heatmapPins": [{"flatName": "Flat 01", "roomName": "Living", "x": 10, "y": 10,
                         "sequenceNumber": 1, "capturesCount": 2}],
        "flatProgress": [{
            "flatName": "Flat 01", "roomsRequired": 1, "completionPct": 99.0,
            "rooms": [{
                "roomName": "Living", "capturesCount": 2, "pinNumbers": [1],
                "activities": [
                    _activity(PUTTY, "1st Coat Putty", 100.0, "completed", "completed",
                              detectionType="inferred", inferredFrom=[PUTTY2]),
                    _activity(PUTTY2, "2nd Coat Putty", 100.0, "completed", "completed"),
                    _activity(PAINT, "Final Coat Paint", 0.0, "unable_to_determine", "not_assessed",
                              reviewRequired=True, reviewReason="photos too dark"),
                    _activity(FLOOR, "Vitrified Flooring", 100.0, "completed", "completed",
                              detectionType="manual", aiCompletionPct=20.0,
                              override={"pct": 100.0, "verdict": "wrong", "reason": "walked the flat",
                                        "by": "Asha", "at": datetime(2026, 11, 12, 7, 0), "aiPct": 20.0}),
                ],
            }],
        }],
    }


def _by_id(activity_id):
    return {a["activityId"]: a for a in stored_snapshot()["flatProgress"][0]["rooms"][0]["activities"]}[activity_id]


# --- what the model is shown ---------------------------------------------------------------------

def test_unknown_activity_is_null_not_zero_and_says_so():
    act = compact_activity(_activity(PAINT, "Final Coat Paint", 0.0, "unable_to_determine", "not_assessed"))
    assert act["completionPct"] is None
    assert "not the same as 0%" in act["note"]
    assert act["assessmentStatus"] == "unable_to_determine"


def test_a_real_zero_stays_zero():
    act = compact_activity(_activity(PAINT, "Final Coat Paint", 0.0, "not_started", "no_evidence"))
    assert act["completionPct"] == 0.0 and "note" not in act


def test_basis_distinguishes_seen_inferred_and_manager_verified():
    assert activity_basis({"detectionType": "direct"}) == "seen_in_photos"
    assert activity_basis({"detectionType": "inferred"}) == "inferred_from_later_work"
    assert activity_basis({"detectionType": "mixed"}) == "partly_inferred"
    assert activity_basis({"detectionType": "manual"}) == "manager_verified"
    assert activity_basis({"detectionType": "direct", "override": {"pct": 100}}) == "manager_verified"


def test_override_keeps_ai_value_next_to_manager_value():
    act = compact_activity(_by_id(FLOOR))
    ov = act["managerOverride"]
    assert ov["pct"] == 100.0 and ov["aiPct"] == 20.0 and ov["by"] == "Asha" and ov["reason"] == "walked the flat"
    assert ov["at"] == "2026-11-12T07:00:00Z"


def test_heavy_and_misleading_fields_are_removed_but_evidence_count_is_kept():
    out = prepare_payload_for_llm(stored_snapshot())
    text = json.dumps(out)
    for banned in ("confidencePct", "evidenceCaptureIds", "heatmapPins", "avgConfidence"):
        assert banned not in text
    act = out["flatProgress"][0]["rooms"][0]["activities"][0]
    assert act["evidenceCount"] == 1 and "evidenceDetails" not in act
    assert act["inferredFrom"] == [PUTTY2] and act["basis"] == "inferred_from_later_work"


def test_review_flag_and_reason_are_visible():
    act = {a["activityId"]: a for a in prepare_payload_for_llm(stored_snapshot())["flatProgress"][0]["rooms"][0]["activities"]}[PAINT]
    assert act["needsReview"] is True and act["reviewReason"] == "photos too dark"


def test_dates_become_utc_strings_and_input_is_not_mutated():
    snap = stored_snapshot()
    before = copy.deepcopy(snap)
    out = prepare_payload_for_llm(snap)
    assert out["summaryCards"]["lastInspection"] == "2026-11-10T10:12:25Z"
    assert out["snapshotDate"] == "2026-11-12T09:34:00Z"
    assert snap == before


def test_wrapper_dicts_keep_their_context_keys():
    hit = {"flatName": "Flat 01", "roomName": "Living",
           "activity": _activity(PAINT, "Final Coat Paint", 0.0, "unable_to_determine", "not_assessed")}
    out = prepare_payload_for_llm({"hits": [hit]})["hits"][0]
    assert out["flatName"] == "Flat 01" and out["activity"]["completionPct"] is None


def test_floor_rollup_items_keep_their_extra_keys():
    item = {"activityName": "Putty", "activityId": PUTTY, "floorName": "Floor 6", "status": "in_progress",
            "completionPct": 35.0, "section": "flat", "grain": "floor_rollup"}
    out = prepare_payload_for_llm(item)
    assert out["floorName"] == "Floor 6" and out["grain"] == "floor_rollup" and out["completionPct"] == 35.0
    assert "basis" not in out          # no detection info on a rollup row, so no claim about how it was seen


# --- deterministic analytics ----------------------------------------------------------------------

def test_floor_rollup_listing_keeps_unknown_as_none():
    rollup = {"f1": [
        {"activityId": PAINT, "name": "Final Coat Paint", "status": "not_assessed", "completionPct": 0.0,
         "assessmentStatus": "unable_to_determine"},
        {"activityId": PUTTY, "name": "Putty", "status": "in_progress", "completionPct": 35.0},
    ]}
    items = drishti_analytics.list_floor_level_activities_by_status(
        rollup, ["not_assessed", "in_progress"], {"f1": "Floor 6"})
    by_name = {i["activityName"]: i for i in items}
    assert by_name["Final Coat Paint"]["completionPct"] is None
    assert by_name["Putty"]["completionPct"] == 35.0


def test_ranking_and_unfinished_work_ignore_unknown_activities():
    rooms = [{"roomName": "Living", "flatName": "Flat 01", "activities": [
        _activity(PUTTY, "Putty", 40.0, "in_progress", "in_progress"),
        _activity(PAINT, "Paint", 0.0, "unable_to_determine", "not_assessed"),
    ]}]
    assert [i["activityName"] for i in drishti_analytics.rank_activities(rooms)] == ["Putty"]
    unfinished = drishti_analytics.rank_unfinished_work(rooms)
    assert [i["activityName"] for i in unfinished] == ["Putty"] and unfinished[0]["gapPct"] == 60.0


def test_common_area_ranking_uses_the_engine_room_number():
    flats = [{"flatName": "Common Area", "rooms": [
        {"roomName": "Lobby", "capturesCount": 2, "progressPct": 12.0, "estimatePct": 60.0, "coveragePct": 20.0,
         "status": "awaiting_evidence", "activities": [_activity(PUTTY, "Putty", 60.0, "in_progress", "in_progress")]},
        {"roomName": "Corridor", "capturesCount": 0, "progressPct": 0.0, "activities": []},
    ]}]
    ranked = drishti_analytics.rank_common_areas(flats)
    assert len(ranked) == 1                       # never-photographed corridor is not ranked
    assert ranked[0]["completionPct"] == 12.0     # verified number, not the 60% observed-only mean
    assert ranked[0]["coveragePct"] == 20.0


def test_flat_ranking_carries_coverage_and_scope_status():
    flats = [
        {"flatName": "Flat 01", "completionPct": 18.0, "estimatePct": 60.0, "coveragePct": 30.0,
         "scopeStatus": "awaiting_evidence"},
        {"flatName": "Common Area", "completionPct": 90.0},
    ]
    ranked = drishti_analytics.rank_flats(flats)
    assert [r["flatName"] for r in ranked] == ["Flat 01"]
    assert ranked[0]["coveragePct"] == 30.0 and ranked[0]["scopeStatus"] == "awaiting_evidence"


# --- context service ------------------------------------------------------------------------------

class _Cursor:
    def __init__(self, docs): self._docs = docs
    def __aiter__(self):
        self._it = iter(self._docs)
        return self
    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def _db_with_snapshots(docs):
    coll = MagicMock()
    coll.aggregate = lambda pipeline: _Cursor([{"_id": d["floorId"], "doc": d} for d in docs])
    db = MagicMock()
    db.__getitem__.side_effect = lambda name: coll
    return db


@pytest.mark.asyncio
async def test_batched_snapshot_read_recalculates_like_the_dashboard():
    service = DrishtiContextService(_db_with_snapshots([stored_snapshot()]))
    latest = (await service.get_latest_snapshots_for_floors("org1", ["f6"]))["f6"]
    assert latest["overallProgressPct"] != 99.0                      # stale stored number replaced
    assert latest["flatFinishing"]["total"] == 1
    flat = latest["flatProgress"][0]
    assert flat["completionPct"] < 99.0 and flat["coveragePct"] is not None
    assert latest["summaryCards"]["lastInspection"] == "2026-11-10T10:12:25Z"
    assert latest["snapshotDate"].endswith("Z")


@pytest.mark.asyncio
async def test_batched_read_leaves_stored_document_untouched():
    snap = stored_snapshot()
    before = copy.deepcopy(snap)
    await DrishtiContextService(_db_with_snapshots([snap])).get_latest_snapshots_for_floors("org1", ["f6"])
    assert snap == before


@pytest.mark.asyncio
async def test_common_area_category_mean_skips_unknown_and_says_what_it_means(monkeypatch):
    snapshot = {"flatProgress": [{"flatName": "Common Area", "rooms": [{
        "roomName": "Lobby", "capturesCount": 2, "activities": [
            _activity("common.putty_1st_coat_4", "Putty 1", 40.0, "in_progress", "in_progress"),
            _activity("common.putty_2nd_coat_5", "Putty 2", 0.0, "unable_to_determine", "not_assessed"),
        ]}]}]}
    service = DrishtiContextService(MagicMock())
    monkeypatch.setattr(service, "get_floor_context", AsyncMock(return_value=snapshot))
    result = await service.get_common_area_category_status(
        "org1", "f1", ["common.putty_1st_coat_4", "common.putty_2nd_coat_5"])
    assert result["overallCompletionPct"] == 40.0          # unknown is not averaged in as 0
    assert result["observedActivities"] == 1 and result["unknownActivities"] == 1
    assert "not counted as 0" in result["overallMeaning"].lower()
    assert [u["completionPct"] for u in result["units"]] == [40.0, None]


@pytest.mark.asyncio
async def test_coverage_counts_unable_to_determine_separately(monkeypatch):
    service = DrishtiContextService(MagicMock())
    monkeypatch.setattr(service, "get_floor_context",
                        AsyncMock(return_value=present_snapshot_doc(stored_snapshot())))
    cov = await service.compute_capture_coverage("org1", "f6")
    assert cov["activitiesUnableToDetermine"] == 1


# --- end to end: what the language model actually receives ----------------------------------------

@pytest.mark.asyncio
async def test_floor_question_payload_has_finishing_split_dates_and_no_confidence(monkeypatch):
    plan = QueryPlan(intent="floor_status", floor_id="f6", floor_name="Floor 6", resolved_scope_for_persistence={})
    snap = present_snapshot_doc(stored_snapshot())
    monkeypatch.setattr(service_module.DrishtiContextService, "get_project_context", AsyncMock(
        return_value={"projectId": "p1", "overallProgressPct": 1.0, "floorsAnalyzed": 1,
                      "floorsNotYetAnalyzed": 0, "summaryCards": {}, "towers": []}))
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, s, prev: plan)
    monkeypatch.setattr(service_module.DrishtiContextService, "get_floor_context", AsyncMock(return_value=snap))
    captured = {}

    async def fake_chat(system_prompt, user_prompt, **kwargs):
        captured["system"], captured["user"] = system_prompt, user_prompt
        return {"answer": "ok"}

    monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
    await DrishtiService(_make_db(_FakeConversationCollection())).ask(
        "org1", "u1", "manager", "p1", "How far along is Floor 6?")

    facts = json.loads(captured["user"].split("Facts payload (JSON):\n", 1)[1].split("\n\nRecent conversation:", 1)[0])
    floor = facts["floor"]
    snapshot = floor["snapshot"]
    assert snapshot["flatFinishing"]["total"] == 1 and "commonFinishing" in snapshot
    assert floor["summaryCards"]["lastInspection"] == "2026-11-10T10:12:25Z"
    assert floor["summaryCards"]["analysedAt"] == "2026-11-12T09:41:00Z"
    acts = {a["activityId"]: a for a in snapshot["flatProgress"][0]["rooms"][0]["activities"]}
    assert acts[PAINT]["completionPct"] is None and acts[PAINT]["needsReview"] is True
    assert acts[PUTTY]["basis"] == "inferred_from_later_work"
    assert acts[FLOOR]["managerOverride"]["by"] == "Asha"
    assert "evidenceCaptureIds" not in captured["user"] and "\"confidencePct\"" not in captured["user"]
    assert "None" not in captured["user"]


# --- the instructions ------------------------------------------------------------------------------

@pytest.mark.parametrize("phrase", [
    "UNKNOWN, which is NOT 0%", "unable_to_determine", "VERIFIED progress", "estimatePct", "coveragePct",
    "awaiting_evidence", "flatFinishing", "commonFinishing", "inferred_from_later_work", "manager_verified",
    "managerOverride", "needsReview", "evidenceCount", "lastInspection", "analysedAt", "AI confidence",
])
def test_answer_prompt_explains_the_new_engine(phrase):
    assert phrase in DRISHTI_ANSWER_PROMPT


def test_prompt_no_longer_calls_unclear_photos_missing_coverage():
    assert "photos were not clear enough to tell" in DRISHTI_ANSWER_PROMPT


def test_classifier_maps_new_wordings_to_existing_statuses():
    assert "unable to determine" in DRISHTI_CLASSIFIER_PROMPT and "mostly complete" in DRISHTI_CLASSIFIER_PROMPT


# --- "which activity is progressing faster" (no activity named, no floor named) -----------------------

def _rooms_for_ranking():
    return [
        {"roomName": "Living", "flatName": "Flat 01", "activities": [
            _activity(PUTTY, "1st Coat Putty", 80.0, "in_progress", "in_progress"),
            _activity(FLOOR, "Vitrified Flooring", 20.0, "in_progress", "in_progress"),
            _activity(PAINT, "Primer", 0.0, "unable_to_determine", "not_assessed"),
        ]},
        {"roomName": "Bedroom", "flatName": "Flat 01", "activities": [
            _activity(PUTTY, "1st Coat Putty", 100.0, "completed", "completed"),
            _activity(FLOOR, "Vitrified Flooring", 40.0, "in_progress", "in_progress"),
        ]},
    ]


def test_activity_types_are_ranked_by_average_over_observed_rooms():
    ranked = drishti_analytics.rank_activity_types(_rooms_for_ranking(), "fastest")
    assert [r["activityId"] for r in ranked] == [PUTTY, FLOOR]
    assert ranked[0]["averageCompletionPct"] == 90.0 and ranked[0]["roomsObserved"] == 2
    assert ranked[0]["roomsCompleted"] == 1 and ranked[0]["roomsInProgress"] == 1
    assert ranked[1]["averageCompletionPct"] == 30.0


def test_unknown_only_activity_is_not_ranked_and_never_counts_as_zero():
    ids = [r["activityId"] for r in drishti_analytics.rank_activity_types(_rooms_for_ranking())]
    assert PAINT not in ids


def test_slowest_direction_and_activity_filter():
    slow = drishti_analytics.rank_activity_types(_rooms_for_ranking(), "slowest")
    assert slow[0]["activityId"] == FLOOR
    only = drishti_analytics.rank_activity_types(_rooms_for_ranking(), activity_ids=[FLOOR])
    assert [r["activityId"] for r in only] == [FLOOR]


@pytest.mark.parametrize("question,direction", [
    ("Which activity is progressinf faster", "fastest"),      # the exact typo from the tablet
    ("Which activity is progressing faster?", "fastest"),
    ("which activities are slowest", "slowest"),
    ("what are the activities behind schedule", "slowest"),
])
def test_ranking_questions_are_recognised_even_when_classified_general(question, direction):
    from app.services.drishti_query_planner import _correct_intent_from_question, _scan_question_for_ranking_direction
    assert _correct_intent_from_question("general", question) == "activity_ranking"
    assert _scan_question_for_ranking_direction(question) == direction


@pytest.mark.parametrize("question", [
    "which activities are in progress", "what is the status of painting across the common areas",
    "how is MEP progressing across the project",
])
def test_other_activity_questions_are_not_hijacked(question):
    from app.services.drishti_query_planner import _correct_intent_from_question
    assert _correct_intent_from_question("general", question) != "activity_ranking"


@pytest.mark.asyncio
async def test_project_wide_ranking_without_a_named_activity_returns_the_ranking(monkeypatch):
    plan = QueryPlan(intent="activity_ranking", floor_id=None, ranking_target="activity",
                     ranking_direction="fastest", resolved_scope_for_persistence={})
    ctx = {"projectId": "p1", "overallProgressPct": 15.9, "floorsAnalyzed": 1, "floorsNotYetAnalyzed": 0,
           "summaryCards": {}, "towers": [{"towerId": "t1", "towerName": "T1",
                                           "floors": [{"floorId": "f6", "floorName": "Floor 6"}]}]}
    monkeypatch.setattr(service_module.DrishtiContextService, "get_project_context", AsyncMock(return_value=ctx))
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "plan", AsyncMock(return_value=plan))
    monkeypatch.setattr(service_module.DrishtiQueryPlanner, "resolve_entities", lambda self, p, s, prev: plan)
    monkeypatch.setattr(service_module.DrishtiContextService, "get_latest_snapshots_for_floors",
                        AsyncMock(return_value={"f6": present_snapshot_doc(stored_snapshot())}))
    captured = {}

    async def fake_chat(system_prompt, user_prompt, **kwargs):
        captured["user"] = user_prompt
        return {"answer": "ok"}

    monkeypatch.setattr(service_module.drishti_llm_client, "chat_completion_json", fake_chat)
    await DrishtiService(_make_db(_FakeConversationCollection())).ask(
        "org1", "u1", "manager", "p1", "Which activity is progressing faster")
    facts = json.loads(captured["user"].split("Facts payload (JSON):\n", 1)[1].split("\n\nRecent conversation:", 1)[0])
    ranking = facts["activityRanking"]
    assert ranking and ranking[0]["averageCompletionPct"] >= ranking[-1]["averageCompletionPct"]
    assert {r["activityId"] for r in ranking} <= {PUTTY, PUTTY2, FLOOR}      # the unknown paint is not ranked


def test_prompt_tells_the_model_how_to_answer_ranking_questions():
    assert "activityRanking" in DRISHTI_ANSWER_PROMPT and "NOT a speed over time" in DRISHTI_ANSWER_PROMPT
