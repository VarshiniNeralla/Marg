from __future__ import annotations

import asyncio
import base64
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from PIL import Image

from app.core.config import Settings, get_settings
from app.repositories.user_project import UserProjectRepository
from app.services.vision_providers.base import VisionProvider
from app.services.vision_providers.groq_provider import GroqVisionProvider

# Groq base64 image limit is ~4 MB per image; keep headroom for two images in one request.
_MAX_IMAGE_BYTES = 1_800_000
_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
_ALLOWED_IMAGE_HOSTS = (
    "res.cloudinary.com",
    "cloudinary.com",
)
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


def validate_image_url(url: str, *, settings: Settings | None = None) -> str:
    """Validate and return a safe HTTPS image URL."""
    settings = settings or get_settings()
    parsed = urlparse((url or "").strip())

    if parsed.scheme != "https":
        raise ValueError("Image URL must use HTTPS")

    host = (parsed.hostname or "").lower()
    allowed_hosts = set(_ALLOWED_IMAGE_HOSTS)
    cloud_name = (settings.CLOUDINARY_CLOUD_NAME or "").strip().lower()
    if cloud_name:
        allowed_hosts.add(f"{cloud_name}.cloudinary.com")

    if not any(host == h or host.endswith(f".{h}") for h in allowed_hosts):
        raise ValueError("Image URL must be from an allowed Cloudinary host")

    if not parsed.path or parsed.path == "/":
        raise ValueError("Image URL path is invalid")

    return url.strip()


def get_vision_provider(provider_name: str | None = None) -> VisionProvider:
    """Factory for vision providers — swap implementation with minimal changes."""
    name = (provider_name or "groq").lower()
    if name == "groq":
        return GroqVisionProvider()
    if name == "openai":
        from app.services.vision_providers.openai_provider import OpenAIVisionProvider
        return OpenAIVisionProvider()
    if name == "gemini":
        from app.services.vision_providers.gemini_provider import GeminiVisionProvider
        return GeminiVisionProvider()
    raise ValueError(f"Unknown vision provider: {provider_name}")


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
        self._provider = provider or get_vision_provider(self._settings.VISION_PROVIDER)
        self._timeout = float(self._settings.GROQ_REQUEST_TIMEOUT_SECONDS)

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
            if cached_before == before_url and cached_after == after_url:
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
                    "Progress analysis cache hit org={} before={} after={}",
                    org_id,
                    before_timeline_id,
                    after_timeline_id,
                )
                return {
                    "status": _JOB_STATUS_COMPLETED,
                    "jobId": None,
                    "reportId": str(cached_doc["_id"]),
                    "saved": bool(cached_doc.get("saved")),
                    "cached": True,
                    "analysis": cached_doc["analysis"],
                }

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

        if role == "manager" and project_id:
            repo = UserProjectRepository(self._db)
            accessible = await repo.get_accessible_project_ids(user_id, org_id)
            if project_id not in accessible:
                return [], 0

        total = await self._db[_COLLECTION_CACHE].count_documents(query)
        cursor = (
            self._db[_COLLECTION_CACHE]
            .find(query)
            .sort([("saved_at", -1), ("created_at", -1)])
            .skip(skip)
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)
        enriched: list[dict[str, Any]] = []
        for doc in docs:
            enriched.append(await self._ensure_report_metadata(org_id, doc))
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

        return _serialize_report_detail(doc)

    async def save_report(self, org_id: str, report_id: str, *, user_id: str) -> dict[str, Any]:
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

    async def get_job_enriched(self, org_id: str, job_id: str) -> dict[str, Any] | None:
        job = await self.get_job(org_id, job_id)
        if not job:
            return None
        if job.get("status") == _JOB_STATUS_COMPLETED:
            cache = await self._get_cached_doc(
                org_id,
                str(job.get("before_timeline_id") or ""),
                str(job.get("after_timeline_id") or ""),
            )
            if cache:
                job["reportId"] = str(cache["_id"])
                job["saved"] = bool(cache.get("saved"))
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
            before_bytes, before_mime = await _download_image(
                job["before_image"],
                timeout=self._timeout,
            )
            after_bytes, after_mime = await _download_image(
                job["after_image"],
                timeout=self._timeout,
            )

            before_bytes = _resize_if_needed(before_bytes)
            after_bytes = _resize_if_needed(after_bytes)

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

            analysis = _normalize_analysis(result.content)
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
                "model": result.model,
                "latency_ms": result.latency_ms,
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
                        "total_tokens": result.total_tokens,
                        "completed_at": completed_at,
                        "error": None,
                        "report_id": report_id,
                    }
                },
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


async def _download_image(url: str, *, timeout: float) -> tuple[bytes, str]:
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=4),
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            content_type = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
            if not content_type.startswith("image/"):
                raise ValueError(f"URL did not return an image (content-type={content_type})")

            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > _MAX_DOWNLOAD_BYTES:
                    raise ValueError("Image download exceeds maximum allowed size")
                chunks.append(chunk)

    return b"".join(chunks), content_type


def _resize_if_needed(image_bytes: bytes) -> bytes:
    if len(image_bytes) <= _MAX_IMAGE_BYTES:
        return image_bytes

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    quality = 85
    scale = 1.0
    current = img

    for _ in range(12):
        if scale < 1.0:
            w, h = current.size
            current = current.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )

        buf = io.BytesIO()
        current.save(buf, format="JPEG", quality=quality, optimize=True)
        result = buf.getvalue()

        if len(result) <= _MAX_IMAGE_BYTES:
            return result

        quality = max(50, quality - 8)
        scale = max(0.35, scale - 0.1)

    return result


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


def _normalize_analysis(raw: dict[str, Any]) -> dict[str, Any]:
    """Ensure the analysis dict conforms to the expected schema."""
    overall = raw.get("overallProgress") or {}
    if not isinstance(overall, dict):
        overall = {}

    percentage = overall.get("percentage", 0)
    try:
        percentage = max(0, min(100, int(percentage)))
    except (TypeError, ValueError):
        percentage = 0

    confidence = raw.get("confidence", 0)
    try:
        confidence = max(0, min(100, int(confidence)))
    except (TypeError, ValueError):
        confidence = 0

    def _as_str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        for item in value:
            text = _flatten_list_entry(item)
            if text:
                out.append(text)
        return out

    changes = raw.get("changesDetected") or []
    normalized_changes: list[dict[str, str]] = []
    if isinstance(changes, list):
        for item in changes:
            if not isinstance(item, dict):
                flat = _flatten_list_entry(item)
                if flat:
                    normalized_changes.append({
                        "category": "General",
                        "change": flat,
                        "importance": "Medium",
                    })
                continue
            importance = str(item.get("importance", "Medium"))
            if importance not in {"High", "Medium", "Low"}:
                importance = "Medium"
            change_text = str(
                item.get("change")
                or item.get("observation")
                or item.get("description")
                or ""
            ).strip()
            if not change_text:
                continue
            normalized_changes.append({
                "category": str(item.get("category", "General") or "General"),
                "change": change_text,
                "importance": importance,
            })

    return {
        "summary": str(raw.get("summary", "")),
        "overallProgress": {
            "percentage": percentage,
            "description": str(overall.get("description", "")),
        },
        "changesDetected": normalized_changes,
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
    analysis = doc.get("analysis") or {}
    overall = analysis.get("overallProgress") or {}
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
        "overallProgressPercentage": int(overall.get("percentage") or 0),
        "confidence": int(analysis.get("confidence") or 0),
        "createdAt": doc.get("created_at"),
        "savedAt": doc.get("saved_at"),
        "beforeImageUrl": doc.get("before_image_url") or doc.get("before_image") or "",
        "afterImageUrl": doc.get("after_image_url") or doc.get("after_image") or "",
        "floorPlanImageUrl": doc.get("floor_plan_image_url") or "",
        "pinX": doc.get("pin_x"),
        "pinY": doc.get("pin_y"),
        "saved": bool(doc.get("saved")),
    }


def _serialize_report_detail(doc: dict[str, Any]) -> dict[str, Any]:
    summary = _serialize_report_summary(doc)
    summary["analysis"] = doc.get("analysis") or {}
    summary["model"] = doc.get("model")
    summary["latencyMs"] = doc.get("latency_ms")
    summary["totalTokens"] = doc.get("total_tokens")
    summary["requestedBy"] = doc.get("requested_by")
    return summary
