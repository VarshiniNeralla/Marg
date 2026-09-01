from __future__ import annotations

import asyncio
import base64
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import Settings, get_settings
from app.services.image_fetch import download_image, resize_if_needed, validate_image_url
from app.services.llm_usage_service import LLMUsageService
from app.services.vision_providers.base import VisionProvider
from app.services.vision_providers.compare_progress_prompt import COMPARE_ANALYSIS_PROMPT_VERSION
from app.services.vision_providers.groq_provider import GroqVisionProvider
from app.services.vision_providers.vllm_provider import VllmVisionProvider

_SAFE_TEXT_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_MAX_FIELD_LEN = 200

_COLLECTION_CACHE = "progress_analyses"
_COLLECTION_JOBS = "progress_analysis_jobs"

_JOB_STATUS_PENDING = "pending"
_JOB_STATUS_PROCESSING = "processing"
_JOB_STATUS_COMPLETED = "completed"
_JOB_STATUS_FAILED = "failed"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _sanitize_text(value: str, *, max_len: int = _MAX_FIELD_LEN) -> str:
    cleaned = _SAFE_TEXT_RE.sub("", (value or "").strip())
    return cleaned[:max_len]


def get_vision_provider(provider_name: str | None = None) -> VisionProvider:
    """Factory for vision providers — swap implementation with minimal changes."""
    settings = get_settings()
    name = (provider_name or settings.vision_provider).lower()
    if name == "vllm":
        return VllmVisionProvider(settings)
    if name == "groq":
        return GroqVisionProvider(settings)
    raise ValueError(f"Unsupported vision provider: {name}")


class AIProgressService:
    """Orchestrates construction progress analysis with caching and async jobs."""

    def __init__(
        self,
        db: AsyncIOMotorDatabase,
        *,
        settings: Settings | None = None,
        provider: VisionProvider | None = None,
    ) -> None:
        self._db = db
        self._settings = settings or get_settings()
        self._provider = provider or get_vision_provider(self._settings.vision_provider)
        self._timeout = (
            float(self._settings.VLLM_HTTP_TIMEOUT_S)
            if self._settings.vision_provider == "vllm"
            else float(self._settings.GROQ_REQUEST_TIMEOUT_SECONDS)
        )
    async def get_cached_analysis(
        self,
        org_id: str,
        before_timeline_id: str,
        after_timeline_id: str,
    ) -> dict[str, Any] | None:
        doc = await self._db[_COLLECTION_CACHE].find_one(
            {
                "org_id": org_id,
                "before_timeline_id": before_timeline_id,
                "after_timeline_id": after_timeline_id,
            }
        )
        if not doc:
            return None
        return doc.get("analysis")

    async def _get_cached_doc(
        self,
        org_id: str,
        before_timeline_id: str,
        after_timeline_id: str,
    ) -> dict[str, Any] | None:
        return await self._db[_COLLECTION_CACHE].find_one(
            {
                "org_id": org_id,
                "before_timeline_id": before_timeline_id,
                "after_timeline_id": after_timeline_id,
            }
        )

    async def _backfill_report_metadata(
        self,
        org_id: str,
        before_timeline_id: str,
        after_timeline_id: str,
        *,
        user_id: str,
        project_id: str,
        project_name: str,
        tower: str,
        floor: str,
        pin_name: str,
        before_date: str,
        after_date: str,
        capture_type: str,
        before_image_url: str = "",
        after_image_url: str = "",
        floor_plan_image_url: str = "",
        pin_x: float | None = None,
        pin_y: float | None = None,
    ) -> None:
        """Ensure cached reports always carry display metadata for the reports list."""
        metadata = _report_metadata_fields(
            user_id=user_id,
            project_id=project_id,
            project_name=project_name,
            tower=tower,
            floor=floor,
            pin_name=pin_name,
            before_date=before_date,
            after_date=after_date,
            capture_type=capture_type,
            before_image_url=before_image_url,
            after_image_url=after_image_url,
            floor_plan_image_url=floor_plan_image_url,
            pin_x=pin_x,
            pin_y=pin_y,
        )
        await self._db[_COLLECTION_CACHE].update_one(
            {
                "org_id": org_id,
                "before_timeline_id": before_timeline_id,
                "after_timeline_id": after_timeline_id,
            },
            {"$set": metadata},
        )

    async def start_analysis(
        self,
        *,
        org_id: str,
        user_id: str,
        before_timeline_id: str,
        after_timeline_id: str,
        before_image: str,
        after_image: str,
        before_date: str,
        after_date: str,
        project_name: str,
        tower: str,
        floor: str,
        pin_name: str,
        capture_type: str = "360",
        project_id: str = "",
        floor_plan_image: str = "",
        floor_plan_id: str = "",
        pin_x: float | None = None,
        pin_y: float | None = None,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        before_timeline_id = _sanitize_text(before_timeline_id, max_len=64)
        after_timeline_id = _sanitize_text(after_timeline_id, max_len=64)

        if not before_timeline_id or not after_timeline_id:
            raise ValueError("beforeTimelineId and afterTimelineId are required")
        if before_timeline_id == after_timeline_id:
            raise ValueError("Timeline A and Timeline B must be different captures")

        cached_doc = await self._get_cached_doc(org_id, before_timeline_id, after_timeline_id)

        before_url = validate_image_url(before_image, settings=self._settings)
        after_url = validate_image_url(after_image, settings=self._settings)
        floor_plan_url = ""
        if floor_plan_image.strip():
            floor_plan_url = validate_image_url(floor_plan_image, settings=self._settings)

        visual_kwargs = dict(
            before_image_url=before_url,
            after_image_url=after_url,
            floor_plan_image_url=floor_plan_url,
            pin_x=pin_x,
            pin_y=pin_y,
        )

        if force_refresh and cached_doc:
            await self._db[_COLLECTION_CACHE].delete_one({"_id": cached_doc["_id"]})
            cached_doc = None
            logger.info(
                "Progress analysis cache cleared (force refresh) org={} before={} after={}",
                org_id,
                before_timeline_id,
                after_timeline_id,
            )

        if not force_refresh and cached_doc and cached_doc.get("analysis"):
            cached_before = str(
                cached_doc.get("before_image_url") or cached_doc.get("before_image") or ""
            )
            cached_after = str(
                cached_doc.get("after_image_url") or cached_doc.get("after_image") or ""
            )
            cached_version = str(
                cached_doc.get("prompt_version")
                or cached_doc.get("promptVersion")
                or ""
            )
            version_ok = cached_version == COMPARE_ANALYSIS_PROMPT_VERSION
            if cached_before == before_url and cached_after == after_url and version_ok:
                # Re-normalize so older-shaped payloads still expose new fields.
                analysis = _normalize_analysis(cached_doc.get("analysis") or {})
                await self._backfill_report_metadata(
                    org_id,
                    before_timeline_id,
                    after_timeline_id,
                    user_id=user_id,
                    project_id=project_id,
                    project_name=project_name,
                    tower=tower,
                    floor=floor,
                    pin_name=pin_name,
                    before_date=before_date,
                    after_date=after_date,
                    capture_type=capture_type,
                    **visual_kwargs,
                )
                logger.info(
                    "Progress analysis cache hit org={} before={} after={} version={}",
                    org_id,
                    before_timeline_id,
                    after_timeline_id,
                    cached_version,
                )
                return {
                    "status": _JOB_STATUS_COMPLETED,
                    "jobId": None,
                    "reportId": str(cached_doc["_id"]),
                    "saved": bool(cached_doc.get("saved")),
                    "cached": True,
                    "analysis": analysis,
                }
            if cached_before == before_url and cached_after == after_url and not version_ok:
                logger.info(
                    "Progress analysis cache bypassed — prompt version mismatch "
                    "org={} before={} after={} cached={} current={}",
                    org_id,
                    before_timeline_id,
                    after_timeline_id,
                    cached_version or "(none)",
                    COMPARE_ANALYSIS_PROMPT_VERSION,
                )

        if cached_doc and cached_doc.get("analysis"):
            logger.info(
                "Progress analysis cache bypassed — images changed org={} before={} after={}",
                org_id,
                before_timeline_id,
                after_timeline_id,
            )

        existing_job = await self._db[_COLLECTION_JOBS].find_one(
            {
                "org_id": org_id,
                "before_timeline_id": before_timeline_id,
                "after_timeline_id": after_timeline_id,
                "status": {"$in": [_JOB_STATUS_PENDING, _JOB_STATUS_PROCESSING]},
            },
            sort=[("created_at", -1)],
        )
        if existing_job:
            return {
                "status": existing_job["status"],
                "jobId": existing_job["_id"],
                "cached": False,
                "analysis": None,
            }

        job_id = str(uuid.uuid4())
        now = _utcnow()
        job_doc = {
            "_id": job_id,
            "org_id": org_id,
            **_report_metadata_fields(
                user_id=user_id,
                project_id=project_id,
                project_name=project_name,
                tower=tower,
                floor=floor,
                pin_name=pin_name,
                before_date=before_date,
                after_date=after_date,
                capture_type=capture_type,
                **visual_kwargs,
            ),
            "before_timeline_id": before_timeline_id,
            "after_timeline_id": after_timeline_id,
            "before_image": before_url,
            "after_image": after_url,
            "status": _JOB_STATUS_PENDING,
            "analysis": None,
            "error": None,
            "model": None,
            "latency_ms": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "created_at": now,
            "completed_at": None,
        }
        await self._db[_COLLECTION_JOBS].insert_one(job_doc)

        asyncio.create_task(self._run_job(job_id))

        return {
            "status": _JOB_STATUS_PENDING,
            "jobId": job_id,
            "cached": False,
            "analysis": None,
        }

    async def get_job(self, org_id: str, job_id: str) -> dict[str, Any] | None:
        return await self._db[_COLLECTION_JOBS].find_one({"_id": job_id, "org_id": org_id})

    async def purge_for_timeline(self, org_id: str, timeline_id: str) -> int:
        """
        Remove cached analyses / jobs that reference a deleted capture.

        Progress reports store capture ids as before/after timeline ids and keep
        baked-in image URLs, so deleting a capture without this purge leaves
        ghost reports (and stale images) in the compare / library UI.
        """
        tid = _sanitize_text(timeline_id, max_len=64)
        if not tid:
            return 0
        match = {
            "org_id": org_id,
            "$or": [
                {"before_timeline_id": tid},
                {"after_timeline_id": tid},
            ],
        }
        cache_result = await self._db[_COLLECTION_CACHE].delete_many(match)
        jobs_result = await self._db[_COLLECTION_JOBS].delete_many(match)
        removed = int(cache_result.deleted_count) + int(jobs_result.deleted_count)
        if removed:
            logger.info(
                "Purged {} progress-analysis record(s) for timeline_id={} org_id={}",
                removed,
                tid,
                org_id,
            )
        return removed

    async def _existing_capture_ids(self, org_id: str, ids: set[str]) -> set[str]:
        clean = {_sanitize_text(i, max_len=64) for i in ids if i}
        clean.discard("")
        if not clean:
            return set()
        # Captures use `_id` / `id` plus `orgId` (workflow tenant field).
        cursor = self._db["captures"].find(
            {
                "orgId": org_id,
                "$or": [
                    {"_id": {"$in": list(clean)}},
                    {"id": {"$in": list(clean)}},
                ],
            },
            {"_id": 1, "id": 1},
        )
        existing: set[str] = set()
        async for doc in cursor:
            existing.add(str(doc.get("id") or doc.get("_id") or ""))
        existing.discard("")
        return existing

    async def list_reports(
        self,
        org_id: str,
        *,
        user_id: str,
        role: str,
        project_id: str | None = None,
        pin_name: str | None = None,
        before_timeline_id: str | None = None,
        after_timeline_id: str | None = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        query: dict[str, Any] = {"org_id": org_id, "saved": True}

        if project_id:
            query["project_id"] = _sanitize_text(project_id, max_len=64)
        if pin_name:
            query["pin_name"] = _sanitize_text(pin_name)
        if before_timeline_id and after_timeline_id:
            query["before_timeline_id"] = _sanitize_text(before_timeline_id, max_len=64)
            query["after_timeline_id"] = _sanitize_text(after_timeline_id, max_len=64)

        # Fetch a wider window so we can drop orphans (deleted captures) and
        # still fill `limit` results. Orphans are deleted eagerly.
        fetch_limit = min(max(limit * 4, limit + skip), 200)
        cursor = (
            self._db[_COLLECTION_CACHE]
            .find(query)
            .sort([("saved_at", -1), ("created_at", -1)])
            .limit(fetch_limit)
        )
        docs = await cursor.to_list(length=fetch_limit)

        timeline_ids: set[str] = set()
        for doc in docs:
            timeline_ids.add(str(doc.get("before_timeline_id") or ""))
            timeline_ids.add(str(doc.get("after_timeline_id") or ""))
        timeline_ids.discard("")
        existing = await self._existing_capture_ids(org_id, timeline_ids)

        valid_docs: list[dict[str, Any]] = []
        orphan_ids: list[Any] = []
        for doc in docs:
            before_id = str(doc.get("before_timeline_id") or "")
            after_id = str(doc.get("after_timeline_id") or "")
            if before_id in existing and after_id in existing:
                valid_docs.append(doc)
            else:
                orphan_ids.append(doc["_id"])

        if orphan_ids:
            await self._db[_COLLECTION_CACHE].delete_many(
                {"_id": {"$in": orphan_ids}, "org_id": org_id}
            )
            logger.info(
                "Dropped {} orphaned progress report(s) with missing captures org_id={}",
                len(orphan_ids),
                org_id,
            )

        page = valid_docs[skip : skip + limit]
        enriched: list[dict[str, Any]] = []
        for doc in page:
            enriched.append(await self._ensure_report_metadata(org_id, doc))
        # Approximate total after orphan removal within the fetched window.
        total = len(valid_docs) if len(docs) < fetch_limit else max(len(valid_docs), skip + len(page))
        return [_serialize_report_summary(doc) for doc in enriched], total

    async def _ensure_report_metadata(
        self,
        org_id: str,
        doc: dict[str, Any],
    ) -> dict[str, Any]:
        """Backfill missing metadata on legacy cache rows from the matching job."""
        has_core = (
            doc.get("project_name")
            and doc.get("pin_name")
            and doc.get("before_date")
            and doc.get("before_image_url")
        )
        if has_core:
            return doc

        job = await self._db[_COLLECTION_JOBS].find_one(
            {
                "org_id": org_id,
                "before_timeline_id": doc.get("before_timeline_id"),
                "after_timeline_id": doc.get("after_timeline_id"),
                "status": _JOB_STATUS_COMPLETED,
            },
            sort=[("completed_at", -1)],
        )
        if not job:
            return doc

        metadata = _report_metadata_fields(
            user_id=str(job.get("requested_by") or doc.get("requested_by") or ""),
            project_id=str(job.get("project_id") or doc.get("project_id") or ""),
            project_name=str(job.get("project_name") or doc.get("project_name") or ""),
            tower=str(job.get("tower") or doc.get("tower") or ""),
            floor=str(job.get("floor") or doc.get("floor") or ""),
            pin_name=str(job.get("pin_name") or doc.get("pin_name") or ""),
            before_date=str(job.get("before_date") or doc.get("before_date") or ""),
            after_date=str(job.get("after_date") or doc.get("after_date") or ""),
            capture_type=str(job.get("capture_type") or doc.get("capture_type") or "360"),
            before_image_url=str(
                job.get("before_image_url") or job.get("before_image") or doc.get("before_image_url") or ""
            ),
            after_image_url=str(
                job.get("after_image_url") or job.get("after_image") or doc.get("after_image_url") or ""
            ),
            floor_plan_image_url=str(job.get("floor_plan_image_url") or doc.get("floor_plan_image_url") or ""),
            pin_x=job.get("pin_x", doc.get("pin_x")),
            pin_y=job.get("pin_y", doc.get("pin_y")),
        )
        await self._db[_COLLECTION_CACHE].update_one(
            {"_id": doc["_id"]},
            {"$set": metadata},
        )
        return {**doc, **metadata}

    async def get_report(
        self,
        org_id: str,
        report_id: str,
        *,
        user_id: str,
        role: str,
    ) -> dict[str, Any] | None:
        from bson import ObjectId

        oid = ObjectId(report_id) if ObjectId.is_valid(report_id) else report_id
        doc = await self._db[_COLLECTION_CACHE].find_one(
            {"_id": oid, "org_id": org_id, "saved": True},
        )
        if not doc:
            return None

        before_id = str(doc.get("before_timeline_id") or "")
        after_id = str(doc.get("after_timeline_id") or "")
        existing = await self._existing_capture_ids(org_id, {before_id, after_id})
        if before_id not in existing or after_id not in existing:
            # Source captures were deleted — drop the ghost report.
            await self._db[_COLLECTION_CACHE].delete_one({"_id": doc["_id"], "org_id": org_id})
            return None

        return _serialize_report_detail(doc)

    async def save_report(
        self,
        org_id: str,
        report_id: str,
        *,
        user_id: str,
        role: str,
    ) -> dict[str, Any]:
        """Mark an analysis as saved so it appears in Progress Reports."""
        from bson import ObjectId

        oid = ObjectId(report_id) if ObjectId.is_valid(report_id) else report_id
        doc = await self._db[_COLLECTION_CACHE].find_one({"_id": oid, "org_id": org_id})
        if not doc or not doc.get("analysis"):
            raise ValueError("Report not found")

        now = _utcnow()
        await self._db[_COLLECTION_CACHE].update_one(
            {"_id": oid, "org_id": org_id},
            {"$set": {"saved": True, "saved_at": now, "saved_by": _sanitize_text(user_id, max_len=64)}},
        )
        updated = await self._db[_COLLECTION_CACHE].find_one({"_id": oid, "org_id": org_id})
        if not updated or not updated.get("saved"):
            raise ValueError("Failed to save report")
        return _serialize_report_summary(updated)

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

    async def _write_progress_analysis_audit_log(
        self,
        *,
        job: dict[str, Any],
        result: Any,
        report_id: str | None,
    ) -> None:
        user_id = str(job.get("requested_by") or "")
        user_names = await self._resolve_user_names({user_id} if user_id else set())
        actor_name = user_names.get(user_id, "System")
        log_id = str(uuid.uuid4())
        now = _utcnow().isoformat()
        prompt = int(result.prompt_tokens or 0)
        completion = int(result.completion_tokens or 0)
        total = int(result.total_tokens or prompt + completion)
        project_name = str(job.get("project_name") or "")
        pin = str(job.get("pin_name") or "")

        doc = {
            "_id": log_id,
            "id": log_id,
            "orgId": job["org_id"],
            "org_id": job["org_id"],
            "actorId": user_id,
            "actorName": actor_name,
            "eventType": "progress_analysis_completed",
            "entityType": "report",
            "entityId": report_id or str(job.get("_id") or ""),
            "entityName": pin,
            "projectId": str(job.get("project_id") or ""),
            "description": (
                f"Progress analysis for {project_name or 'project'} — "
                f"{prompt:,} input / {completion:,} output / {total:,} total tokens"
            ),
            "promptTokens": prompt,
            "completionTokens": completion,
            "totalTokens": total,
            "model": result.model,
            "createdAt": now,
            "created_at": now,
            "updatedAt": now,
            "updated_at": now,
        }
        await self._db["audit_logs"].insert_one(doc)

        await LLMUsageService(self._db).record_usage(
            org_id=job["org_id"],
            source="progress_analysis",
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.total_tokens,
            latency_ms=result.latency_ms,
            project_id=str(job.get("project_id") or ""),
            project_name=project_name,
            tower=str(job.get("tower") or ""),
            floor=str(job.get("floor") or ""),
            pin_name=pin,
            requested_by=user_id or None,
            entity_id=report_id or str(job.get("_id") or ""),
        )

    async def get_job_enriched(self, org_id: str, job_id: str) -> dict[str, Any] | None:
        job = await self.get_job(org_id, job_id)
        if not job:
            return None
        if job.get("analysis"):
            job["analysis"] = _normalize_analysis(job.get("analysis") or {})
        if job.get("status") == _JOB_STATUS_COMPLETED:
            cache = await self._get_cached_doc(
                org_id,
                str(job.get("before_timeline_id") or ""),
                str(job.get("after_timeline_id") or ""),
            )
            if cache:
                job["reportId"] = str(cache["_id"])
                job["saved"] = bool(cache.get("saved"))
                if cache.get("analysis") and not job.get("analysis"):
                    job["analysis"] = _normalize_analysis(cache.get("analysis") or {})
            elif job.get("report_id"):
                job["reportId"] = str(job["report_id"])
        return job

    async def _run_job(self, job_id: str) -> None:
        jobs = self._db[_COLLECTION_JOBS]
        job = await jobs.find_one({"_id": job_id})
        if not job:
            return

        await jobs.update_one(
            {"_id": job_id},
            {"$set": {"status": _JOB_STATUS_PROCESSING}},
        )

        try:
            before_bytes, before_mime = await download_image(
                job["before_image"],
                timeout=self._timeout,
            )
            after_bytes, after_mime = await download_image(
                job["after_image"],
                timeout=self._timeout,
            )

            before_bytes = resize_if_needed(before_bytes)
            after_bytes = resize_if_needed(after_bytes)

            before_b64 = base64.b64encode(before_bytes).decode("ascii")
            after_b64 = base64.b64encode(after_bytes).decode("ascii")

            context = {
                "project_name": job.get("project_name", ""),
                "tower": job.get("tower", ""),
                "floor": job.get("floor", ""),
                "pin_name": job.get("pin_name", ""),
                "capture_type": job.get("capture_type", "360"),
                "before_date": job.get("before_date", ""),
                "after_date": job.get("after_date", ""),
            }

            result = await self._provider.analyze_construction_progress(
                before_image_b64=before_b64,
                after_image_b64=after_b64,
                before_mime=before_mime,
                after_mime=after_mime,
                context=context,
            )

            analysis = _normalize_analysis(result.content if isinstance(result.content, dict) else {})
            completed_at = _utcnow()

            cache_doc = {
                "org_id": job["org_id"],
                **_report_metadata_fields(
                    user_id=str(job.get("requested_by") or ""),
                    project_id=str(job.get("project_id") or ""),
                    project_name=str(job.get("project_name") or ""),
                    tower=str(job.get("tower") or ""),
                    floor=str(job.get("floor") or ""),
                    pin_name=str(job.get("pin_name") or ""),
                    before_date=str(job.get("before_date") or ""),
                    after_date=str(job.get("after_date") or ""),
                    capture_type=str(job.get("capture_type") or "360"),
                    before_image_url=str(job.get("before_image_url") or job.get("before_image") or ""),
                    after_image_url=str(job.get("after_image_url") or job.get("after_image") or ""),
                    floor_plan_image_url=str(job.get("floor_plan_image_url") or ""),
                    pin_x=job.get("pin_x"),
                    pin_y=job.get("pin_y"),
                ),
                "before_timeline_id": job["before_timeline_id"],
                "after_timeline_id": job["after_timeline_id"],
                "analysis": analysis,
                "prompt_version": COMPARE_ANALYSIS_PROMPT_VERSION,
                "model": result.model,
                "latency_ms": result.latency_ms,
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "total_tokens": result.total_tokens,
                "created_at": completed_at,
            }
            await self._db[_COLLECTION_CACHE].update_one(
                {
                    "org_id": job["org_id"],
                    "before_timeline_id": job["before_timeline_id"],
                    "after_timeline_id": job["after_timeline_id"],
                },
                {"$set": cache_doc, "$setOnInsert": {"saved": False}},
                upsert=True,
            )

            cache_after = await self._get_cached_doc(
                job["org_id"],
                str(job.get("before_timeline_id") or ""),
                str(job.get("after_timeline_id") or ""),
            )
            report_id = str(cache_after["_id"]) if cache_after else None

            await jobs.update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": _JOB_STATUS_COMPLETED,
                        "analysis": analysis,
                        "model": result.model,
                        "latency_ms": result.latency_ms,
                        "prompt_tokens": result.prompt_tokens,
                        "completion_tokens": result.completion_tokens,
                        "total_tokens": result.total_tokens,
                        "completed_at": completed_at,
                        "error": None,
                        "report_id": report_id,
                    }
                },
            )
            await self._write_progress_analysis_audit_log(
                job=job,
                result=result,
                report_id=report_id,
            )
        except Exception as exc:
            logger.exception("Progress analysis job {} failed: {}", job_id, exc)
            await jobs.update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": _JOB_STATUS_FAILED,
                        "error": str(exc)[:500],
                        "completed_at": _utcnow(),
                    }
                },
            )


def _flatten_list_entry(item: Any) -> str | None:
    """Convert a list item to display text; Groq sometimes returns objects instead of strings."""
    if item is None:
        return None
    if isinstance(item, str):
        text = item.strip()
        return text or None
    if isinstance(item, dict):
        for key in (
            "observation",
            "change",
            "description",
            "text",
            "item",
            "risk",
            "step",
            "work",
            "title",
            "note",
            "recommendation",
        ):
            val = item.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        return None
    text = str(item).strip()
    return text or None


def _clamp_pct(value: Any, default: int = 0) -> int:
    try:
        return max(0, min(100, int(float(value))))
    except (TypeError, ValueError):
        return default


_ALLOWED_CHANGE_TYPES = {
    "completed",
    "partially_completed",
    "installed",
    "added",
    "removed",
    "modified",
    "relocated",
    "damaged",
    "unchanged",
    "unable_to_confirm",
}

_ALLOWED_VIEW = {"good", "fair", "poor"}
_ALLOWED_IMPACT = {"High", "Medium", "Low"}


def _normalize_comparison(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    view = str(raw.get("viewConsistency") or raw.get("view_consistency") or "fair").lower()
    if view not in _ALLOWED_VIEW:
        view = "fair"
    visibility = str(raw.get("visibility") or "fair").lower()
    if visibility not in _ALLOWED_VIEW:
        visibility = "fair"
    same = raw.get("sameLocation", raw.get("same_location", True))
    return {
        "sameLocation": bool(same) if not isinstance(same, str) else same.strip().lower() in {"1", "true", "yes"},
        "viewConsistency": view,
        "visibility": visibility,
        "comparisonConfidence": _clamp_pct(
            raw.get("comparisonConfidence", raw.get("comparison_confidence", 0))
        ),
    }


def _change_to_legacy(change: dict[str, Any]) -> dict[str, str]:
    impact = str(change.get("impact") or "Medium")
    if impact not in _ALLOWED_IMPACT:
        impact = "Medium"
    before = str(change.get("beforeState") or "").strip()
    after = str(change.get("afterState") or "").strip()
    change_type = str(change.get("changeType") or "").strip()
    area = str(change.get("area") or "").strip()
    parts: list[str] = []
    if area:
        parts.append(f"{area}:")
    if before and after:
        parts.append(f"{before} → {after}")
    elif after:
        parts.append(after)
    elif before:
        parts.append(before)
    if change_type and change_type != "unable_to_confirm":
        parts.append(f"({change_type.replace('_', ' ')})")
    text = " ".join(parts).strip() or str(change.get("change") or change.get("description") or "").strip()
    return {
        "category": str(change.get("category") or "General") or "General",
        "change": text,
        "importance": impact,
    }


def _normalize_structured_change(item: Any) -> dict[str, Any] | None:
    if isinstance(item, str):
        text = item.strip()
        if not text:
            return None
        return {
            "category": "General",
            "area": "",
            "changeType": "modified",
            "beforeState": "",
            "afterState": text,
            "impact": "Medium",
            "confidence": 50,
        }
    if not isinstance(item, dict):
        return None

    # Legacy changesDetected row
    if "change" in item and "beforeState" not in item and "before_state" not in item:
        change_text = str(
            item.get("change") or item.get("observation") or item.get("description") or ""
        ).strip()
        if not change_text:
            return None
        impact = str(item.get("importance") or item.get("impact") or "Medium")
        if impact not in _ALLOWED_IMPACT:
            impact = "Medium"
        return {
            "category": str(item.get("category") or "General") or "General",
            "area": str(item.get("area") or "").strip(),
            "changeType": "modified",
            "beforeState": "",
            "afterState": change_text,
            "impact": impact,
            "confidence": _clamp_pct(item.get("confidence", 60), 60),
        }

    change_type = str(item.get("changeType") or item.get("change_type") or "modified").strip().lower()
    if change_type not in _ALLOWED_CHANGE_TYPES:
        change_type = "modified"
    impact = str(item.get("impact") or item.get("importance") or "Medium")
    if impact not in _ALLOWED_IMPACT:
        impact = "Medium"
    before = str(item.get("beforeState") or item.get("before_state") or "").strip()
    after = str(item.get("afterState") or item.get("after_state") or "").strip()
    category = str(item.get("category") or "General").strip() or "General"
    area = str(item.get("area") or "").strip()
    if not before and not after and not area:
        # Nothing useful
        flat = _flatten_list_entry(item)
        if not flat:
            return None
        after = flat
    return {
        "category": category,
        "area": area,
        "changeType": change_type,
        "beforeState": before,
        "afterState": after,
        "impact": impact,
        "confidence": _clamp_pct(item.get("confidence", 50), 50),
    }


def _normalize_analysis(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Ensure the analysis dict conforms to the expected schema (new + legacy fields)."""
    if not isinstance(raw, dict):
        raw = {}

    # Prefer new `progress`; fall back to legacy `overallProgress`.
    progress_raw = raw.get("progress")
    if not isinstance(progress_raw, dict):
        progress_raw = raw.get("overallProgress") or {}
    if not isinstance(progress_raw, dict):
        progress_raw = {}

    percentage = _clamp_pct(progress_raw.get("percentage", 0))
    description = str(progress_raw.get("description", "") or "")

    confidence = _clamp_pct(raw.get("confidence", 0))
    comparison = _normalize_comparison(raw.get("comparison"))

    def _as_str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        for item in value:
            text = _flatten_list_entry(item)
            if text:
                out.append(text)
        return out

    structured: list[dict[str, Any]] = []
    # Prefer new `changes`; fall back to legacy `changesDetected`.
    source_changes = raw.get("changes")
    if not isinstance(source_changes, list) or not source_changes:
        source_changes = raw.get("changesDetected") or []
    if isinstance(source_changes, list):
        for item in source_changes:
            normalized = _normalize_structured_change(item)
            if normalized:
                structured.append(normalized)

    legacy_changes = [_change_to_legacy(c) for c in structured]

    progress = {"percentage": percentage, "description": description}
    return {
        "summary": str(raw.get("summary", "") or ""),
        "comparison": comparison,
        "progress": progress,
        # Legacy alias — existing clients / PDF / library summaries.
        "overallProgress": progress,
        "changes": structured,
        "changesDetected": legacy_changes,
        "completedWork": _as_str_list(raw.get("completedWork")),
        "newlyAdded": _as_str_list(raw.get("newlyAdded")),
        "removedItems": _as_str_list(raw.get("removedItems")),
        "pendingWork": _as_str_list(raw.get("pendingWork")),
        "qualityObservations": _as_str_list(raw.get("qualityObservations")),
        "risks": _as_str_list(raw.get("risks")),
        "recommendedNextSteps": _as_str_list(raw.get("recommendedNextSteps")),
        "confidence": confidence,
    }


def _report_metadata_fields(
    *,
    user_id: str,
    project_id: str,
    project_name: str,
    tower: str,
    floor: str,
    pin_name: str,
    before_date: str,
    after_date: str,
    capture_type: str,
    before_image_url: str = "",
    after_image_url: str = "",
    floor_plan_image_url: str = "",
    pin_x: float | None = None,
    pin_y: float | None = None,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "requested_by": _sanitize_text(user_id, max_len=64),
        "project_id": _sanitize_text(project_id, max_len=64),
        "project_name": _sanitize_text(project_name),
        "tower": _sanitize_text(tower),
        "floor": _sanitize_text(floor),
        "pin_name": _sanitize_text(pin_name),
        "before_date": _sanitize_text(before_date),
        "after_date": _sanitize_text(after_date),
        "capture_type": _sanitize_text(capture_type, max_len=32) or "360",
        "before_image_url": _sanitize_text(before_image_url, max_len=2048),
        "after_image_url": _sanitize_text(after_image_url, max_len=2048),
        "floor_plan_image_url": _sanitize_text(floor_plan_image_url, max_len=2048),
    }
    if pin_x is not None:
        fields["pin_x"] = max(0.0, min(100.0, float(pin_x)))
    if pin_y is not None:
        fields["pin_y"] = max(0.0, min(100.0, float(pin_y)))
    return fields


def _serialize_report_summary(doc: dict[str, Any]) -> dict[str, Any]:
    analysis = _normalize_analysis(doc.get("analysis") or {})
    progress = analysis.get("progress") or analysis.get("overallProgress") or {}
    return {
        "reportId": str(doc["_id"]),
        "beforeTimelineId": doc.get("before_timeline_id", ""),
        "afterTimelineId": doc.get("after_timeline_id", ""),
        "projectId": doc.get("project_id", "") or "",
        "projectName": doc.get("project_name", ""),
        "tower": doc.get("tower", ""),
        "floor": doc.get("floor", ""),
        "pinName": doc.get("pin_name", ""),
        "beforeDate": doc.get("before_date", ""),
        "afterDate": doc.get("after_date", ""),
        "captureType": doc.get("capture_type", "360"),
        "summary": analysis.get("summary", ""),
        "overallProgressPercentage": int(progress.get("percentage") or 0),
        "confidence": int(analysis.get("confidence") or 0),
        "createdAt": doc.get("created_at"),
        "savedAt": doc.get("saved_at"),
        "beforeImageUrl": doc.get("before_image_url") or doc.get("before_image") or "",
        "afterImageUrl": doc.get("after_image_url") or doc.get("after_image") or "",
        "floorPlanImageUrl": doc.get("floor_plan_image_url") or "",
        "pinX": doc.get("pin_x"),
        "pinY": doc.get("pin_y"),
        "saved": bool(doc.get("saved")),
        "promptVersion": doc.get("prompt_version") or None,
    }


def _serialize_report_detail(doc: dict[str, Any]) -> dict[str, Any]:
    summary = _serialize_report_summary(doc)
    summary["analysis"] = _normalize_analysis(doc.get("analysis") or {})
    summary["model"] = doc.get("model")
    summary["latencyMs"] = doc.get("latency_ms")
    summary["promptTokens"] = doc.get("prompt_tokens")
    summary["completionTokens"] = doc.get("completion_tokens")
    summary["totalTokens"] = doc.get("total_tokens")
    summary["requestedBy"] = doc.get("requested_by")
    return summary
