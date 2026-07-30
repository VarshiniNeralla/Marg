"""
Background 360-capture stitching jobs.

Stitching a raw dual-fisheye capture (.insp/.insv/.dng) costs ~23s of CPU, and
uploading the result to Cloudinary a few seconds more. Doing that inline in the
upload request meant a field engineer stood still for ~27s per capture, and made
the request so long-lived that any client-side timeout/abort would restart the
whole pipeline (which is exactly how 28 duplicate Cloudinary assets were once
created from 2 real captures).

This service moves that work off the request path, mirroring the established
pollable-job pattern in ai_progress_service.py: a Mongo job document holds the
status, the slow work runs in a fire-and-forget asyncio task, and the client
polls until the job reports completed/failed.

Exactly-once is enforced by two layers, both keyed on a SHA-256 of the raw file
bytes (the "dedup key"):
  * the completed-result cache (`capture_upload_dedup`, shared with the
    synchronous path in workflow.py) — identical bytes never stitch twice, and
  * an in-flight guard — a second upload of the same bytes while a job is still
    running joins the existing job instead of starting a rival one.

Because the request's UploadFile does not outlive the response, the raw bytes
are spooled to disk and the job reads them back. The client's own durable upload
queue keeps its copy until the job completes, so a lost spool file is always
recoverable by re-uploading.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.cloudinary_service import upload_media

COLLECTION_JOBS = "capture_stitch_jobs"

JOB_STATUS_PENDING = "pending"
JOB_STATUS_PROCESSING = "processing"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"

_ACTIVE_STATUSES = (JOB_STATUS_PENDING, JOB_STATUS_PROCESSING)

# A stitch that has not touched its heartbeat in this long is presumed dead
# (hung thread, killed worker). Without this sweep such a job would hold the
# in-flight dedup guard forever and silently block every retry of those bytes.
_STALE_AFTER = timedelta(minutes=10)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CaptureStitchService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    # ── Public API ────────────────────────────────────────────────────────────

    async def start_stitch(
        self,
        *,
        org_id: str,
        dedup_key: str,
        cached_asset: Optional[dict[str, Any]],
        raw_path: str,
        filename: str,
        ext: str,
        folder: str,
        entity_id: Optional[str],
    ) -> dict[str, Any]:
        """
        Returns either an already-finished asset (cache hit) or a job to poll.

        Shape: {"status": ..., "jobId": str | None, "asset": dict | None}
        """
        jobs = self._db[COLLECTION_JOBS]

        # 1. Already stitched these exact bytes before — nothing to do.
        if cached_asset is not None:
            logger.info(f"[stitch-job] dedup HIT (cache) file={filename} — no job needed")
            return {"status": JOB_STATUS_COMPLETED, "jobId": None, "asset": cached_asset}

        await self._fail_stale_jobs(org_id=org_id)

        # 2. A job for these bytes is already running — join it rather than
        #    starting a second stitch of the same file.
        existing = await jobs.find_one(
            {"orgId": org_id, "dedupKey": dedup_key, "status": {"$in": list(_ACTIVE_STATUSES)}}
        )
        if existing:
            logger.info(
                f"[stitch-job] dedup HIT (in-flight) file={filename} "
                f"job={existing['_id']} status={existing.get('status')}"
            )
            return {"status": existing.get("status"), "jobId": str(existing["_id"]), "asset": None}

        job_id = str(uuid.uuid4())
        now = _utcnow()
        await jobs.insert_one(
            {
                "_id": job_id,
                "orgId": org_id,
                "dedupKey": dedup_key,
                "status": JOB_STATUS_PENDING,
                "filename": filename,
                "ext": ext,
                "rawPath": raw_path,
                "folder": folder,
                "entityId": entity_id,
                "asset": None,
                "error": None,
                "createdAt": now,
                "heartbeatAt": now,
                "completedAt": None,
            }
        )
        logger.info(f"[stitch-job] queued job={job_id} file={filename} bytes_path={raw_path}")
        self._dispatch(job_id)
        return {"status": JOB_STATUS_PENDING, "jobId": job_id, "asset": None}

    async def get_job(self, *, org_id: str, job_id: str) -> Optional[dict[str, Any]]:
        doc = await self._db[COLLECTION_JOBS].find_one({"_id": job_id, "orgId": org_id})
        if not doc:
            return None
        return {
            "jobId": str(doc["_id"]),
            "status": doc.get("status"),
            "asset": doc.get("asset"),
            "error": doc.get("error"),
        }

    async def recover_orphaned_jobs(self) -> None:
        """
        Re-dispatch (or fail) jobs left mid-flight by a process restart.

        asyncio tasks die with the process, so without this a job sits at
        'processing' forever — holding the in-flight dedup guard and never
        completing. Called once from the app lifespan on startup.
        """
        jobs = self._db[COLLECTION_JOBS]
        try:
            orphans = await jobs.find({"status": {"$in": list(_ACTIVE_STATUSES)}}).to_list(length=500)
        except Exception as exc:
            logger.warning(f"[stitch-job] orphan recovery query failed: {exc!r}")
            return

        for job in orphans:
            job_id = str(job["_id"])
            raw_path = job.get("rawPath") or ""
            if raw_path and Path(raw_path).exists():
                logger.info(f"[stitch-job] re-dispatching orphaned job={job_id} after restart")
                await jobs.update_one(
                    {"_id": job_id},
                    {"$set": {"status": JOB_STATUS_PENDING, "heartbeatAt": _utcnow()}},
                )
                self._dispatch(job_id)
            else:
                # Spool file is gone — unrecoverable server-side. Marking it
                # failed (rather than leaving it stuck) is what lets the client
                # re-upload the bytes it still holds and get a clean stitch.
                logger.warning(
                    f"[stitch-job] orphaned job={job_id} has no spooled file — marking failed"
                )
                await self._mark_failed(job_id, "Server restarted and the uploaded file was no longer available.")

    # ── Internals ─────────────────────────────────────────────────────────────

    def _dispatch(self, job_id: str) -> None:
        # Fire-and-forget, same as ai_progress_service.start_analysis. The task
        # reference is intentionally not awaited; all state lives in Mongo so a
        # dropped task is recoverable via recover_orphaned_jobs().
        asyncio.create_task(self._run_job(job_id))

    async def _run_job(self, job_id: str) -> None:
        jobs = self._db[COLLECTION_JOBS]
        job = await jobs.find_one({"_id": job_id})
        if not job:
            return

        await jobs.update_one(
            {"_id": job_id},
            {"$set": {"status": JOB_STATUS_PROCESSING, "heartbeatAt": _utcnow()}},
        )

        raw_path = Path(job.get("rawPath") or "")
        filename = job.get("filename") or "capture"

        try:
            if not raw_path.exists():
                raise RuntimeError(f"spooled upload missing at {raw_path}")

            with raw_path.open("rb") as file_obj:
                asset = await upload_media(
                    file_obj=file_obj,
                    filename=filename,
                    folder=job.get("folder") or "",
                    resource_type="auto",
                    tag_if_panorama=True,
                )

            # Cache BEFORE marking the job complete: if the process dies between
            # these two writes, the next upload of the same bytes gets a cache
            # hit instead of paying for a second stitch.
            from app.api.v1.endpoints.workflow import _asset_payload, _dedup_store

            await _dedup_store(self._db, job["dedupKey"], asset)
            payload = _asset_payload(
                asset,
                kind="captures",
                entity_id=job.get("entityId"),
                ext=job.get("ext") or "",
            )
            # Carry the job id onto the FINISHED asset too. The client created its
            # capture record from the pending payload (which had this id) and uses
            # it to find and update that same record when the stitch lands. Without
            # it the client can't match the two and creates a duplicate capture for
            # one photo.
            payload["stitchJobId"] = job_id
            await jobs.update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": JOB_STATUS_COMPLETED,
                        "asset": payload,
                        "error": None,
                        "heartbeatAt": _utcnow(),
                        "completedAt": _utcnow(),
                    }
                },
            )
            await self._apply_asset_to_capture(job_id=job_id, org_id=job["orgId"], payload=payload)
            logger.info(f"✅ STITCH COMPLETE — {filename} — panorama ready: {payload.get('processed_panorama_url')}")
            logger.info(f"[stitch-job] completed job={job_id} file={filename}")
        except Exception as exc:
            logger.error(f"❌ STITCH FAILED — {filename} — {exc}")
            logger.exception(f"[stitch-job] failed job={job_id} file={filename}")
            await self._mark_failed(job_id, str(exc)[:500])
        finally:
            # Best-effort spool cleanup. On failure the client still holds the
            # bytes, so keeping the temp file buys nothing.
            try:
                if raw_path.exists():
                    raw_path.unlink()
            except Exception:
                pass

    async def _apply_asset_to_capture(self, *, job_id: str, org_id: str, payload: dict[str, Any]) -> None:
        """
        Patch the finished panorama onto the capture document, if the client has
        already created it.

        The capture doc is created by a separate, independently-queued client
        request (writeQueue), so it may not exist yet — in that case
        create_capture merges this job's asset at insert time instead. Only one
        of the two paths ever needs to win.
        """
        try:
            result = await self._db["captures"].update_one(
                {"stitchJobId": job_id, "orgId": org_id},
                {
                    "$set": {
                        "mediaAssets": [payload],
                        "media_assets": [payload],
                        "processingStatus": payload.get("processing_status"),
                        "processing_status": payload.get("processing_status"),
                        "original_url": payload.get("original_url"),
                        "originalFileUrl": payload.get("original_file_url"),
                        "processedPanoramaUrl": payload.get("processed_panorama_url"),
                        "processed_panorama_url": payload.get("processed_panorama_url"),
                        "thumbnail_url": payload.get("thumbnail_url"),
                        "thumbnailUrl": payload.get("thumbnail_url"),
                        "previewUrl": payload.get("preview_url"),
                        "public_id": payload.get("public_id"),
                        "format": payload.get("format"),
                        "size": payload.get("size"),
                        "updatedAt": _utcnow(),
                    }
                },
            )
            if result.matched_count:
                logger.info(f"[stitch-job] patched capture for job={job_id}")
        except Exception as exc:
            # The asset is safely in the job doc and the dedup cache; a failed
            # patch here is recoverable and must not fail the job.
            logger.warning(f"[stitch-job] capture patch failed for job={job_id}: {exc!r}")

    async def _mark_failed(self, job_id: str, error: str) -> None:
        try:
            await self._db[COLLECTION_JOBS].update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": JOB_STATUS_FAILED,
                        "error": error,
                        "heartbeatAt": _utcnow(),
                        "completedAt": _utcnow(),
                    }
                },
            )
        except Exception as exc:
            logger.warning(f"[stitch-job] could not mark job={job_id} failed: {exc!r}")

    async def _fail_stale_jobs(self, *, org_id: str) -> None:
        cutoff = _utcnow() - _STALE_AFTER
        try:
            result = await self._db[COLLECTION_JOBS].update_many(
                {"orgId": org_id, "status": {"$in": list(_ACTIVE_STATUSES)}, "heartbeatAt": {"$lt": cutoff}},
                {
                    "$set": {
                        "status": JOB_STATUS_FAILED,
                        "error": "Stitching timed out.",
                        "completedAt": _utcnow(),
                    }
                },
            )
            if result.modified_count:
                logger.warning(f"[stitch-job] failed {result.modified_count} stale job(s)")
        except Exception as exc:
            logger.warning(f"[stitch-job] stale sweep failed: {exc!r}")
