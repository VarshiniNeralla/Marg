"""
Background construction-progress analyze jobs.

Floor re-analysis routinely takes several minutes (room-map + many vision LLM
calls). Doing that inside the HTTP request meant Cloudflare tunnel / browser
timeouts aborted the POST, which cancelled the asyncio coroutine mid-run and
left no new snapshot — while the UI polled forever for a snapshotId that never
arrived.

Same pattern as capture_stitch_service / ai_progress_service: enqueue a Mongo
job, run work in a fire-and-forget task, client polls until completed/failed.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_service import ConstructionProgressService

COLLECTION_JOBS = "construction_progress_analyze_jobs"

JOB_STATUS_PENDING = "pending"
JOB_STATUS_PROCESSING = "processing"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"

_ACTIVE_STATUSES = (JOB_STATUS_PENDING, JOB_STATUS_PROCESSING)
# Hung worker / killed process — free the floor so a new analyze can start.
_STALE_AFTER = timedelta(minutes=45)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_job(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "jobId": str(doc["_id"]),
        "floorId": doc.get("floorId", ""),
        "status": doc.get("status", JOB_STATUS_PENDING),
        "snapshotId": doc.get("snapshotId"),
        "error": doc.get("error"),
        "createdAt": doc.get("createdAt"),
        "startedAt": doc.get("startedAt"),
        "completedAt": doc.get("completedAt"),
        "updatedAt": doc.get("updatedAt"),
    }


class ConstructionProgressAnalyzeJobService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    async def start_analyze(
        self,
        *,
        org_id: str,
        floor_id: str,
        analyzed_by: str | None,
    ) -> dict[str, Any]:
        await self._fail_stale_jobs(org_id=org_id, floor_id=floor_id)

        existing = await self._db[COLLECTION_JOBS].find_one(
            {
                "orgId": org_id,
                "floorId": floor_id,
                "status": {"$in": list(_ACTIVE_STATUSES)},
            },
            sort=[("createdAt", -1)],
        )
        if existing:
            logger.info(
                "[cp-analyze-job] joining in-flight job={} floor={}",
                existing["_id"],
                floor_id,
            )
            return _serialize_job(existing)

        job_id = str(uuid.uuid4())
        now = _utcnow()
        await self._db[COLLECTION_JOBS].insert_one(
            {
                "_id": job_id,
                "orgId": org_id,
                "floorId": floor_id,
                "analyzedBy": analyzed_by,
                "status": JOB_STATUS_PENDING,
                "snapshotId": None,
                "error": None,
                "createdAt": now,
                "startedAt": None,
                "completedAt": None,
                "updatedAt": now,
                "heartbeatAt": now,
            }
        )
        logger.info("[cp-analyze-job] queued job={} floor={}", job_id, floor_id)
        self._dispatch(job_id)
        return _serialize_job(
            {
                "_id": job_id,
                "floorId": floor_id,
                "status": JOB_STATUS_PENDING,
                "snapshotId": None,
                "error": None,
                "createdAt": now,
                "startedAt": None,
                "completedAt": None,
                "updatedAt": now,
            }
        )

    async def get_job(self, *, org_id: str, job_id: str) -> Optional[dict[str, Any]]:
        doc = await self._db[COLLECTION_JOBS].find_one({"_id": job_id, "orgId": org_id})
        return _serialize_job(doc) if doc else None

    async def get_active_job_for_floor(
        self, *, org_id: str, floor_id: str,
    ) -> Optional[dict[str, Any]]:
        await self._fail_stale_jobs(org_id=org_id, floor_id=floor_id)
        doc = await self._db[COLLECTION_JOBS].find_one(
            {
                "orgId": org_id,
                "floorId": floor_id,
                "status": {"$in": list(_ACTIVE_STATUSES)},
            },
            sort=[("createdAt", -1)],
        )
        return _serialize_job(doc) if doc else None

    def _dispatch(self, job_id: str) -> None:
        asyncio.create_task(self._run_job(job_id))

    async def _run_job(self, job_id: str) -> None:
        claimed = await self._db[COLLECTION_JOBS].find_one_and_update(
            {"_id": job_id, "status": JOB_STATUS_PENDING},
            {
                "$set": {
                    "status": JOB_STATUS_PROCESSING,
                    "startedAt": _utcnow(),
                    "updatedAt": _utcnow(),
                    "heartbeatAt": _utcnow(),
                }
            },
        )
        if not claimed:
            return

        org_id = claimed["orgId"]
        floor_id = claimed["floorId"]
        analyzed_by = claimed.get("analyzedBy")

        async def _heartbeat_loop() -> None:
            while True:
                await asyncio.sleep(30)
                try:
                    await self._db[COLLECTION_JOBS].update_one(
                        {"_id": job_id, "status": JOB_STATUS_PROCESSING},
                        {"$set": {"heartbeatAt": _utcnow(), "updatedAt": _utcnow()}},
                    )
                except Exception as exc:
                    logger.warning("[cp-analyze-job] heartbeat failed job={}: {!r}", job_id, exc)
                    return

        heartbeat_task = asyncio.create_task(_heartbeat_loop())
        try:
            service = ConstructionProgressService(self._db)
            snapshot = await service.analyze_floor(
                org_id, floor_id, analyzed_by=analyzed_by,
            )
            snapshot_id = snapshot.get("snapshotId") if isinstance(snapshot, dict) else None
            now = _utcnow()
            await self._db[COLLECTION_JOBS].update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": JOB_STATUS_COMPLETED,
                        "snapshotId": snapshot_id,
                        "completedAt": now,
                        "updatedAt": now,
                        "heartbeatAt": now,
                        "error": None,
                    }
                },
            )
            logger.info(
                "[cp-analyze-job] completed job={} floor={} snapshot={}",
                job_id, floor_id, snapshot_id,
            )
        except Exception as exc:
            logger.exception("[cp-analyze-job] failed job={} floor={}", job_id, floor_id)
            await self._mark_failed(job_id, str(exc)[:500])
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    async def _mark_failed(self, job_id: str, error: str) -> None:
        now = _utcnow()
        try:
            await self._db[COLLECTION_JOBS].update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": JOB_STATUS_FAILED,
                        "error": error,
                        "completedAt": now,
                        "updatedAt": now,
                        "heartbeatAt": now,
                    }
                },
            )
        except Exception as exc:
            logger.warning("[cp-analyze-job] could not mark job={} failed: {!r}", job_id, exc)

    async def _fail_stale_jobs(self, *, org_id: str, floor_id: str) -> None:
        cutoff = _utcnow() - _STALE_AFTER
        result = await self._db[COLLECTION_JOBS].update_many(
            {
                "orgId": org_id,
                "floorId": floor_id,
                "status": {"$in": list(_ACTIVE_STATUSES)},
                "heartbeatAt": {"$lt": cutoff},
            },
            {
                "$set": {
                    "status": JOB_STATUS_FAILED,
                    "error": "Analysis timed out (no progress heartbeat). Please try again.",
                    "completedAt": _utcnow(),
                    "updatedAt": _utcnow(),
                }
            },
        )
        if result.modified_count:
            logger.warning(
                "[cp-analyze-job] marked {} stale job(s) failed floor={}",
                result.modified_count,
                floor_id,
            )
