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

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_service import ConstructionProgressService

COLLECTION_JOBS = "construction_progress_analyze_jobs"
COLLECTION_NOTIFICATIONS = "notifications"
COLLECTION_USERS = "users"

# Notification types the frontend NotificationCenter knows how to render.
NOTIF_COMPLETE = "progress_analysis_complete"
NOTIF_FAILED = "progress_analysis_failed"
# Roles that are told about every background analysis in their organisation.
_ADMIN_ROLES = ("admin", "super_admin")

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
        "runInBackground": bool(doc.get("runInBackground")),
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
        background: bool = False,
    ) -> dict[str, Any]:
        """Queue (or join) an analysis. With ``background=True`` the requester and
        the organisation's admins get an in-app notification when it finishes."""
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
            if background and not existing.get("runInBackground"):
                # Someone joining a running job asked for a notification: honour it.
                await self._db[COLLECTION_JOBS].update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"runInBackground": True, "updatedAt": _utcnow()}},
                )
                existing["runInBackground"] = True
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
                # Background mode: notify when done. notifiedAt makes that exactly-once.
                "runInBackground": bool(background),
                "notifiedAt": None,
                "floorLabel": None,
                "overallProgressPct": None,
            }
        )
        logger.info("[cp-analyze-job] queued job={} floor={} background={}", job_id, floor_id, background)
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
                "runInBackground": bool(background),
            }
        )

    async def mark_background(
        self, *, org_id: str, floor_id: str, job_id: str,
    ) -> Optional[dict[str, Any]]:
        """Switch a job that is already running in the foreground to background mode
        ("Continue in background"). If it has already finished, notify straight away."""
        doc = await self._db[COLLECTION_JOBS].find_one(
            {"_id": job_id, "orgId": org_id, "floorId": floor_id},
        )
        if not doc:
            return None
        await self._db[COLLECTION_JOBS].update_one(
            {"_id": job_id}, {"$set": {"runInBackground": True, "updatedAt": _utcnow()}},
        )
        doc["runInBackground"] = True
        if doc.get("status") in (JOB_STATUS_COMPLETED, JOB_STATUS_FAILED):
            await self._notify_if_requested(job_id)
        return _serialize_job(doc)

    async def recover_orphaned_jobs(self) -> None:
        """Re-dispatch analyses that were running when the process restarted (for
        example during a deploy). The work is re-runnable from the floor id alone and
        only writes its snapshot at the very end, so starting over is safe."""
        try:
            orphans = await self._db[COLLECTION_JOBS].find(
                {"status": {"$in": list(_ACTIVE_STATUSES)}}
            ).to_list(length=200)
        except Exception as exc:
            logger.warning("[cp-analyze-job] orphan recovery query failed: {!r}", exc)
            return
        for job in orphans:
            job_id = str(job["_id"])
            now = _utcnow()
            await self._db[COLLECTION_JOBS].update_one(
                {"_id": job["_id"]},
                {"$set": {
                    "status": JOB_STATUS_PENDING,
                    "startedAt": None,
                    "heartbeatAt": now,
                    "updatedAt": now,
                }},
            )
            logger.info("[cp-analyze-job] re-dispatching orphaned job={} after restart", job_id)
            self._dispatch(job_id)

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
            snap = snapshot if isinstance(snapshot, dict) else {}
            label = " · ".join(
                str(p) for p in (snap.get("projectName"), snap.get("towerName"), snap.get("floorName")) if p
            ) or None
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
                        # Kept on the job so a late "continue in background" can still notify.
                        "floorLabel": label,
                        "overallProgressPct": snap.get("overallProgressPct"),
                    }
                },
            )
            logger.info(
                "[cp-analyze-job] completed job={} floor={} snapshot={}",
                job_id, floor_id, snapshot_id,
            )
            await self._notify_if_requested(job_id)
        except Exception as exc:
            logger.exception("[cp-analyze-job] failed job={} floor={}", job_id, floor_id)
            await self._mark_failed(job_id, str(exc)[:500])
            await self._notify_if_requested(job_id)
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

    async def _notify_if_requested(self, job_id: str) -> None:
        """Write the "analysis finished" notifications, at most once per job and only
        for jobs started in background mode. Never raises: a notification problem must
        not turn a finished analysis into a failed one."""
        try:
            job = await self._db[COLLECTION_JOBS].find_one_and_update(
                {
                    "_id": job_id,
                    "runInBackground": True,
                    "notifiedAt": None,
                    "status": {"$in": [JOB_STATUS_COMPLETED, JOB_STATUS_FAILED]},
                },
                {"$set": {"notifiedAt": _utcnow()}},
            )
            if not job:
                return
            org_id = job["orgId"]
            floor_id = job["floorId"]
            ok = job.get("status") == JOB_STATUS_COMPLETED
            label = job.get("floorLabel") or await self._floor_label(org_id, floor_id)
            if ok:
                pct = job.get("overallProgressPct")
                pct_text = f" ({round(float(pct))}% complete)" if isinstance(pct, (int, float)) else ""
                ntype = NOTIF_COMPLETE
                title = "Progress analysis ready for review"
                body = f"The construction progress analysis for {label} is complete{pct_text}. Open the report to review it."
            else:
                ntype = NOTIF_FAILED
                title = "Progress analysis failed"
                body = f"The construction progress analysis for {label} could not be completed. Open the floor to try again."

            recipients = await self._recipient_ids(org_id, job.get("analyzedBy"))
            now = _utcnow()
            docs = []
            for uid in recipients:
                nid = str(uuid.uuid4())
                docs.append({
                    "_id": nid, "id": nid,
                    "orgId": org_id, "org_id": org_id,
                    # The notification endpoints match on any of these four owner fields.
                    "recipientUserId": uid, "recipient_user_id": uid, "userId": uid, "user_id": uid,
                    "type": ntype, "title": title, "body": body,
                    "link": f"/construction-progress/{floor_id}",
                    "read": False,
                    "createdAt": now, "created_at": now, "updatedAt": now, "updated_at": now,
                })
            if docs:
                await self._db[COLLECTION_NOTIFICATIONS].insert_many(docs)
            logger.info("[cp-analyze-job] notified {} user(s) job={} type={}", len(docs), job_id, ntype)
        except Exception as exc:
            logger.warning("[cp-analyze-job] could not notify for job={}: {!r}", job_id, exc)

    async def _recipient_ids(self, org_id: str, analyzed_by: str | None) -> list[str]:
        """The user who started the analysis plus every active admin in the organisation."""
        ids: list[str] = []
        if analyzed_by:
            ids.append(str(analyzed_by))
        try:
            org_filter: Any = ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id
            cursor = self._db[COLLECTION_USERS].find(
                {"org_id": {"$in": [org_filter, str(org_id)]}, "role": {"$in": list(_ADMIN_ROLES)}, "is_active": {"$ne": False}},
                {"_id": 1},
            )
            async for user in cursor:
                uid = str(user["_id"])
                if uid not in ids:
                    ids.append(uid)
        except Exception as exc:
            logger.warning("[cp-analyze-job] could not look up admins org={}: {!r}", org_id, exc)
        return ids

    async def _floor_label(self, org_id: str, floor_id: str) -> str:
        try:
            floor = await self._db["floors"].find_one({"_id": floor_id, "orgId": org_id}) \
                or await self._db["floors"].find_one({"id": floor_id, "orgId": org_id})
            name = (floor or {}).get("name") or (floor or {}).get("label") or (floor or {}).get("floorName")
            if name:
                return str(name)
        except Exception:
            pass
        return "the selected floor"

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
        stale_ids = [
            d["_id"] async for d in self._db[COLLECTION_JOBS].find(
                {
                    "orgId": org_id,
                    "floorId": floor_id,
                    "status": {"$in": list(_ACTIVE_STATUSES)},
                    "heartbeatAt": {"$lt": cutoff},
                },
                {"_id": 1},
            )
        ]
        result = await self._db[COLLECTION_JOBS].update_many(
            {
                "_id": {"$in": stale_ids},
                "status": {"$in": list(_ACTIVE_STATUSES)},
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
            # A background job that timed out must still tell its requester.
            for stale_id in stale_ids:
                await self._notify_if_requested(str(stale_id))
