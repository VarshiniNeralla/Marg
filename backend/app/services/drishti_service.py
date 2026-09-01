"""
Drishti orchestrator — the single entry point that composes context
retrieval, query planning, the LLM answer call, and conversation persistence.

This module owns the most safety-critical guardrail in the whole feature:
an LLM response is NEVER returned to the caller unless it has passed
`DrishtiAnswer.model_validate`. A malformed or hallucinated shape gets one
corrective retry, then falls back to a safe, honest, empty-arrays answer —
it is never relayed raw, and it never raises 500 to the frontend for this
reason alone.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError
from pymongo import ReturnDocument

from app.core.exceptions import NotFoundException, ValidationException
from app.schemas.drishti import DrishtiAnswer, DrishtiMessage
from app.services import drishti_analytics
from app.services import drishti_llm_client
from app.services.llm_usage_service import LLMUsageService
from app.services.drishti_context_service import DrishtiContextService, _COMMON_AREA_FLAT, _find_flat
from app.services.drishti_forecast_service import DrishtiForecastService
from app.services.drishti_prompts import DRISHTI_ANSWER_PROMPT
from app.services.drishti_query_planner import DrishtiQueryPlanner, QueryPlan

_COLLECTION = "drishti_conversations"

_FALLBACK_ANSWER_TEXT = (
    "I couldn't structure a confident answer from the available data — try rephrasing, "
    "or asking about a specific floor or flat."
)

# A DrishtiAnswer response (a paragraph of prose plus a handful of short
# facts/insights/recommendations/metrics/evidence array entries) never
# remotely needs more than ~2000 tokens. VLLM_MAX_TOKENS (the shared global
# default this would otherwise fall back to) is 20000 — sized for the
# UNRELATED vision-analysis provider (vision_providers/vllm_provider.py),
# which genuinely can produce long per-room descriptions. Reusing that same
# 20000 budget here left almost no room in the model's 32768-token context
# window for input: a real production bug where a two-floor question's
# ~12.7K-token facts payload combined with a 20000-token output request
# exceeded the window by exactly 1 token, and the vLLM server's 400
# response was silently swallowed into the generic "I couldn't structure a
# confident answer" fallback text, indistinguishable from an actual
# malformed-JSON failure. Overriding max_tokens here (the same way the
# classifier call already overrides it to 400) fixes this for every
# question shape, not just multi-floor ones — confirmed live via a direct
# vLLM request replay showing the exact 400 error body.
_ANSWER_MAX_TOKENS = 2000


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> Any:
    """Mongo/BSON always stores datetimes as UTC but strips tzinfo on
    read-back (a naive `datetime`, wall-clock value still correct UTC) — if
    that naive value is serialized as-is, it renders without a `Z`/`+00:00`
    suffix and the frontend's `new Date(...)` then misreads it as LOCAL
    time, showing the wrong clock time to the user. Re-attach UTC tzinfo at
    the read boundary so every timestamp this service returns serializes
    unambiguously."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _oid_or_str(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else value


def _message_with_utc_timestamp(message: dict[str, Any]) -> dict[str, Any]:
    return {**message, "createdAt": _as_utc(message.get("createdAt"))}


class DrishtiService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        self._context_service = DrishtiContextService(db)
        self._forecast_service = DrishtiForecastService(db)
        self._planner = DrishtiQueryPlanner()

    # ── Main chat entry point ─────────────────────────────────────────────

    async def ask(
        self,
        org_id: str,
        user_id: str,
        role: str,
        project_id: str,
        question: str,
        conversation_id: Optional[str] = None,
    ) -> dict[str, Any]:
        conversation = await self._load_or_create_conversation(
            org_id, user_id, project_id, question, conversation_id
        )

        project_context = await self._context_service.get_project_context(org_id, project_id)
        known_entities = project_context
        previous_scope = conversation.get("scope") or {}

        # Phase 1: classify intent, resolve tower/floor (cheap — no snapshot).
        plan = await self._planner.plan(
            question=question,
            conversation_history=[
                {"role": m["role"], "content": m["content"]} for m in conversation["messages"][-6:]
            ],
            known_entities=known_entities,
            previous_scope=previous_scope,
        )

        # Fetch the floor snapshot ONCE — reused for phase-2 entity
        # resolution (flat/room/common-area rosters) AND for retrieval, so
        # a narrowly-scoped question never triggers two separate queries.
        floor_snapshot = None
        if plan.needs_floor_snapshot:
            floor_snapshot = await self._context_service.get_floor_context(org_id, plan.floor_id)

        # Phase 2: resolve flat/room/common-area/activity against the real
        # snapshot roster (or the project-invariant activity list).
        plan = self._planner.resolve_entities(plan, floor_snapshot, previous_scope)

        facts_payload = await self._assemble_facts_payload(
            org_id, user_id, role, project_id, project_context, plan, floor_snapshot,
        )

        usage_out: dict[str, Any] = {}
        answer = await self._generate_answer(
            question, facts_payload, conversation["messages"][-6:], usage_out,
        )
        if usage_out:
            usage = usage_out.get("usage") or {}
            await LLMUsageService(self._db).record_usage(
                org_id=org_id,
                source="drishti_chat",
                model=usage_out.get("model"),
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
                latency_ms=usage_out.get("latency_ms"),
                project_id=project_id,
                project_name=str(conversation.get("projectName") or ""),
                requested_by=user_id or None,
                entity_id=str(conversation["_id"]),
            )

        now = _utcnow()
        user_message: dict[str, Any] = {
            "messageId": str(uuid.uuid4()),
            "role": "user",
            "content": question,
            "structuredPayload": None,
            "createdAt": now,
        }
        assistant_message: dict[str, Any] = {
            "messageId": str(uuid.uuid4()),
            "role": "assistant",
            "content": answer.answer,
            "structuredPayload": answer.model_dump(by_alias=True),
            "createdAt": now,
        }

        await self._db[_COLLECTION].update_one(
            {"_id": conversation["_id"]},
            {
                "$push": {"messages": {"$each": [user_message, assistant_message]}},
                "$set": {
                    "scope": plan.resolved_scope_for_persistence,
                    "updatedAt": now,
                },
            },
        )

        return {
            "conversationId": str(conversation["_id"]),
            "message": DrishtiMessage.model_validate(assistant_message).model_dump(by_alias=True),
        }

    async def _load_or_create_conversation(
        self,
        org_id: str,
        user_id: str,
        project_id: str,
        question: str,
        conversation_id: Optional[str],
    ) -> dict[str, Any]:
        if conversation_id:
            doc = await self._db[_COLLECTION].find_one({"_id": _oid_or_str(conversation_id)})
            if not doc or doc.get("orgId") != org_id or doc.get("userId") != user_id or doc.get("projectId") != project_id:
                raise NotFoundException("conversation", conversation_id)
            return doc

        project = await self._db["projects"].find_one(
            {"orgId": org_id, "$or": [{"_id": _oid_or_str(project_id)}, {"id": project_id}]}
        )
        now = _utcnow()
        doc = {
            "orgId": org_id,
            "userId": user_id,
            "projectId": project_id,
            "projectName": str((project or {}).get("name") or ""),
            "title": question.strip()[:60],
            "scope": {
                "towerId": None, "towerName": None,
                "floorId": None, "floorName": None,
                "flatName": None, "roomName": None,
                "commonAreaName": None, "activityName": None,
            },
            "messages": [],
            "createdAt": now,
            "updatedAt": now,
        }
        result = await self._db[_COLLECTION].insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc

    # ── Context assembly ──────────────────────────────────────────────────

    async def _assemble_facts_payload(
        self,
        org_id: str,
        user_id: str,
        role: str,
        project_id: str,
        project_context: dict[str, Any],
        plan: QueryPlan,
        floor_snapshot: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        """Maps intent -> targeted retrieval. For intents narrower than
        "whole floor" (see `_TARGETED_INTENTS`), the coarse floor snapshot is
        deliberately withheld — only the specific room/common-area/activity/
        ranking sub-object is sent, so the LLM is never handed a floor-wide
        dump to search or calculate over itself.

        A question naming MULTIPLE floors ("rooms captured in Floor 1 and
        Floor 2", "flat status on Floor 1 and Floor 2") resolves to
        `plan.floor_ids` instead of a single `plan.floor_id` (see
        `DrishtiQueryPlanner._resolve_floors`). Rather than re-implementing
        every intent's retrieval a second time for the multi-floor case, this
        re-runs the SAME single-floor assembly once per named floor — every
        intent (flat/room/activity/capture-gap/ranking/...) automatically
        gains multi-floor support with zero per-intent duplication — and
        merges the per-floor payloads under "byFloor". This was a real
        production bug: only "floor_status" originally had a hand-written
        multi-floor branch, so "Which rooms have been captured in Floor 1
        and Floor 2?" (capture_gap) fell through to an empty payload and the
        LLM correctly reported no data, even though both floors were
        genuinely analyzed."""
        if plan.floor_ids and not plan.floor_id:
            per_floor_payloads = []
            for fid, fname in zip(plan.floor_ids, plan.floor_names):
                sub_plan = replace(plan, floor_id=fid, floor_name=fname, floor_ids=[], floor_names=[])
                sub_snapshot = await self._context_service.get_floor_context(org_id, fid)
                sub_plan = self._planner.resolve_entities(sub_plan, sub_snapshot, {})
                sub_payload = await self._assemble_facts_payload(
                    org_id, user_id, role, project_id, project_context, sub_plan, sub_snapshot,
                )
                sub_payload.pop("project", None)
                per_floor_payloads.append({"floorId": fid, "floorName": fname, **sub_payload})
            return {
                "project": {
                    "projectId": project_context["projectId"],
                    "overallProgressPct": project_context["overallProgressPct"],
                    "floorsAnalyzed": project_context["floorsAnalyzed"],
                    "floorsNotYetAnalyzed": project_context["floorsNotYetAnalyzed"],
                    "summaryCards": project_context["summaryCards"],
                },
                "byFloor": per_floor_payloads,
            }

        payload: dict[str, Any] = {
            "project": {
                "projectId": project_context["projectId"],
                "overallProgressPct": project_context["overallProgressPct"],
                "floorsAnalyzed": project_context["floorsAnalyzed"],
                "floorsNotYetAnalyzed": project_context["floorsNotYetAnalyzed"],
                "summaryCards": project_context["summaryCards"],
            },
        }

        if plan.intent in ("project_overview", "general"):
            payload["towers"] = project_context["towers"]

        if plan.tower_id and plan.intent in ("tower_status", "comparison"):
            for tower in project_context["towers"]:
                if tower["towerId"] == plan.tower_id:
                    payload["tower"] = tower
                    break

        # Activity resolution is project-invariant (matched against the
        # static ALL_ACTIVITIES vocabulary, never a floor snapshot — see
        # DrishtiQueryPlanner.resolve_entities) — so an activity question
        # with no floor/flat/room in scope ("what is the current status of
        # tiling") must still search the whole project instead of being cut
        # off by the floor-scope guard below, which would otherwise discard
        # an already-resolved activity_id and answer from project totals
        # alone.
        if not plan.floor_id and plan.activity_ids and plan.intent == "common_area_activity_status":
            payload["commonAreaActivity"] = await self._context_service.get_common_area_category_status_across_project(
                org_id, project_context, plan.activity_ids,
            )

        if not plan.floor_id and plan.activity_ids and plan.intent in ("activity_status", "activity_ranking", "unfinished_work"):
            if plan.intent == "activity_status":
                payload["activity"] = await self._context_service.find_activity_across_project(
                    org_id, project_context, plan.activity_ids,
                )
            else:
                project_rooms = await self._rooms_across_project(org_id, project_context)
                if plan.intent == "activity_ranking":
                    direction = plan.ranking_direction or "fastest"
                    payload["ranking"] = drishti_analytics.rank_activities(project_rooms, direction)
                else:
                    payload["unfinishedWork"] = drishti_analytics.rank_unfinished_work(project_rooms)

        # "Which activities are in progress/not started/..." (and its
        # natural follow-up "what are those N activities?") needs the REAL
        # per-activity list, not just the aggregate counts already in
        # project.summaryCards — those counts alone can't answer "what are
        # they", only "how many". Works with or without a floor named.
        if plan.intent == "activity_list" and plan.activity_list_statuses:
            flats_only = plan.activity_list_scope == "flats"
            common_areas_only = plan.activity_list_scope == "common_areas"
            if plan.floor_id and floor_snapshot:
                if flats_only:
                    rooms = _rooms_in_scope(floor_snapshot, None, None, flats_only=True)
                elif common_areas_only:
                    rooms = _rooms_in_scope(floor_snapshot, None, _COMMON_AREA_FLAT)
                else:
                    rooms = _rooms_in_scope(floor_snapshot, plan.flat_name, plan.common_area_name)
            else:
                rooms = await self._rooms_across_project(
                    org_id, project_context, flats_only=flats_only, common_areas_only=common_areas_only,
                )
            items = drishti_analytics.list_activities_by_status(rooms, plan.activity_list_statuses)

            # A room's own activities[] is only ever populated once that
            # room has actually been captured/assessed — an uncaptured
            # room's activities is a bare [] in the raw snapshot (confirmed
            # against production data), so not_assessed/not_observable/
            # no_evidence activities structurally CANNOT appear via the
            # room-level path above no matter how many exist. A real
            # production bug: "what are those 101 activities that did not
            # start" (statuses not_assessed/no_evidence) always returned an
            # empty list for this reason. Those statuses only exist in each
            # snapshot's separate per-floor "activities" rollup (one entry
            # per activity NAME for the whole floor, no room location) —
            # fetched here ONLY when actually requested, merged in by name.
            floor_level_statuses = [
                s for s in plan.activity_list_statuses
                if s in ("not_assessed", "not_observable", "no_evidence")
            ]
            if floor_level_statuses:
                if plan.floor_id and floor_snapshot:
                    floor_activities = {plan.floor_id: floor_snapshot.get("activities", [])}
                    floor_names = {plan.floor_id: plan.floor_name}
                else:
                    floor_ids = [f["floorId"] for t in project_context["towers"] for f in t["floors"]]
                    snapshots = await self._context_service.get_latest_snapshots_for_floors(org_id, floor_ids)
                    floor_activities = {fid: snap.get("activities", []) for fid, snap in snapshots.items()}
                    floor_names = {
                        f["floorId"]: f["floorName"]
                        for t in project_context["towers"] for f in t["floors"]
                    }
                items = items + drishti_analytics.list_floor_level_activities_by_status(
                    floor_activities, floor_level_statuses, floor_names,
                )

            payload["activityList"] = {
                "statuses": plan.activity_list_statuses,
                "scope": plan.activity_list_scope or "all",
                "items": items,
            }

        # Whole-floor-grain intents keep today's coarser payload. Guarded
        # individually (rather than with a shared `if not plan.floor_id:
        # return payload` above, as this used to be structured) because a
        # real production bug had exactly that blanket early return sitting
        # BEFORE the forecast/quality-notes blocks further down too: any
        # project-wide question ("When is Project A projected to finish?",
        # intent=project_overview, floor_id=None) hit that return and never
        # even reached forecast assembly at all — confirmed by calling
        # _assemble_facts_payload directly against live data, which showed
        # the returned payload had no "forecast" key whatsoever for this
        # exact question, despite plan.needs_forecast being True. Every
        # other block below already independently checks its own required
        # fields (plan.flat_name, plan.activity_ids, floor_snapshot, etc.)
        # and is naturally a no-op when floor_id is unset, so only this one
        # coarse-snapshot block actually needed a floor_id guard at all.
        if plan.floor_id and plan.intent in ("floor_status", "comparison", "quality_query"):
            coverage = await self._context_service.compute_capture_coverage(org_id, plan.floor_id)
            payload["floor"] = {
                "floorId": plan.floor_id,
                "floorName": plan.floor_name,
                "snapshot": _trim_floor_snapshot(floor_snapshot),
                "captureCoverage": coverage,
            }

        if plan.intent == "flat_status" and plan.flat_name:
            flat = _find_flat(floor_snapshot, plan.flat_name) if floor_snapshot else None
            payload["flat"] = {
                "flatName": plan.flat_name,
                "flat": flat,
                "resolutionStatus": plan.resolution_status.get("flat", "not_configured"),
            }

        if plan.floor_id and plan.intent == "room_status" and plan.flat_name and plan.room_name:
            payload["room"] = await self._context_service.get_room_context(
                org_id, plan.floor_id, plan.flat_name, plan.room_name, snapshot=floor_snapshot,
            )

        if plan.floor_id and plan.intent == "common_area_status" and plan.common_area_name:
            payload["commonArea"] = await self._context_service.get_common_area_context(
                org_id, plan.floor_id, plan.common_area_name, snapshot=floor_snapshot,
            )

        # "What OTHER activities are pending in the Lift Lobby" / "what's
        # configured in Bedroom-3" — every activity at exactly ONE location,
        # any status, unfiltered by activity name — the "everything here"
        # question none of the other intents answer on their own. Requires a
        # resolved floor — these are all floor-scoped lookups (see
        # get_room_context/get_common_area_context/get_activity_context/
        # get_common_area_category_status below, same requirement) that call
        # get_floor_context(org_id, floor_id) internally when no snapshot is
        # passed; with floor_id=None that raises, so — unlike before this
        # block's shared guard was narrowed to just the coarse-snapshot
        # block above — each of these needs its OWN `plan.floor_id` check.
        if plan.floor_id and plan.intent == "location_activities" and (plan.common_area_name or (plan.flat_name and plan.room_name)):
            payload["locationActivities"] = await self._context_service.get_location_activities(
                org_id, plan.floor_id,
                flat_name=plan.flat_name, room_name=plan.room_name,
                common_area_name=plan.common_area_name, snapshot=floor_snapshot,
            )

        if plan.floor_id and plan.intent == "activity_status" and plan.activity_ids:
            payload["activity"] = await self._context_service.get_activity_context(
                org_id, plan.floor_id, plan.activity_ids,
                flat_name=plan.flat_name, room_name=plan.room_name,
                common_area_name=plan.common_area_name, snapshot=floor_snapshot,
            )

        # "What is the status of painting across the Common Areas" — one
        # activity category, aggregated across EVERY common-area unit on
        # this floor (never restricted to one named unit) — distinguishing
        # captured-and-assessed units from never-captured ones per the spec.
        if plan.floor_id and plan.intent == "common_area_activity_status" and plan.activity_ids:
            payload["commonAreaActivity"] = await self._context_service.get_common_area_category_status(
                org_id, plan.floor_id, plan.activity_ids, snapshot=floor_snapshot,
            )

        if plan.intent in ("activity_ranking", "flat_ranking", "common_area_ranking", "unfinished_work") and floor_snapshot:
            direction = plan.ranking_direction or ("fastest" if plan.intent == "activity_ranking" else "most_progressed")
            rooms = _rooms_in_scope(floor_snapshot, plan.flat_name, plan.common_area_name)
            if plan.intent == "activity_ranking":
                payload["ranking"] = drishti_analytics.rank_activities(rooms, direction, flat_name=plan.flat_name)
            elif plan.intent == "flat_ranking":
                payload["ranking"] = drishti_analytics.rank_flats(floor_snapshot.get("flatProgress", []), direction)
            elif plan.intent == "common_area_ranking":
                payload["ranking"] = drishti_analytics.rank_common_areas(floor_snapshot.get("flatProgress", []), direction)
            elif plan.intent == "unfinished_work":
                payload["unfinishedWork"] = drishti_analytics.rank_unfinished_work(rooms, flat_name=plan.flat_name)

        if plan.intent == "capture_gap":
            if plan.floor_id and floor_snapshot:
                flat_progress = floor_snapshot.get("flatProgress", [])
                payload["captureGaps"] = drishti_analytics.find_capture_gaps(flat_progress)
                payload["capturedRooms"] = drishti_analytics.find_captured_rooms(flat_progress)
            elif not plan.floor_id:
                # "How many total rooms are captured?" / "which rooms have
                # been captured" with no floor named — a real production
                # bug: this intent had no project-wide path at all (unlike
                # activity_status/common_area_activity_status/activity_list,
                # which all already had one), so the payload came back with
                # NEITHER "captureGaps" NOR "capturedRooms" and the LLM
                # truthfully reported it had no data — even though
                # summaryCards.roomsInProgress/roomsNotStarted prove the
                # real counts were sitting right there in the project
                # snapshot the whole time.
                gaps, captured = await self._capture_status_across_project(org_id, project_context)
                payload["captureGaps"] = gaps
                payload["capturedRooms"] = captured

        if plan.needs_forecast or plan.intent == "forecast":
            if plan.floor_id:
                payload["forecast"] = await self._forecast_service.forecast_floor(org_id, plan.floor_id)
                planned_dates = await self._forecast_service.get_planned_dates(org_id, project_id)
                if planned_dates:
                    payload["forecast"]["plannedDates"] = planned_dates
            else:
                floor_ids = [
                    f["floorId"] for t in project_context["towers"] for f in t["floors"]
                ]
                payload["forecast"] = await self._forecast_service.forecast_project(
                    org_id, project_id, floor_ids
                )

        if plan.needs_quality_notes or plan.intent in ("quality_query", "management_summary"):
            payload["qualityNotes"] = await self._context_service.get_quality_notes(
                org_id, user_id, role, project_id
            )

        if plan.intent == "management_summary" and floor_snapshot:
            coverage = payload.get("floor", {}).get("captureCoverage") or await self._context_service.compute_capture_coverage(org_id, plan.floor_id)
            unfinished = drishti_analytics.rank_unfinished_work(_rooms_in_scope(floor_snapshot, None, None))
            capture_gaps = drishti_analytics.find_capture_gaps(floor_snapshot.get("flatProgress", []))
            forecast = payload.get("forecast") or await self._forecast_service.forecast_floor(org_id, plan.floor_id)
            payload["topConcerns"] = drishti_analytics.synthesize_top_concerns(
                floor_snapshot=floor_snapshot,
                coverage=coverage,
                unfinished_work=unfinished,
                capture_gaps=capture_gaps,
                quality_notes=payload.get("qualityNotes", []),
                forecast=forecast,
            )

        return payload

    async def _rooms_across_project(
        self, org_id: str, project_context: dict[str, Any], *,
        flats_only: bool = False, common_areas_only: bool = False,
    ) -> list[dict[str, Any]]:
        """Every room (real or common-area) across every analyzed floor in
        the project, each tagged with its own flatName (see
        `_tag_rooms_with_flat_name`), in one batched snapshot fetch — the
        project-wide counterpart to `_rooms_in_scope`, used when an activity
        ranking/unfinished-work/status-listing question names no floor.
        `flats_only`/`common_areas_only` narrow to just one side — e.g.
        "which activities are in progress in the flats?" project-wide."""
        floor_ids = [f["floorId"] for t in project_context.get("towers", []) for f in t.get("floors", [])]
        snapshots = await self._context_service.get_latest_snapshots_for_floors(org_id, floor_ids)
        rooms: list[dict[str, Any]] = []
        for snapshot in snapshots.values():
            for flat in snapshot.get("flatProgress", []):
                is_common = str(flat.get("flatName") or "") == _COMMON_AREA_FLAT
                if flats_only and is_common:
                    continue
                if common_areas_only and not is_common:
                    continue
                rooms.extend(_tag_rooms_with_flat_name(flat))
        return rooms

    async def _capture_status_across_project(
        self, org_id: str, project_context: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Project-wide counterpart to the floor-scoped capture_gap branch —
        the project-wide equivalent already exists for activity_status/
        common_area_activity_status/activity_list, but capture_gap had no
        such path. `find_capture_gaps`/`find_captured_rooms` are pure
        functions over a `flatProgress`-shaped list; run them once per
        analyzed floor (batched via `get_latest_snapshots_for_floors`,
        never a per-floor query) and merge, tagging each hit with its
        `floorName` so a project-wide answer can still say WHERE a gap is."""
        floor_lookup = {
            f["floorId"]: f["floorName"]
            for t in project_context.get("towers", []) for f in t.get("floors", [])
        }
        snapshots = await self._context_service.get_latest_snapshots_for_floors(
            org_id, list(floor_lookup.keys()),
        )
        gaps: list[dict[str, Any]] = []
        captured: list[dict[str, Any]] = []
        for floor_id, snapshot in snapshots.items():
            flat_progress = snapshot.get("flatProgress", [])
            floor_name = floor_lookup.get(floor_id)
            for gap in drishti_analytics.find_capture_gaps(flat_progress):
                gaps.append({**gap, "floorId": floor_id, "floorName": floor_name})
            for room in drishti_analytics.find_captured_rooms(flat_progress):
                captured.append({**room, "floorId": floor_id, "floorName": floor_name})
        gaps.sort(key=lambda g: g["capturesCount"])
        captured.sort(key=lambda r: r["capturesCount"], reverse=True)
        return gaps, captured

    # ── LLM call + validation guardrail ───────────────────────────────────

    async def _generate_answer(
        self,
        question: str,
        facts_payload: dict[str, Any],
        recent_messages: list[dict[str, Any]],
        usage_out: dict[str, Any],
    ) -> DrishtiAnswer:
        history_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in recent_messages
        )
        user_prompt = (
            f"Facts payload (JSON):\n{json.dumps(facts_payload, default=str)}\n\n"
            f"Recent conversation:\n{history_text}\n\n"
            f"Question: {question}"
        )

        try:
            raw = await drishti_llm_client.chat_completion_json(
                DRISHTI_ANSWER_PROMPT, user_prompt, max_tokens=_ANSWER_MAX_TOKENS,
                usage_out=usage_out,
            )
            return DrishtiAnswer.model_validate(raw)
        except (drishti_llm_client.DrishtiLLMError, ValidationError) as first_error:
            retry_prompt = (
                f"{user_prompt}\n\nYour previous response did not match the required JSON "
                f"schema ({first_error}). Return ONLY valid JSON matching the schema exactly."
            )
            try:
                raw = await drishti_llm_client.chat_completion_json(
                    DRISHTI_ANSWER_PROMPT, retry_prompt, max_tokens=_ANSWER_MAX_TOKENS,
                    usage_out=usage_out,
                )
                return DrishtiAnswer.model_validate(raw)
            except (drishti_llm_client.DrishtiLLMError, ValidationError):
                return DrishtiAnswer(answer=_FALLBACK_ANSWER_TEXT)

    # ── Suggested questions (template-based, no LLM call) ─────────────────

    async def get_suggested_questions(self, org_id: str, project_id: str) -> list[str]:
        context = await self._context_service.get_project_context(org_id, project_id)
        project_name = "this project"
        project_doc = await self._db["projects"].find_one(
            {"orgId": org_id, "$or": [{"_id": _oid_or_str(project_id)}, {"id": project_id}]}
        )
        if project_doc:
            project_name = str(project_doc.get("name") or project_name)

        questions = [
            f"How is {project_name} progressing?",
            "Which floor is furthest behind?",
            f"When is {project_name} projected to finish?",
            "Are there any quality concerns reported recently?",
        ]
        if context["floorsNotYetAnalyzed"] > 0:
            questions.insert(1, "Which floors haven't been analyzed yet?")
        return questions

    # ── Conversation CRUD ──────────────────────────────────────────────────

    async def list_conversations(
        self, org_id: str, user_id: str, project_id: Optional[str] = None
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id, "userId": user_id}
        if project_id:
            query["projectId"] = project_id
        docs = await self._db[_COLLECTION].find(query).sort("updatedAt", -1).to_list(length=200)
        return [
            {
                "conversationId": str(d["_id"]),
                "projectId": d["projectId"],
                "projectName": d.get("projectName", ""),
                "title": d.get("title", ""),
                "updatedAt": _as_utc(d.get("updatedAt")),
            }
            for d in docs
        ]

    async def get_conversation(self, org_id: str, user_id: str, conversation_id: str) -> dict[str, Any]:
        doc = await self._db[_COLLECTION].find_one({"_id": _oid_or_str(conversation_id)})
        if not doc or doc.get("orgId") != org_id or doc.get("userId") != user_id:
            raise NotFoundException("conversation", conversation_id)
        return {
            "conversationId": str(doc["_id"]),
            "projectId": doc["projectId"],
            "projectName": doc.get("projectName", ""),
            "title": doc.get("title", ""),
            "scope": doc.get("scope") or {},
            "messages": [_message_with_utc_timestamp(m) for m in doc.get("messages", [])],
            "createdAt": _as_utc(doc.get("createdAt")),
            "updatedAt": _as_utc(doc.get("updatedAt")),
        }

    async def delete_conversation(self, org_id: str, user_id: str, conversation_id: str) -> int:
        result = await self._db[_COLLECTION].delete_one(
            {"_id": _oid_or_str(conversation_id), "orgId": org_id, "userId": user_id}
        )
        return result.deleted_count

    async def rename_conversation(
        self, org_id: str, user_id: str, conversation_id: str, title: str
    ) -> dict[str, Any]:
        clean = " ".join((title or "").split()).strip()
        if not clean:
            raise ValidationException("Chat title cannot be empty")
        clean = clean[:120]
        now = datetime.now(timezone.utc)
        result = await self._db[_COLLECTION].find_one_and_update(
            {"_id": _oid_or_str(conversation_id), "orgId": org_id, "userId": user_id},
            {"$set": {"title": clean, "updatedAt": now}},
            return_document=ReturnDocument.AFTER,
        )
        if not result:
            raise NotFoundException("conversation", conversation_id)
        return {
            "conversationId": str(result["_id"]),
            "projectId": result["projectId"],
            "projectName": result.get("projectName", ""),
            "title": result.get("title", clean),
            "updatedAt": _as_utc(result.get("updatedAt")),
        }


def _trim_floor_snapshot(snapshot: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Keeps the facts payload compact: drops room-heatmap pixel/pin geometry
    and per-capture ids the LLM doesn't need to answer in prose, keeps
    everything that carries actual progress/evidence meaning."""
    if not snapshot:
        return None
    return {
        "overallProgressPct": snapshot.get("overallProgressPct"),
        "overallStatus": snapshot.get("overallStatus"),
        "executiveSummary": snapshot.get("executiveSummary"),
        "summaryCards": snapshot.get("summaryCards"),
        "flatProgress": snapshot.get("flatProgress"),
        "snapshotDate": snapshot.get("snapshotDate"),
    }


def _tag_rooms_with_flat_name(flat: dict[str, Any]) -> list[dict[str, Any]]:
    """Stamps each room dict with its owning flat's name so a caller that
    flattens rooms across multiple flats (whole floor / whole project) can
    still attribute every activity to the correct flat — without this, a
    multi-flat activity listing would either drop flatName entirely or
    blanket-mislabel every room with one flat's name."""
    flat_name = flat.get("flatName")
    return [{**room, "flatName": flat_name} for room in flat.get("rooms", [])]


def _rooms_in_scope(
    floor_snapshot: dict[str, Any], flat_name: Optional[str], common_area_name: Optional[str],
    *, flats_only: bool = False,
) -> list[dict[str, Any]]:
    """Picks the right rooms[] slice to feed drishti_analytics' ranking
    functions: a specific flat's rooms, the Common Area pseudo-flat's rooms
    (common_area_name set means "rank within common areas"), every REAL
    flat's rooms excluding common areas (flats_only=True — "in the flats?"),
    or every room on the floor (both real flats and common areas, each
    correctly tagged with its own flatName) when none of the above is given
    — still deterministic Python, never left to the LLM to figure out."""
    flat_progress = floor_snapshot.get("flatProgress", [])
    if flat_name:
        flat = _find_flat(floor_snapshot, flat_name)
        return flat.get("rooms", []) if flat else []
    if common_area_name is not None:
        common_flat = _find_flat(floor_snapshot, _COMMON_AREA_FLAT)
        return common_flat.get("rooms", []) if common_flat else []
    if flats_only:
        return [
            room for flat in flat_progress if str(flat.get("flatName") or "") != _COMMON_AREA_FLAT
            for room in _tag_rooms_with_flat_name(flat)
        ]
    return [room for flat in flat_progress for room in _tag_rooms_with_flat_name(flat)]
