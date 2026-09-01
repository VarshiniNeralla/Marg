"""Shared LLM token-usage ledger for the admin Audit page.

Every LLM call site (construction-progress vision analysis, Drishti chat,
future ones) writes one record here via `record_usage`. The Audit page reads
from this single collection instead of reaching into each feature's own
storage, so a new LLM call site only needs one `record_usage` call to show
up in the audit totals.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

_COLLECTION = "llm_usage"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LLMUsageService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    async def record_usage(
        self,
        *,
        org_id: str,
        source: str,
        model: str | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        total_tokens: int | None,
        latency_ms: float | None = None,
        project_id: str = "",
        project_name: str = "",
        tower: str = "",
        floor: str = "",
        pin_name: str = "",
        requested_by: str | None = None,
        entity_id: str | None = None,
    ) -> None:
        prompt = int(prompt_tokens or 0)
        completion = int(completion_tokens or 0)
        total = int(total_tokens or (prompt + completion))
        doc = {
            "_id": str(uuid.uuid4()),
            "org_id": org_id,
            "source": source,
            "model": model,
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": total,
            "latency_ms": latency_ms,
            "project_id": project_id,
            "project_name": project_name,
            "tower": tower,
            "floor": floor,
            "pin_name": pin_name,
            "requested_by": requested_by,
            "entity_id": entity_id,
            "created_at": _utcnow(),
        }
        await self._db[_COLLECTION].insert_one(doc)

    async def list_audit(
        self,
        org_id: str,
        *,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
        query: dict[str, Any] = {"org_id": org_id}
        total = await self._db[_COLLECTION].count_documents(query)
        cursor = (
            self._db[_COLLECTION]
            .find(query)
            .sort([("created_at", -1)])
            .skip(skip)
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)

        user_ids = {str(doc.get("requested_by") or "") for doc in docs if doc.get("requested_by")}
        user_names = await self._resolve_user_names(user_ids)

        items = [_serialize_audit_entry(doc, user_names) for doc in docs]
        summary = await self._aggregate_summary(query)
        return items, total, summary

    async def _aggregate_summary(self, query: dict[str, Any]) -> dict[str, Any]:
        pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": None,
                    "analysisCount": {"$sum": 1},
                    "promptTokens": {"$sum": {"$ifNull": ["$prompt_tokens", 0]}},
                    "completionTokens": {"$sum": {"$ifNull": ["$completion_tokens", 0]}},
                    "totalTokens": {"$sum": {"$ifNull": ["$total_tokens", 0]}},
                }
            },
        ]
        rows = await self._db[_COLLECTION].aggregate(pipeline).to_list(length=1)
        if not rows:
            return {"analysisCount": 0, "promptTokens": 0, "completionTokens": 0, "totalTokens": 0}
        row = rows[0]
        return {
            "analysisCount": int(row.get("analysisCount") or 0),
            "promptTokens": int(row.get("promptTokens") or 0),
            "completionTokens": int(row.get("completionTokens") or 0),
            "totalTokens": int(row.get("totalTokens") or 0),
        }

    async def _resolve_user_names(self, user_ids: set[str]) -> dict[str, str]:
        from bson import ObjectId

        names: dict[str, str] = {}
        for uid in user_ids:
            if not uid:
                continue
            filt: dict[str, Any]
            if ObjectId.is_valid(uid):
                filt = {"$or": [{"_id": uid}, {"_id": ObjectId(uid)}]}
            else:
                filt = {"_id": uid}
            doc = await self._db.users.find_one(filt, {"name": 1})
            if doc:
                names[uid] = str(doc.get("name") or "Unknown")
        return names


_SOURCE_LABELS = {
    "progress_analysis": "Progress Report",
    "construction_progress": "Construction Progress",
    "drishti_chat": "Drishti Chat",
}


def _serialize_audit_entry(doc: dict[str, Any], user_names: dict[str, str]) -> dict[str, Any]:
    requested_by = str(doc.get("requested_by") or "") or None
    source = doc.get("source") or ""
    return {
        "reportId": str(doc["_id"]),
        "source": source,
        "sourceLabel": _SOURCE_LABELS.get(source, source or "—"),
        "projectId": doc.get("project_id", "") or "",
        "projectName": doc.get("project_name", ""),
        "tower": doc.get("tower", ""),
        "floor": doc.get("floor", ""),
        "pinName": doc.get("pin_name", ""),
        "model": doc.get("model"),
        "promptTokens": int(doc.get("prompt_tokens") or 0),
        "completionTokens": int(doc.get("completion_tokens") or 0),
        "totalTokens": int(doc.get("total_tokens") or 0),
        "requestedBy": requested_by,
        "requestedByName": user_names.get(requested_by or "", None) if requested_by else None,
        "createdAt": doc.get("created_at"),
        "latencyMs": doc.get("latency_ms"),
    }
