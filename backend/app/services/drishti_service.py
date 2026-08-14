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

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from app.core.exceptions import NotFoundException
from app.schemas.drishti import DrishtiAnswer, DrishtiMessage
from app.services import drishti_llm_client
from app.services.drishti_context_service import DrishtiContextService
from app.services.drishti_forecast_service import DrishtiForecastService
from app.services.drishti_prompts import DRISHTI_ANSWER_PROMPT
from app.services.drishti_query_planner import DrishtiQueryPlanner, QueryPlan

_COLLECTION = "drishti_conversations"

_FALLBACK_ANSWER_TEXT = (
    "I couldn't structure a confident answer from the available data — try rephrasing, "
    "or asking about a specific floor or flat."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid_or_str(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else value


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

        plan = await self._planner.plan(
            question=question,
            conversation_history=[
                {"role": m["role"], "content": m["content"]} for m in conversation["messages"][-6:]
            ],
            known_entities=known_entities,
            previous_scope=conversation.get("scope") or {},
        )

        facts_payload = await self._assemble_facts_payload(
            org_id, user_id, role, project_id, project_context, plan
        )

        answer = await self._generate_answer(question, facts_payload, conversation["messages"][-6:])

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
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "project": {
                "projectId": project_context["projectId"],
                "overallProgressPct": project_context["overallProgressPct"],
                "floorsAnalyzed": project_context["floorsAnalyzed"],
                "floorsNotYetAnalyzed": project_context["floorsNotYetAnalyzed"],
                "summaryCards": project_context["summaryCards"],
            },
        }

        if plan.intent == "project_overview" or plan.intent == "general":
            payload["towers"] = project_context["towers"]

        if plan.tower_id and plan.intent in ("tower_status", "comparison"):
            for tower in project_context["towers"]:
                if tower["towerId"] == plan.tower_id:
                    payload["tower"] = tower
                    break

        if plan.floor_id and plan.intent in ("floor_status", "flat_status", "comparison", "quality_query"):
            floor_snapshot = await self._context_service.get_floor_context(org_id, plan.floor_id)
            coverage = await self._context_service.compute_capture_coverage(org_id, plan.floor_id)
            payload["floor"] = {
                "floorId": plan.floor_id,
                "floorName": plan.floor_name,
                "snapshot": _trim_floor_snapshot(floor_snapshot),
                "captureCoverage": coverage,
            }
            if plan.flat_name and plan.intent == "flat_status":
                flat = await self._context_service.get_flat_context(org_id, plan.floor_id, plan.flat_name)
                payload["flat"] = flat

        if plan.needs_forecast or plan.intent == "forecast":
            if plan.floor_id:
                payload["forecast"] = await self._forecast_service.forecast_floor(org_id, plan.floor_id)
            else:
                floor_ids = [
                    f["floorId"] for t in project_context["towers"] for f in t["floors"]
                ]
                payload["forecast"] = await self._forecast_service.forecast_project(
                    org_id, project_id, floor_ids
                )

        if plan.needs_quality_notes or plan.intent == "quality_query":
            payload["qualityNotes"] = await self._context_service.get_quality_notes(
                org_id, user_id, role, project_id
            )

        return payload

    # ── LLM call + validation guardrail ───────────────────────────────────

    async def _generate_answer(
        self, question: str, facts_payload: dict[str, Any], recent_messages: list[dict[str, Any]]
    ) -> DrishtiAnswer:
        history_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in recent_messages
        )
        user_prompt = (
            f"Facts payload (JSON):\n{facts_payload}\n\n"
            f"Recent conversation:\n{history_text}\n\n"
            f"Question: {question}"
        )

        try:
            raw = await drishti_llm_client.chat_completion_json(DRISHTI_ANSWER_PROMPT, user_prompt)
            return DrishtiAnswer.model_validate(raw)
        except (drishti_llm_client.DrishtiLLMError, ValidationError) as first_error:
            retry_prompt = (
                f"{user_prompt}\n\nYour previous response did not match the required JSON "
                f"schema ({first_error}). Return ONLY valid JSON matching the schema exactly."
            )
            try:
                raw = await drishti_llm_client.chat_completion_json(DRISHTI_ANSWER_PROMPT, retry_prompt)
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
                "updatedAt": d.get("updatedAt"),
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
            "messages": doc.get("messages", []),
            "createdAt": doc.get("createdAt"),
            "updatedAt": doc.get("updatedAt"),
        }

    async def delete_conversation(self, org_id: str, user_id: str, conversation_id: str) -> int:
        result = await self._db[_COLLECTION].delete_one(
            {"_id": _oid_or_str(conversation_id), "orgId": org_id, "userId": user_id}
        )
        return result.deleted_count


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
