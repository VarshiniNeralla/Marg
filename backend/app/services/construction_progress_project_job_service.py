"""
Project-wide construction-progress analysis job.

ONE background job per project walks every floor that has photos, one after another, through the
existing single-floor machinery (``ConstructionProgressAnalyzeJobService`` + ``analyze_floor``), so
every floor uses its own activity scope, gets its own snapshot and its own floor-level job record.
Floors without captures are listed as skipped ("no photos"). When the job ends the requester and the
organisation's admins get one in-app notification.

Job document (``construction_progress_project_jobs``): state queued -> running -> completed | partial | failed.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import AppException, BadRequestException, NotFoundException
from app.services.construction_progress_analyze_job_service import (
    COLLECTION_NOTIFICATIONS,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_FAILED,
    NOTIF_COMPLETE,
    NOTIF_FAILED,
    ConstructionProgressAnalyzeJobService,
)
from app.services.construction_progress_project_service import ConstructionProgressProjectService
from app.services.construction_progress_service import iso_utc

COLLECTION_PROJECT_JOBS = "construction_progress_project_jobs"

STATE_QUEUED = "queued"
STATE_RUNNING = "running"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_PARTIAL = "partial"

_ACTIVE_STATES = (STATE_QUEUED, STATE_RUNNING)
_STALE_AFTER = timedelta(minutes=45)
# How long one floor may take before the project job gives up waiting for it.
_FLOOR_WAIT_LIMIT = timedelta(minutes=45)
_FLOOR_POLL_SECONDS = 2.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def serialize_project_job(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "jobId": str(doc["_id"]),
        "projectId": doc.get("projectId", ""),
        "state": doc.get("state", STATE_QUEUED),
        "createdAt": iso_utc(doc.get("createdAt")),
        "startedAt": iso_utc(doc.get("startedAt")),
        "finishedAt": iso_utc(doc.get("finishedAt")),
        # floorsTotal = every floor of the project; floorsQueued = the floors this job analyses
        # (progress = (floorsDone + floorsFailed) / floorsQueued); the rest had no photos.
        "floorsTotal": int(doc.get("floorsTotal") or 0),
        "floorsQueued": int(doc.get("floorsQueued") or 0),
        "floorsSkippedNoPhotos": int(doc.get("floorsSkippedNoPhotos") or 0),
        "floorsDone": int(doc.get("floorsDone") or 0),
        "floorsFailed": int(doc.get("floorsFailed") or 0),
        "current": doc.get("current"),
        "errors": list(doc.get("errors") or []),
    }


class ConstructionProgressProjectJobService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        self._projects = ConstructionProgressProjectService(db)
        self._floor_jobs = ConstructionProgressAnalyzeJobService(db)

    # ── Start / read ──────────────────────────────────────────────────────

    async def start(self, *, org_id: str, project_id: str, analyzed_by: str | None) -> dict[str, Any]:
        project = await self._projects.get_project(org_id, project_id)
        if project is None:
            raise NotFoundException("Project", project_id)

        await self._fail_stale_jobs(org_id, project_id)
        running = await self._active_doc(org_id, project_id)
        if running:
            raise AppException(
                status_code=409,
                error_code="ANALYSIS_ALREADY_RUNNING",
                message="A whole-project analysis is already running for this project",
                detail={"job": serialize_project_job(running)},
            )

        with_photos, without_photos = await self._projects.floors_with_photos(org_id, project_id)
        if not with_photos:
            raise BadRequestException("This project has no floors with photos to analyse")

        job_id = str(uuid.uuid4())
        now = _utcnow()
        doc = {
            "_id": job_id,
            "orgId": org_id,
            "projectId": project_id,
            "projectName": str(project.get("name") or ""),
            "analyzedBy": analyzed_by,
            "state": STATE_QUEUED,
            "createdAt": now,
            "startedAt": None,
            "finishedAt": None,
            "updatedAt": now,
            "heartbeatAt": now,
            "floorsTotal": len(with_photos) + len(without_photos),
            "floorsQueued": len(with_photos),
            "floorsSkippedNoPhotos": len(without_photos),
            "queue": [{"floorId": f["floorId"], "floorName": f["floorName"]} for f in with_photos],
            "skippedFloorIds": [f["floorId"] for f in without_photos],
            "doneFloorIds": [],
            "failedFloorIds": [],
            "floorsDone": 0,
            "floorsFailed": 0,
            "current": None,
            "errors": [],
            "notifiedAt": None,
        }
        await self._db[COLLECTION_PROJECT_JOBS].insert_one(doc)
        logger.info(
            "[cp-project-job] queued job={} project={} floors={} skipped={}",
            job_id, project_id, len(with_photos), len(without_photos),
        )
        self._dispatch(job_id)
        return serialize_project_job(doc)

    async def get_status(
        self, *, org_id: str, project_id: str, job_id: str | None = None,
    ) -> Optional[dict[str, Any]]:
        """A specific job, or (no job_id) the active job, else the most recent one. None if there never was one."""
        await self._fail_stale_jobs(org_id, project_id)
        if job_id:
            doc = await self._db[COLLECTION_PROJECT_JOBS].find_one(
                {"_id": job_id, "orgId": org_id, "projectId": project_id}
            )
        else:
            doc = await self._active_doc(org_id, project_id) or await self._latest_doc(org_id, project_id)
        return serialize_project_job(doc) if doc else None

    async def _active_doc(self, org_id: str, project_id: str) -> Optional[dict[str, Any]]:
        return await self._db[COLLECTION_PROJECT_JOBS].find_one(
            {"orgId": org_id, "projectId": project_id, "state": {"$in": list(_ACTIVE_STATES)}},
            sort=[("createdAt", -1)],
        )

    async def _latest_doc(self, org_id: str, project_id: str) -> Optional[dict[str, Any]]:
        return await self._db[COLLECTION_PROJECT_JOBS].find_one(
            {"orgId": org_id, "projectId": project_id}, sort=[("createdAt", -1)],
        )

    # ── Running ───────────────────────────────────────────────────────────

    _tasks: set = set()

    def _dispatch(self, job_id: str) -> None:
        task = asyncio.create_task(self.run_job(job_id))
        ConstructionProgressProjectJobService._tasks.add(task)
        task.add_done_callback(ConstructionProgressProjectJobService._tasks.discard)

    async def run_job(self, job_id: str) -> None:
        now = _utcnow()
        claimed = await self._db[COLLECTION_PROJECT_JOBS].find_one_and_update(
            {"_id": job_id, "state": STATE_QUEUED},
            {"$set": {"state": STATE_RUNNING, "startedAt": now, "updatedAt": now, "heartbeatAt": now}},
        )
        if not claimed:
            return

        async def _heartbeat_loop() -> None:
            while True:
                await asyncio.sleep(30)
                try:
                    await self._db[COLLECTION_PROJECT_JOBS].update_one(
                        {"_id": job_id, "state": STATE_RUNNING},
                        {"$set": {"heartbeatAt": _utcnow(), "updatedAt": _utcnow()}},
                    )
                except Exception as exc:
                    logger.warning("[cp-project-job] heartbeat failed job={}: {!r}", job_id, exc)
                    return

        heartbeat = asyncio.create_task(_heartbeat_loop())
        try:
            await self._run_floors(claimed)
            await self._finish(job_id)
        except Exception as exc:  # the loop itself broke (not one floor): fail the job
            logger.exception("[cp-project-job] crashed job={}", job_id)
            await self._db[COLLECTION_PROJECT_JOBS].update_one(
                {"_id": job_id},
                {
                    "$set": {"state": STATE_FAILED, "finishedAt": _utcnow(), "updatedAt": _utcnow(), "current": None},
                    "$push": {"errors": {"floorId": "", "message": str(exc)[:500]}},
                },
            )
        finally:
            heartbeat.cancel()
            try:
                await heartbeat
            except asyncio.CancelledError:
                pass
        await self._notify(job_id)

    async def _run_floors(self, job: dict[str, Any]) -> None:
        job_id = str(job["_id"])
        org_id = job["orgId"]
        finished = set(job.get("doneFloorIds") or []) | set(job.get("failedFloorIds") or [])
        for entry in job.get("queue") or []:
            floor_id = entry["floorId"]
            if floor_id in finished:  # resumed after a restart
                continue
            await self._db[COLLECTION_PROJECT_JOBS].update_one(
                {"_id": job_id},
                {"$set": {
                    "current": {"floorId": floor_id, "floorName": entry.get("floorName", "")},
                    "heartbeatAt": _utcnow(), "updatedAt": _utcnow(),
                }},
            )
            error = await self._analyse_one_floor(org_id, floor_id, job.get("analyzedBy"))
            if error is None:
                update: dict[str, Any] = {"$inc": {"floorsDone": 1}, "$push": {"doneFloorIds": floor_id}}
            else:
                update = {
                    "$inc": {"floorsFailed": 1},
                    "$push": {
                        "failedFloorIds": floor_id,
                        "errors": {"floorId": floor_id, "message": error[:500]},
                    },
                }
            update.setdefault("$set", {}).update({"heartbeatAt": _utcnow(), "updatedAt": _utcnow()})
            await self._db[COLLECTION_PROJECT_JOBS].update_one({"_id": job_id}, update)

    async def _analyse_one_floor(self, org_id: str, floor_id: str, analyzed_by: str | None) -> str | None:
        """Analyse one floor through the single-floor job machinery. Returns an error message, or None on success."""
        try:
            floor_job = await self._floor_jobs.start_analyze(
                org_id=org_id, floor_id=floor_id, analyzed_by=analyzed_by, background=False, dispatch=False,
            )
            await self._floor_jobs.run_job(floor_job["jobId"])  # no-op when someone else already runs it
            deadline = _utcnow() + _FLOOR_WAIT_LIMIT
            while True:
                current = await self._floor_jobs.get_job(org_id=org_id, job_id=floor_job["jobId"])
                if current is None:
                    return "Floor analysis job disappeared"
                if current["status"] == JOB_STATUS_COMPLETED:
                    return None
                if current["status"] == JOB_STATUS_FAILED:
                    return str(current.get("error") or "Floor analysis failed")
                if _utcnow() > deadline:
                    return "Floor analysis did not finish in time"
                await asyncio.sleep(_FLOOR_POLL_SECONDS)
        except Exception as exc:
            logger.exception("[cp-project-job] floor failed floor={}", floor_id)
            return str(exc) or exc.__class__.__name__

    async def _finish(self, job_id: str) -> None:
        doc = await self._db[COLLECTION_PROJECT_JOBS].find_one({"_id": job_id}) or {}
        done = int(doc.get("floorsDone") or 0)
        failed = int(doc.get("floorsFailed") or 0)
        state = STATE_COMPLETED if failed == 0 else STATE_FAILED if done == 0 else STATE_PARTIAL
        now = _utcnow()
        await self._db[COLLECTION_PROJECT_JOBS].update_one(
            {"_id": job_id},
            {"$set": {"state": state, "finishedAt": now, "updatedAt": now, "heartbeatAt": now, "current": None}},
        )
        logger.info("[cp-project-job] finished job={} state={} done={} failed={}", job_id, state, done, failed)

    # ── Recovery / stale ──────────────────────────────────────────────────

    async def recover_orphaned_jobs(self) -> None:
        """Re-dispatch project jobs that were running when the process restarted; finished floors are skipped."""
        try:
            orphans = await self._db[COLLECTION_PROJECT_JOBS].find(
                {"state": {"$in": list(_ACTIVE_STATES)}}
            ).to_list(length=100)
        except Exception as exc:
            logger.warning("[cp-project-job] orphan recovery query failed: {!r}", exc)
            return
        for job in orphans:
            now = _utcnow()
            await self._db[COLLECTION_PROJECT_JOBS].update_one(
                {"_id": job["_id"]},
                {"$set": {"state": STATE_QUEUED, "startedAt": None, "heartbeatAt": now, "updatedAt": now}},
            )
            logger.info("[cp-project-job] re-dispatching orphaned job={}", job["_id"])
            self._dispatch(str(job["_id"]))

    async def _fail_stale_jobs(self, org_id: str, project_id: str) -> None:
        cutoff = _utcnow() - _STALE_AFTER
        stale = [
            d["_id"] async for d in self._db[COLLECTION_PROJECT_JOBS].find(
                {
                    "orgId": org_id, "projectId": project_id,
                    "state": {"$in": list(_ACTIVE_STATES)}, "heartbeatAt": {"$lt": cutoff},
                },
                {"_id": 1},
            )
        ]
        if not stale:
            return
        now = _utcnow()
        await self._db[COLLECTION_PROJECT_JOBS].update_many(
            {"_id": {"$in": stale}, "state": {"$in": list(_ACTIVE_STATES)}},
            {
                "$set": {"state": STATE_FAILED, "finishedAt": now, "updatedAt": now, "current": None},
                "$push": {"errors": {"floorId": "", "message": "Analysis timed out (no progress heartbeat). Please try again."}},
            },
        )
        for job_id in stale:
            await self._notify(str(job_id))

    # ── Notification ──────────────────────────────────────────────────────

    async def _notify(self, job_id: str) -> None:
        """One in-app notification per user (requester + org admins), exactly once per job. Never raises."""
        try:
            job = await self._db[COLLECTION_PROJECT_JOBS].find_one_and_update(
                {"_id": job_id, "notifiedAt": None, "state": {"$in": [STATE_COMPLETED, STATE_PARTIAL, STATE_FAILED]}},
                {"$set": {"notifiedAt": _utcnow()}},
            )
            if not job:
                return
            org_id = job["orgId"]
            project_id = job["projectId"]
            label = job.get("projectName") or "the project"
            done, failed = int(job.get("floorsDone") or 0), int(job.get("floorsFailed") or 0)
            if job["state"] == STATE_COMPLETED:
                ntype, title = NOTIF_COMPLETE, "Project analysis ready for review"
                body = f"The whole-project progress analysis for {label} is complete ({done} floor(s) analysed)."
            elif job["state"] == STATE_PARTIAL:
                ntype, title = NOTIF_COMPLETE, "Project analysis finished with some failures"
                body = f"The progress analysis for {label} finished: {done} floor(s) analysed, {failed} failed."
            else:
                ntype, title = NOTIF_FAILED, "Project analysis failed"
                body = f"The whole-project progress analysis for {label} could not be completed."
            recipients = await self._floor_jobs._recipient_ids(org_id, job.get("analyzedBy"))
            now = _utcnow()
            docs = []
            for uid in recipients:
                nid = str(uuid.uuid4())
                docs.append({
                    "_id": nid, "id": nid,
                    "orgId": org_id, "org_id": org_id,
                    "recipientUserId": uid, "recipient_user_id": uid, "userId": uid, "user_id": uid,
                    "type": ntype, "title": title, "body": body,
                    "link": f"/construction-progress/project-analysis?project={project_id}",
                    "read": False,
                    "createdAt": now, "created_at": now, "updatedAt": now, "updated_at": now,
                })
            if docs:
                await self._db[COLLECTION_NOTIFICATIONS].insert_many(docs)
        except Exception as exc:
            logger.warning("[cp-project-job] could not notify for job={}: {!r}", job_id, exc)
