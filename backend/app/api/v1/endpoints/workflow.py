import hashlib
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from bson import ObjectId
from fastapi import APIRouter, File, Query, Response, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from fastapi import Depends

from app.core.config import get_settings
from app.core.dependencies import CallerContext, DB
from app.core.exceptions import NotFoundException, ValidationException
from app.core.permissions import require_permission
from loguru import logger

settings = get_settings()
from app.services.capture_stitch_service import CaptureStitchService
from app.services.security_audit import SECURITY_CATEGORY
from app.services.cloudinary_service import (
    cloudinary_asset_exists,
    cloudinary_folder,
    signed_upload_params,
    upload_media,
    delete_media_assets,
)
from app.services.room_map_service import RoomMapService
from app.services.ai_progress_service import AIProgressService
from app.utils.pagination import success_response

router = APIRouter(tags=["Workflow"])
CAPTURE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".dng", ".insp", ".insv"}
FLOOR_PLAN_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MEDIA_EXTENSIONS = {
    "captures": CAPTURE_EXTENSIONS,
    "floorplans": FLOOR_PLAN_EXTENSIONS,
    "avatars": {".jpg", ".jpeg", ".png"},
    "projects": {".jpg", ".jpeg", ".png"},
    "tours": {".jpg", ".jpeg", ".png"},
}


COLLECTIONS = {
    "projects": "projects",
    "towers": "towers",
    "floors": "floors",
    "flats": "flats",
    "rooms": "rooms",
    "captures": "captures",
    "tours": "tours",
    "floorPlans": "floor_plans",
    "capturePins": "capture_pins",
    "defects": "defects",
    "notifications": "notifications",
    "auditLogs": "audit_logs",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id_filter(id: str) -> dict[str, Any]:
    if ObjectId.is_valid(id):
        return {"$in": [id, ObjectId(id)]}
    return id


def _serialise(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    raw_id = out.pop("_id", None)
    out["id"] = str(out.get("id") or raw_id)
    out.pop("orgId", None)
    return out


def _with_tenant(payload: dict[str, Any], ctx: CallerContext, entity_id: Optional[str] = None) -> dict[str, Any]:
    doc = dict(payload)
    id_value = entity_id or doc.get("id")
    if id_value is not None:
        # Harden against NoSQL operator injection: the primary key must be a
        # plain scalar string/ObjectId, never a dict like {"$ne": null} which
        # could turn the upsert filter into a mass-overwrite.
        if not isinstance(id_value, (str, int)):
            raise ValidationException("Invalid resource id")
        id_value = str(id_value)
        doc["_id"] = id_value
        doc["id"] = id_value
    # Tenant fields are ALWAYS taken from the authenticated context, never the
    # request body — a client cannot write into or read from another org.
    doc.pop("orgId", None)
    doc.pop("org_id", None)
    doc["orgId"] = ctx.org_id
    doc["org_id"] = ctx.org_id
    doc["updatedAt"] = _now()
    doc.setdefault("createdAt", doc["updatedAt"])
    doc.setdefault("updated_at", doc["updatedAt"])
    doc.setdefault("created_at", doc["createdAt"])

    # Preserve the UI's camelCase contract while also satisfying existing
    # MongoDB indexes that were created for snake_case backend documents.
    field_pairs = {
        "projectId": "project_id",
        "towerId": "tower_id",
        "floorId": "floor_id",
        "flatId": "flat_id",
        "roomId": "room_id",
        "captureId": "capture_id",
        "floorPlanId": "floor_plan_id",
        "sequenceNumber": "sequence_number",
        "createdBy": "created_by",
        "uploadedBy": "uploaded_by",
        "reviewedBy": "reviewed_by",
        "assignedTo": "assigned_to",
        "reviewStatus": "review_status",
        "processingStatus": "processing_status",
    }
    for camel, snake in field_pairs.items():
        if camel in doc and snake not in doc:
            doc[snake] = doc[camel]
    if "number" in doc and "floor_number" not in doc:
        doc["floor_number"] = doc["number"]
    if "name" in doc and "room_number" not in doc and "floorId" in doc:
        doc["room_number"] = doc["name"]
    if "number" in doc and "flat_number" not in doc and "floorId" in doc:
        doc["flat_number"] = doc["number"]
    return doc


def _extension(filename: str) -> str:
    return Path(filename or "").suffix.lower()


def _asset_payload(asset: dict[str, Any], *, kind: str, entity_id: Optional[str], ext: str) -> dict[str, Any]:
    original_url = asset["original_url"]
    thumbnail_url = asset["thumbnail_url"]
    stitched = asset.get("stitch") is not None
    # A raw dual-fisheye that was successfully stitched server-side is now a
    # viewable equirectangular JPEG — treat it exactly like a converted panorama.
    is_viewable = ext in {".jpg", ".jpeg", ".png", ".pdf"} or stitched
    processed_url = original_url if is_viewable else None
    # Raw formats that FAILED to stitch remain queued (archival raw only); a
    # stitched or already-viewable asset is converted.
    status = "converted" if is_viewable else "queued"
    return {
        **asset,
        "originalUrl": original_url,
        "thumbnailUrl": thumbnail_url,
        "original_file_url": original_url,
        "processed_panorama_url": processed_url,
        "processedPanoramaUrl": processed_url,
        "preview_url": thumbnail_url,
        "previewUrl": thumbnail_url,
        # After a successful stitch the delivered asset is a jpg, not the raw ext.
        "file_type": "jpg" if stitched else ext.lstrip("."),
        "fileType": "jpg" if stitched else ext.lstrip("."),
        "processing_status": status,
        "processingStatus": status,
        "projection": (asset.get("stitch") or {}).get("projection") if stitched else None,
        "cameraModel": (asset.get("stitch") or {}).get("cameraModel") if stitched else None,
        "capture_id": entity_id if kind == "captures" else None,
        "captureId": entity_id if kind == "captures" else None,
    }


def _pending_asset_payload(
    *,
    job_id: str,
    kind: str,
    entity_id: Optional[str],
    ext: str,
    filename: str,
    size: int,
) -> dict[str, Any]:
    """
    Placeholder asset for a capture whose stitch is still running in the
    background. Deliberately mirrors _asset_payload's key shape (with null URLs)
    so the client stores one consistent asset structure and simply swaps it for
    the real one when the job reports completed.
    """
    return {
        "stitchJobId": job_id,
        "original_url": None,
        "originalUrl": None,
        "thumbnail_url": None,
        "thumbnailUrl": None,
        "original_file_url": None,
        "processed_panorama_url": None,
        "processedPanoramaUrl": None,
        "preview_url": None,
        "previewUrl": None,
        "public_id": None,
        "format": None,
        "size": size,
        "resource_type": "image",
        "original_filename": filename,
        "uploaded_at": _now(),
        "file_type": ext.lstrip("."),
        "fileType": ext.lstrip("."),
        "processing_status": "processing",
        "processingStatus": "processing",
        "projection": None,
        "cameraModel": None,
        "capture_id": entity_id if kind == "captures" else None,
        "captureId": entity_id if kind == "captures" else None,
    }


# Raw capture bytes outlive the request only if written to disk: the background
# stitch job runs after the response is sent, by which point UploadFile is
# closed. Keyed by dedup hash so a duplicate upload reuses the same spool file
# rather than writing a second copy of a ~13MB payload.
def _spool_raw_upload(dedup_key: str, raw_bytes: bytes, ext: str) -> Path:
    spool_dir = Path(tempfile.gettempdir()) / "sitevision-stitch-spool"
    spool_dir.mkdir(parents=True, exist_ok=True)
    safe_name = dedup_key.rsplit(":", 1)[-1]
    path = spool_dir / f"{safe_name}{ext or '.bin'}"
    if not path.exists():
        path.write_bytes(raw_bytes)
    return path


# Content-type prefixes accepted per upload kind (defense-in-depth alongside the
# extension allowlist — neither alone is sufficient, but together they reject the
# obvious renamed-executable / wrong-type cases before bytes hit Cloudinary).
_ALLOWED_CONTENT_TYPES = {
    "captures": ("image/", "application/octet-stream"),  # .dng/.insp may be octet-stream
    "floorplans": ("image/", "application/pdf"),
    "avatars": ("image/",),
    "projects": ("image/",),
    "tours": ("image/",),
}


def _validate_upload_size(file: UploadFile, *, will_be_reprocessed: bool = False) -> int:
    """Returns the file size in bytes, raising if it exceeds the configured cap.
    Uses seek/tell so we don't buffer the whole file in memory just to size it.

    Raw 360 files (.dng/.insp/.insv) are STITCHED down to a small equirectangular
    JPEG before they reach Cloudinary, and a plain capture JPEG that's still over
    Cloudinary's cap gets re-encoded down to fit (see panorama_service.ensure_
    under_size) — both cases get a larger pre-check cap here because only the
    FINAL, already-shrunk bytes actually need to fit Cloudinary's limit, not
    whatever the camera originally handed us."""
    try:
        file.file.seek(0, 2)   # seek to end
        size = file.file.tell()
        file.file.seek(0)       # rewind for the actual upload
    except Exception:
        return 0  # unseekable stream — let Cloudinary's own limits apply
    cap = settings.MAX_RAW_UPLOAD_BYTES if will_be_reprocessed else settings.MAX_UPLOAD_BYTES
    if size > cap:
        mb = cap // (1024 * 1024)
        actual_mb = size / (1024 * 1024)
        from loguru import logger
        logger.warning(
            f"Upload rejected: {file.filename} is {actual_mb:.1f} MB > {mb} MB cap"
        )
        if will_be_reprocessed:
            raise ValidationException(
                f"File is {actual_mb:.0f} MB, over the {mb} MB limit for 360 captures."
            )
        raise ValidationException(
            f"File is {actual_mb:.0f} MB, over the {mb} MB limit. Upload a smaller "
            f"image or the stitched 360 export from the Insta360 app."
        )
    return size


_UPLOAD_DEDUP_COLLECTION = "capture_upload_dedup"

# Project activity reads exclude the security/identity category. Matches rows
# where logCategory is absent (every project event) as well as explicit nulls,
# so only rows tagged "security" are filtered out.
_PROJECT_AUDIT_FILTER: dict[str, Any] = {"logCategory": {"$ne": SECURITY_CATEGORY}}


async def _dedup_asset_is_live(asset: dict[str, Any]) -> bool:
    """
    True only if the cached asset's Cloudinary file is still actually
    fetchable AND lives on the currently-configured Cloudinary account. The
    dedup cache is keyed on a hash of the raw bytes and never expires, but
    the Cloudinary asset it points to can vanish independently (manual
    cleanup, account TTL, ...) — confirmed in production: a capture
    uploaded days after an identical-bytes upload got handed back the old
    cache entry's URL, which by then 404'd, so the "upload" silently
    produced a dead capture instead of a real one. Reusing a cache entry is
    only safe once we know the URL it points to is real.

    The account check matters independently of liveness: after a Cloudinary
    credential migration, entries created under the old cloud name can stay
    live (still resolvable) indefinitely, so a pure HEAD check would keep
    silently handing back old-account assets forever instead of migrating
    fresh uploads to the new account.
    """
    url = asset.get("original_url")
    if not url:
        return False
    cloud_name = get_settings().CLOUDINARY_CLOUD_NAME
    if cloud_name and f"res.cloudinary.com/{cloud_name}/" not in url:
        return False

    # Ask the account, not the CDN edge — a destroyed asset keeps serving over
    # the CDN for a while, and trusting that 200 is how a destroyed asset got
    # handed back from this cache and produced a capture that went dead later.
    public_id = asset.get("public_id")
    if public_id:
        exists = await cloudinary_asset_exists(
            public_id, asset.get("resource_type") or "image"
        )
        if exists is False:
            return False
        if exists is True:
            return True
        # exists is None → inconclusive, fall through to the delivery-URL probe.

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.head(url, follow_redirects=True)
        return resp.status_code < 400
    except Exception as exc:
        logger.warning(f"[capture-upload] dedup liveness check failed for {url}: {exc!r}")
        return False


async def _dedup_lookup(db: Optional[AsyncIOMotorDatabase], key: str) -> Optional[dict[str, Any]]:
    """Previously-completed result for these exact bytes, if any — verified to
    still be live on Cloudinary before being trusted. A dead cache entry is
    dropped so a later upload of the same bytes doesn't hit the same dead
    result again."""
    if db is None:
        return None
    try:
        doc = await db[_UPLOAD_DEDUP_COLLECTION].find_one({"_id": key})
    except Exception as exc:  # cache must never break an upload
        logger.warning(f"[capture-upload] dedup lookup failed: {exc!r}")
        return None
    asset = (doc or {}).get("asset")
    if asset is None:
        return None
    if await _dedup_asset_is_live(asset):
        return asset
    logger.warning(
        f"[capture-upload] dedup entry key={key[-12:]} points to a dead asset "
        f"({asset.get('original_url')}) — discarding cache and re-uploading fresh"
    )
    try:
        await db[_UPLOAD_DEDUP_COLLECTION].delete_one({"_id": key})
    except Exception as exc:
        logger.warning(f"[capture-upload] failed to evict dead dedup entry: {exc!r}")
    return None


async def _dedup_store(db: Optional[AsyncIOMotorDatabase], key: str, asset: dict[str, Any]) -> None:
    if db is None:
        return
    try:
        await db[_UPLOAD_DEDUP_COLLECTION].replace_one(
            {"_id": key},
            {"_id": key, "asset": asset, "created_at": datetime.now(timezone.utc)},
            upsert=True,
        )
    except Exception as exc:
        logger.warning(f"[capture-upload] dedup store failed: {exc!r}")


async def _dedup_evict_for_assets(
    db: Optional[AsyncIOMotorDatabase], assets: list[dict[str, Any]]
) -> None:
    """Drop dedup entries whose cached Cloudinary asset was just destroyed, so a
    later upload of the same bytes re-uploads instead of being handed a corpse."""
    public_ids = [pid for a in assets if (pid := (a or {}).get("public_id"))]
    if db is None or not public_ids:
        return
    try:
        result = await db[_UPLOAD_DEDUP_COLLECTION].delete_many(
            {"asset.public_id": {"$in": public_ids}}
        )
        if result.deleted_count:
            logger.info(
                f"[capture-upload] evicted {result.deleted_count} dedup entry(s) "
                f"for destroyed asset(s): {', '.join(public_ids)}"
            )
    except Exception as exc:
        logger.warning(f"[capture-upload] dedup eviction failed: {exc!r}")


async def _release_capture_assets(
    db: AsyncIOMotorDatabase, ctx: CallerContext, assets: list[dict[str, Any]]
) -> None:
    """
    Clean up a just-deleted capture's Cloudinary files — but only the ones no
    surviving capture still points at, and evict the upload-dedup cache for
    each file actually destroyed.

    Two capture documents can legitimately share one Cloudinary asset: the
    dedup cache is keyed on a hash of the raw bytes and deliberately hands the
    same asset back when an identical photo is uploaded again, so a retry
    doesn't re-stitch or duplicate storage. That made a plain
    `delete_media_assets` call unsafe here in two compounding ways, both
    confirmed in production:

      • Deleting one sharer destroyed the file out from under the other, whose
        image then 404'd — surfacing as a blank thumbnail or a room stuck on
        "Photographed — Not Started" even though its capture row looked fine.
      • The dedup entry outlived the destroy, so the NEXT upload of those same
        bytes got a cache hit on an already-destroyed asset. The liveness
        probe in `_dedup_lookup` can't catch that on its own: Cloudinary's CDN
        keeps serving a destroyed file for a short window, so the HEAD returns
        200 and the new capture is created pointing at something that goes
        dead minutes later.

    Callers must delete the capture document(s) BEFORE calling this, so the
    reference check below doesn't count the row being removed.
    """
    if not assets:
        return

    keep: set[str] = set()
    for asset in assets:
        public_id = (asset or {}).get("public_id")
        if not public_id:
            continue
        try:
            still_used = await db["captures"].find_one(
                {
                    "orgId": ctx.org_id,
                    "$or": [
                        {"mediaAssets.public_id": public_id},
                        {"media_assets.public_id": public_id},
                        {"public_id": public_id},
                    ],
                },
                {"_id": 1},
            )
        except Exception as exc:  # cleanup must never block the decided delete
            logger.warning(f"[cloudinary] reference check failed for {public_id}: {exc!r}")
            still_used = {"_id": "unknown"}  # fail safe: keep the file
        if still_used is not None:
            keep.add(public_id)
            logger.info(
                f"[cloudinary] keeping public_id={public_id} — still referenced by "
                f"capture {still_used.get('_id')}"
            )

    releasable = [a for a in assets if (a or {}).get("public_id") not in keep]
    if not releasable:
        return
    await delete_media_assets(releasable)
    await _dedup_evict_for_assets(db, releasable)


async def _upload_files(
    *,
    ctx: CallerContext,
    kind: str,
    files: list[UploadFile],
    entity_id: Optional[str] = None,
    db: Optional[AsyncIOMotorDatabase] = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (finished_assets, pending_assets). Pending entries carry a
    stitchJobId the client polls; they have no URLs yet."""
    allowed = MEDIA_EXTENSIONS[kind]
    allowed_types = _ALLOWED_CONTENT_TYPES.get(kind, ("image/",))
    folder = cloudinary_folder(kind, ctx.org_id, entity_id)
    uploaded: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []
    for file in files:
        ext = _extension(file.filename or "")
        if ext not in allowed:
            raise ValidationException(f"Unsupported {kind} file type: {ext or 'unknown'}")
        # Content-type sanity check (browser-declared; combined with extension).
        ctype = (file.content_type or "").lower()
        if ctype and not any(ctype.startswith(p) for p in allowed_types):
            raise ValidationException(f"Unsupported content type for {kind}: {ctype}")
        is_raw_360 = kind == "captures" and ext in {".dng", ".insp", ".insv"}
        # Plain capture JPEGs may ALSO be genuine, un-shrunk 360 panoramas (an
        # Insta360 X3's native OSC output, ~14-15MB) that get re-encoded down
        # to fit Cloudinary's cap in upload_media — give them the same larger
        # pre-check cap as raw files, since only the post-compression bytes
        # actually need to fit under Cloudinary's limit.
        will_be_reprocessed = kind == "captures" and (is_raw_360 or ext in {".jpg", ".jpeg"})
        from loguru import logger
        if kind == "captures":
            logger.info(f"📸 IMAGE RECEIVED — {file.filename} ({ext}) — reached the server, starting to process")
        logger.info(
            f"[capture-upload] file={file.filename} ext={ext} kind={kind} "
            f"is_raw_360={is_raw_360} entity_id={entity_id}"
        )
        _validate_upload_size(file, will_be_reprocessed=will_be_reprocessed)

        # Stitching a raw 360 capture costs ~25-35s of CPU, and the client's
        # durable upload queue legitimately re-sends the same bytes whenever a
        # response never arrives (dropped tunnel, app restart mid-upload). With
        # no dedup those retries each redo the full stitch AND create another
        # Cloudinary asset — observed in production as 28 duplicate assets for
        # 2 real captures. Keying completed results on a hash of the exact bytes
        # makes a retry idempotent and near-instant instead.
        dedup_key: Optional[str] = None
        if kind == "captures":
            raw_bytes = await file.read()
            await file.seek(0)
            dedup_key = f"{ctx.org_id}:{hashlib.sha256(raw_bytes).hexdigest()}"
            cached = await _dedup_lookup(db, dedup_key)
            if cached is not None:
                logger.info(
                    f"[capture-upload] dedup HIT file={file.filename} "
                    f"key={dedup_key[-12:]} — skipping stitch + Cloudinary upload"
                )
                uploaded.append(_asset_payload(cached, kind=kind, entity_id=entity_id, ext=ext))
                continue

        # Raw 360 files are the only ones that pay the ~23s stitch, so they are
        # the only ones moved off the request path. A plain .jpg capture just
        # gets GPano metadata injected (see cloudinary_service.upload_media's
        # non-raw branch) and finishes in about a second — making that async too
        # would add a pointless poll round-trip and force every display surface
        # to handle a null-URL state for the common case.
        if is_raw_360 and dedup_key is not None:
            spool_path = _spool_raw_upload(dedup_key, raw_bytes, ext)
            logger.info(f"🧵 STITCHING NOW — {file.filename} — dispatching to background, this takes ~25-35s")
            job = await CaptureStitchService(db).start_stitch(
                org_id=ctx.org_id,
                dedup_key=dedup_key,
                cached_asset=None,  # cache was already checked above
                raw_path=str(spool_path),
                filename=file.filename or f"upload{ext}",
                ext=ext,
                folder=folder,
                entity_id=entity_id,
            )
            if job.get("status") == "completed" and job.get("asset"):
                uploaded.append(_asset_payload(job["asset"], kind=kind, entity_id=entity_id, ext=ext))
            else:
                pending.append(
                    _pending_asset_payload(
                        job_id=str(job.get("jobId") or ""),
                        kind=kind,
                        entity_id=entity_id,
                        ext=ext,
                        filename=file.filename or f"upload{ext}",
                        size=len(raw_bytes),
                    )
                )
            continue

        asset = await upload_media(
            file_obj=file.file,
            filename=file.filename or f"upload{ext}",
            folder=folder,
            resource_type="image" if ext == ".pdf" else "auto",
            # Captures may be a 360 panorama OR a plain photo/raw camera file. We
            # never reject: if it's a genuine 2:1 equirectangular image we tag it
            # with GPano metadata so the viewer shows a true 360; anything else is
            # uploaded as-is and the viewer renders it flat. Uploads must always
            # succeed so field captures are never lost.
            tag_if_panorama=(kind == "captures"),
        )
        if dedup_key is not None:
            await _dedup_store(db, dedup_key, asset)
        payload = _asset_payload(asset, kind=kind, entity_id=entity_id, ext=ext)
        logger.info(
            f"[capture-upload] completed file={file.filename} "
            f"processing_status={payload.get('processing_status')} "
            f"projection={payload.get('projection')} "
            f"processed_panorama_url={payload.get('processed_panorama_url')} "
            f"original_url={payload.get('original_url')}"
        )
        uploaded.append(payload)
    return uploaded, pending


async def _list(
    db: AsyncIOMotorDatabase,
    collection: str,
    ctx: CallerContext,
    skip: int = 0,
    limit: int = 100,
    extra_filter: Optional[dict[str, Any]] = None,
    sort: Optional[list[tuple[str, int]]] = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {"orgId": ctx.org_id, **(extra_filter or {})}
    total = await db[collection].count_documents(query)
    cursor = db[collection].find(query).skip(skip).limit(limit)
    cursor = cursor.sort(sort or [("createdAt", -1)])
    docs = [_serialise(d) for d in await cursor.to_list(length=limit)]
    return {"items": docs, "total": total, "skip": skip, "limit": limit}


async def _get(db: AsyncIOMotorDatabase, collection: str, id: str, ctx: CallerContext) -> dict[str, Any]:
    doc = await db[collection].find_one({"_id": _id_filter(id), "orgId": ctx.org_id})
    if not doc:
        raise NotFoundException(collection.rstrip("s").replace("_", " "), id)
    return _serialise(doc)


async def _upsert(
    db: AsyncIOMotorDatabase,
    collection: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    id: Optional[str] = None,
) -> dict[str, Any]:
    doc = _with_tenant(payload, ctx, id)
    await db[collection].replace_one({"_id": doc["_id"], "orgId": ctx.org_id}, doc, upsert=True)
    return _serialise(doc)


async def _upsert_preserving(
    db: AsyncIOMotorDatabase,
    collection: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    *,
    insert_only_fields: set[str],
) -> dict[str, Any]:
    """
    Like _upsert, but fields in `insert_only_fields` are written ONLY when the
    document is first created — never on a later replay.

    _upsert uses replace_one, which overwrites the whole document. That is wrong
    for captures in the async-stitch design: the client builds its capture object
    while the panorama URL is still null, and writeQueue.ts may flush that stale
    object seconds or minutes later (POLL_MS is 20s, and it can be delayed by an
    app restart or an expired token). A full replace at that point would wipe the
    panorama the background stitch job had already written. Putting the
    server-owned media fields in $setOnInsert makes that overwrite structurally
    impossible rather than merely unlikely.
    """
    doc = _with_tenant(payload, ctx)
    doc_id = doc["_id"]
    set_fields = {k: v for k, v in doc.items() if k not in insert_only_fields and k != "_id"}
    insert_fields = {k: v for k, v in doc.items() if k in insert_only_fields}

    update: dict[str, Any] = {"$set": set_fields}
    if insert_fields:
        update["$setOnInsert"] = insert_fields

    await db[collection].update_one({"_id": doc_id, "orgId": ctx.org_id}, update, upsert=True)
    stored = await db[collection].find_one({"_id": doc_id, "orgId": ctx.org_id})
    return _serialise(stored or doc)


async def _patch(
    db: AsyncIOMotorDatabase,
    collection: str,
    id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
) -> dict[str, Any]:
    update = dict(payload)
    update["updatedAt"] = _now()
    result = await db[collection].find_one_and_update(
        {"_id": _id_filter(id), "orgId": ctx.org_id},
        {"$set": update},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise NotFoundException(collection.rstrip("s").replace("_", " "), id)
    return _serialise(result)


async def _delete(db: AsyncIOMotorDatabase, collection: str, id: str, ctx: CallerContext) -> None:
    result = await db[collection].delete_one({"_id": _id_filter(id), "orgId": ctx.org_id})
    if result.deleted_count == 0:
        raise NotFoundException(collection.rstrip("s").replace("_", " "), id)


@router.get("/workflow/snapshot", summary="Get all workflow data for the current organization")
async def workflow_snapshot(ctx: CallerContext, db: DB):
    # Heal pins deleted while their captures survived (gallery shows Pin N,
    # plan/analysis does not) before the client hydrates.
    try:
        from app.services.pin_orphan_service import restore_orphan_pins_for_org
        restored = await restore_orphan_pins_for_org(db, org_id=ctx.org_id)
        if restored:
            logger.info("[workflow-snapshot] restored {} orphan pin(s) org={}", restored, ctx.org_id)
    except Exception:
        logger.exception("[workflow-snapshot] orphan pin restore failed org={}", ctx.org_id)

    data = {}
    for key, collection in COLLECTIONS.items():
        # The snapshot feeds the dashboard activity feed, so it carries project
        # activity only — security/identity events are read separately via
        # /audit-logs/security (see _PROJECT_AUDIT_FILTER).
        extra = _PROJECT_AUDIT_FILTER if collection == "audit_logs" else None
        data[key] = (await _list(db, collection, ctx, limit=500, extra_filter=extra))["items"]
    return success_response(data=data)


@router.get("/projects", summary="List projects")
async def list_projects(ctx: CallerContext, db: DB, skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    return success_response(data=await _list(db, "projects", ctx, skip, limit))


@router.post("/projects", status_code=status.HTTP_201_CREATED, summary="Create project")
async def create_project(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("projects", "create"))):
    return success_response(data=await _upsert(db, "projects", payload, ctx), message="Project created")


@router.get("/projects/{project_id}", summary="Get project")
async def get_project(project_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _get(db, "projects", project_id, ctx))


@router.put("/projects/{project_id}", summary="Update project")
async def update_project(project_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("projects", "edit"))):
    return success_response(data=await _patch(db, "projects", project_id, payload, ctx), message="Project updated")


@router.delete("/projects/{project_id}", summary="Delete project")
async def delete_project(project_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("projects", "delete"))):
    await _delete(db, "projects", project_id, ctx)
    return success_response(message="Project deleted")


@router.get("/projects/{project_id}/towers", summary="List project towers")
async def list_towers(project_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "towers", ctx, extra_filter={"projectId": project_id}))


@router.post("/projects/{project_id}/towers", status_code=status.HTTP_201_CREATED, summary="Create tower")
async def create_tower(project_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("towers", "create"))):
    payload["projectId"] = project_id
    return success_response(data=await _upsert(db, "towers", payload, ctx), message="Tower created")


@router.put("/towers/{tower_id}", summary="Update tower")
async def update_tower(tower_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("towers", "edit"))):
    return success_response(data=await _patch(db, "towers", tower_id, payload, ctx), message="Tower updated")


@router.delete("/towers/{tower_id}", summary="Delete tower")
async def delete_tower(tower_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("towers", "delete"))):
    await _delete(db, "towers", tower_id, ctx)
    return success_response(message="Tower deleted")


@router.get("/towers/{tower_id}/floors", summary="List tower floors")
async def list_floors(tower_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "floors", ctx, extra_filter={"towerId": tower_id}, sort=[("number", 1)]))


@router.post("/towers/{tower_id}/floors", status_code=status.HTTP_201_CREATED, summary="Create floor")
async def create_floor(tower_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("floors", "create"))):
    payload["towerId"] = tower_id
    return success_response(data=await _upsert(db, "floors", payload, ctx), message="Floor created")


@router.put("/floors/{floor_id}", summary="Update floor")
async def update_floor(floor_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("floors", "edit"))):
    return success_response(data=await _patch(db, "floors", floor_id, payload, ctx), message="Floor updated")


@router.delete("/floors/{floor_id}", summary="Delete floor")
async def delete_floor(floor_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("floors", "delete"))):
    await _delete(db, "floors", floor_id, ctx)
    return success_response(message="Floor deleted")


@router.get("/floors/{floor_id}/flats", summary="List floor flats")
async def list_flats(floor_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "flats", ctx, extra_filter={"floorId": floor_id}, sort=[("number", 1)]))


@router.post("/floors/{floor_id}/flats", status_code=status.HTTP_201_CREATED, summary="Create flat")
async def create_flat(floor_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("flats", "create"))):
    payload["floorId"] = floor_id
    return success_response(data=await _upsert(db, "flats", payload, ctx), message="Flat created")


@router.put("/flats/{flat_id}", summary="Update flat")
async def update_flat(flat_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("flats", "edit"))):
    return success_response(data=await _patch(db, "flats", flat_id, payload, ctx), message="Flat updated")


@router.delete("/flats/{flat_id}", summary="Delete flat")
async def delete_flat(flat_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("flats", "delete"))):
    await _delete(db, "flats", flat_id, ctx)
    return success_response(message="Flat deleted")


@router.get("/flats/{flat_id}/rooms", summary="List flat rooms")
async def list_rooms(flat_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "rooms", ctx, extra_filter={"flatId": flat_id}, sort=[("name", 1)]))


@router.post("/flats/{flat_id}/rooms", status_code=status.HTTP_201_CREATED, summary="Create room")
async def create_room(flat_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("rooms", "create"))):
    payload["flatId"] = flat_id
    return success_response(data=await _upsert(db, "rooms", payload, ctx), message="Room created")


@router.put("/rooms/{room_id}", summary="Update room")
async def update_room(room_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("rooms", "edit"))):
    return success_response(data=await _patch(db, "rooms", room_id, payload, ctx), message="Room updated")


@router.delete("/rooms/{room_id}", summary="Delete room")
async def delete_room(room_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("rooms", "delete"))):
    # Drop captures that lived only on this room so Media Library can't resurface them.
    room_captures = await db["captures"].find({"orgId": ctx.org_id, "roomId": room_id}).to_list(length=None)
    await db["captures"].delete_many({"orgId": ctx.org_id, "roomId": room_id})
    for cap in room_captures:
        await _release_capture_assets(db, ctx, cap.get("mediaAssets") or cap.get("media_assets") or [])
    await _delete(db, "rooms", room_id, ctx)
    return success_response(message="Room deleted")


@router.get("/captures", summary="List captures")
async def list_captures(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "captures", ctx, skip, limit, filters))


@router.post("/captures", status_code=status.HTTP_201_CREATED, summary="Create capture")
async def create_capture(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "create"))):
    assets = payload.get("mediaAssets") or payload.get("media_assets") or []
    first_asset = assets[0] if assets else None

    # If this capture's stitch already finished, prefer the job's real asset over
    # the client's placeholder. Covers the ordering where the background job
    # completes BEFORE the client's capture-create request arrives (writeQueue can
    # flush well after the upload).
    stitch_job_id = payload.get("stitchJobId") or (first_asset or {}).get("stitchJobId")
    if stitch_job_id:
        payload["stitchJobId"] = stitch_job_id
        job = await CaptureStitchService(db).get_job(org_id=ctx.org_id, job_id=str(stitch_job_id))
        if job and job.get("status") == "completed" and job.get("asset"):
            first_asset = job["asset"]
            assets = [first_asset]

    payload["mediaAssets"] = assets
    payload["media_assets"] = assets
    payload["processingStatus"] = first_asset.get("processingStatus", "uploaded") if first_asset else payload.get("processingStatus", "uploaded")
    payload["processing_status"] = payload["processingStatus"]
    if first_asset:
        payload["original_url"] = first_asset.get("original_url")
        payload["thumbnail_url"] = first_asset.get("thumbnail_url")
        payload["public_id"] = first_asset.get("public_id")
        payload["format"] = first_asset.get("format")
        payload["size"] = first_asset.get("size")
        payload["uploaded_at"] = first_asset.get("uploaded_at")
        payload["originalFileUrl"] = first_asset.get("original_file_url")
        payload["processedPanoramaUrl"] = first_asset.get("processed_panorama_url")
        payload["thumbnailUrl"] = first_asset.get("thumbnail_url")
        payload["previewUrl"] = first_asset.get("preview_url")

    # Media fields are server-owned once written: a late client replay carrying
    # nulls must never clobber a panorama the stitch job produced.
    stored = await _upsert_preserving(
        db,
        "captures",
        payload,
        ctx,
        insert_only_fields={
            "mediaAssets", "media_assets",
            "processingStatus", "processing_status",
            "original_url", "originalFileUrl",
            "processedPanoramaUrl", "processed_panorama_url",
            "thumbnail_url", "thumbnailUrl", "previewUrl",
            "public_id", "format", "size", "uploaded_at",
        },
    )
    # Pin.captureIds used to be updated in a SEPARATE client write that often
    # lagged or never landed (writeQueue / hydrate race). Analysis only follows
    # pin.captureIds, so the photo stayed in the gallery as an orphan while
    # Construction Progress under-counted. Link here by roomId so create alone
    # is enough to keep pin ↔ capture in sync.
    await _link_capture_to_pin_by_room(db, ctx, stored)
    return success_response(data=stored, message="Capture uploaded")


@router.get("/captures/{capture_id}", summary="Get capture")
async def get_capture(capture_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _get(db, "captures", capture_id, ctx))


@router.put("/captures/{capture_id}/review", summary="Update capture review")
async def update_capture_review(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "approve"))):
    return success_response(data=await _patch(db, "captures", capture_id, payload, ctx), message="Capture review updated")


@router.put("/captures/{capture_id}/publish", summary="Publish or unpublish capture")
async def publish_capture(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "approve"))):
    return success_response(data=await _patch(db, "captures", capture_id, payload, ctx), message="Capture publish state updated")


@router.delete("/captures/{capture_id}", summary="Delete capture")
async def delete_capture(capture_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "delete"))):
    # Fetch first so we still have its mediaAssets (Cloudinary public_id/
    # resource_type) after the Mongo document is gone — deleting the doc
    # without this left the actual image orphaned on Cloudinary forever.
    capture = await db["captures"].find_one({"_id": _id_filter(capture_id), "orgId": ctx.org_id})
    await _delete(db, "captures", capture_id, ctx)
    if capture:
        assets = capture.get("mediaAssets") or capture.get("media_assets") or []
        await _release_capture_assets(db, ctx, assets)
    # Drop progress analyses that compared this capture so saved-report history
    # cannot resurface deleted panorama images in the tour compare UI.
    try:
        purged = await AIProgressService(db).purge_for_timeline(ctx.org_id, capture_id)
        if purged:
            logger.info("Capture {} deleted with {} linked progress-analysis purge(s)", capture_id, purged)
    except Exception:
        logger.exception("Failed to purge progress analyses for deleted capture {}", capture_id)
    return success_response(message="Capture deleted")


@router.post("/captures/upload-signature", summary="Get upload signature placeholder")
async def get_upload_signature(payload: dict[str, Any], ctx: CallerContext):
    kind = payload.get("kind", "captures")
    entity_id = payload.get("entity_id") or payload.get("capture_id") or payload.get("id")
    return success_response(data=signed_upload_params(kind, ctx.org_id, entity_id))


@router.post("/uploads/captures", status_code=status.HTTP_201_CREATED, summary="Upload capture files")
async def upload_capture_files(response: Response, ctx: CallerContext, db: DB, files: list[UploadFile] = File(...), capture_id: Optional[str] = None, _=Depends(require_permission("captures", "upload"))):
    uploaded, pending = await _upload_files(ctx=ctx, kind="captures", files=files, entity_id=capture_id, db=db)
    files_payload = uploaded + pending
    if pending:
        # 202: the bytes are safely on the server but the panorama isn't ready.
        # Each pending entry carries a stitchJobId the client polls.
        response.status_code = status.HTTP_202_ACCEPTED
        message = "Capture received — stitching in progress"
    else:
        message = "Capture files uploaded"
    return success_response(
        data={"files": files_payload, "count": len(files_payload), "pendingCount": len(pending)},
        message=message,
    )


@router.get("/uploads/captures/jobs/{job_id}", summary="Poll a background stitch job")
async def get_capture_stitch_job(job_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "upload"))):
    job = await CaptureStitchService(db).get_job(org_id=ctx.org_id, job_id=job_id)
    if not job:
        raise NotFoundException("stitch job", job_id)
    return success_response(data=job)


@router.post("/uploads/floorplans", status_code=status.HTTP_201_CREATED, summary="Upload floor plan file")
async def upload_floor_plan_files(ctx: CallerContext, files: list[UploadFile] = File(...), floor_plan_id: Optional[str] = None, _=Depends(require_permission("floorPlans", "upload"))):
    uploaded, _pending = await _upload_files(ctx=ctx, kind="floorplans", files=files, entity_id=floor_plan_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Floor plan uploaded")


@router.post("/uploads/avatars", status_code=status.HTTP_201_CREATED, summary="Upload avatar")
async def upload_avatar_files(ctx: CallerContext, files: list[UploadFile] = File(...)):
    # Avatar upload is self-service for any authenticated user (own profile only).
    uploaded, _pending = await _upload_files(ctx=ctx, kind="avatars", files=files, entity_id=ctx.user_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Avatar uploaded")


@router.post("/uploads/projects", status_code=status.HTTP_201_CREATED, summary="Upload project media")
async def upload_project_files(ctx: CallerContext, files: list[UploadFile] = File(...), project_id: Optional[str] = None, _=Depends(require_permission("projects", "edit"))):
    uploaded, _pending = await _upload_files(ctx=ctx, kind="projects", files=files, entity_id=project_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Project media uploaded")


@router.post("/uploads/tours", status_code=status.HTTP_201_CREATED, summary="Upload tour panorama media")
async def upload_tour_files(ctx: CallerContext, files: list[UploadFile] = File(...), tour_id: Optional[str] = None, _=Depends(require_permission("tours", "create"))):
    uploaded, _pending = await _upload_files(ctx=ctx, kind="tours", files=files, entity_id=tour_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Tour media uploaded")


@router.get("/tours", summary="List tours")
async def list_tours(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "tours", ctx, skip, limit, filters))


@router.post("/tours", status_code=status.HTTP_201_CREATED, summary="Generate tour")
async def create_tour(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "create"))):
    capture_id = payload.get("captureId") or payload.get("capture_id")
    if capture_id:
        capture = await db["captures"].find_one({"_id": _id_filter(capture_id), "orgId": ctx.org_id})
        if capture:
            assets = capture.get("mediaAssets") or capture.get("media_assets") or []
            panorama_urls = [
                asset.get("processed_panorama_url") or asset.get("original_file_url") or asset.get("original_url")
                for asset in assets
                if asset.get("processed_panorama_url") or asset.get("original_file_url") or asset.get("original_url")
            ]
            if panorama_urls:
                payload["panoramaUrls"] = panorama_urls
                payload["panorama_urls"] = panorama_urls
                payload["processedPanoramaUrl"] = panorama_urls[0]
                payload["processed_panorama_url"] = panorama_urls[0]
                payload["thumbnailUrl"] = (assets[0].get("thumbnail_url") or assets[0].get("preview_url"))
                payload["thumbnail_url"] = payload["thumbnailUrl"]
    return success_response(data=await _upsert(db, "tours", payload, ctx), message="Tour generated")


@router.get("/tours/{tour_id}", summary="Get tour")
async def get_tour(tour_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _get(db, "tours", tour_id, ctx))


@router.put("/tours/{tour_id}/status", summary="Update tour status")
async def update_tour_status(tour_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "publish"))):
    return success_response(data=await _patch(db, "tours", tour_id, payload, ctx), message="Tour status updated")


@router.delete("/tours/{tour_id}", summary="Delete tour")
async def delete_tour(tour_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "delete"))):
    await _delete(db, "tours", tour_id, ctx)
    return success_response(message="Tour deleted")


@router.post("/floor-plans", status_code=status.HTTP_201_CREATED, summary="Upload floor plan")
async def create_floor_plan(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("floorPlans", "create"))):
    asset = (payload.get("mediaAssets") or payload.get("media_assets") or [None])[0]
    if asset:
        payload["file_url"] = asset.get("original_url")
        payload["fileUrl"] = asset.get("original_url")
        payload["thumbnail_url"] = asset.get("thumbnail_url")
        payload["thumbnailUrl"] = asset.get("thumbnail_url")
        payload["public_id"] = asset.get("public_id")
        payload["format"] = asset.get("format")
        payload["size"] = asset.get("size")
        payload["uploaded_at"] = asset.get("uploaded_at")
        payload["page_count"] = asset.get("pages") or 1
        payload["pageCount"] = payload["page_count"]
        width = asset.get("width")
        height = asset.get("height")
        payload["dimensions"] = {"width": width, "height": height} if width and height else None
    result = await _upsert(db, "floor_plans", payload, ctx)

    # Room map extraction runs once per upload/replace, synchronously, so the
    # floor plan is guaranteed to have a room map by the time any report is
    # requested — never re-run during report generation (see RoomMapService).
    image_url = result.get("file_url") or result.get("fileUrl")
    if image_url:
        await RoomMapService(db).ensure_room_map(
            floor_plan_id=result["id"],
            org_id=ctx.org_id,
            image_url=image_url,
        )

    return success_response(data=result, message="Floor plan uploaded")


@router.post("/floor-plans/{floor_plan_id}/analyze-rooms", summary="Re-run room map extraction for a floor plan")
async def reanalyze_floor_plan_rooms(
    floor_plan_id: str,
    ctx: CallerContext,
    db: DB,
    _=Depends(require_permission("floorPlans", "create")),
):
    """Force re-extraction of the room map, e.g. if the AI got it wrong the first time."""
    plan = await _get(db, "floor_plans", floor_plan_id, ctx)
    image_url = plan.get("file_url") or plan.get("fileUrl")
    if not image_url:
        raise ValidationException("Floor plan has no image to analyze")

    room_map = await RoomMapService(db).ensure_room_map(
        floor_plan_id=floor_plan_id,
        org_id=ctx.org_id,
        image_url=image_url,
        force=True,
    )
    return success_response(data=room_map, message="Room map re-analyzed")


@router.delete("/floor-plans/{floor_plan_id}", summary="Delete floor plan")
async def delete_floor_plan(floor_plan_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("floorPlans", "delete"))):
    # Re-uploading a floor plan supersedes the previous record. The client
    # re-points pins onto the new plan and then deletes the stale record here so
    # the snapshot stops returning duplicate (empty) plans for the same floor.
    plan = await db["floor_plans"].find_one({"_id": _id_filter(floor_plan_id), "orgId": ctx.org_id})
    await _delete(db, "floor_plans", floor_plan_id, ctx)
    if plan:
        assets = plan.get("mediaAssets") or plan.get("media_assets") or []
        await delete_media_assets(assets)
    return success_response(message="Floor plan deleted")


async def _link_capture_to_pin_by_room(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    capture: dict[str, Any] | None,
) -> None:
    """Ensure the pin that owns this capture's room lists the capture id.

    Analysis joins floor → pins → captureIds → captures. If createCapture lands
    without a matching updateCapturePin(captureIds), the photo is an orphan in
    the gallery and never enters Construction Progress. Linking by roomId makes
    createCapture alone sufficient. If the pin/room were deleted in a race,
    recreate them so the photo is never stranded.
    """
    if not capture:
        return
    cap_id = str(capture.get("id") or capture.get("_id") or "")
    room_id = str(capture.get("roomId") or capture.get("room_id") or "")
    if not cap_id or not room_id:
        return
    pin = await db["capture_pins"].find_one({
        "orgId": ctx.org_id,
        "$or": [{"roomId": room_id}, {"room_id": room_id}],
    })
    if not pin:
        # Infer floorId from roomId prefix (t72554-f3-f72557-flat-a-rN → floor).
        parts = room_id.split("-")
        floor_id = "-".join(parts[:3]) if len(parts) >= 3 else ""
        if floor_id:
            from app.services.pin_orphan_service import restore_orphan_pins_for_floor
            await restore_orphan_pins_for_floor(
                db, org_id=ctx.org_id, floor_id=floor_id, resequence=True,
            )
            pin = await db["capture_pins"].find_one({
                "orgId": ctx.org_id,
                "$or": [{"roomId": room_id}, {"room_id": room_id}],
            })
        if not pin:
            return
    pin_id = pin.get("_id") or pin.get("id")
    if not pin_id:
        return
    await db["capture_pins"].update_one(
        {"_id": pin_id, "orgId": ctx.org_id},
        {"$addToSet": {"captureIds": cap_id}, "$set": {"updatedAt": _now()}},
    )


async def _resequence_pins_on_plan(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    floor_plan_id: str,
) -> None:
    """Renumber remaining pins on a floor plan to 1..N after a delete.

    Client deleteCapturePin already renumbers; server-side delete did not, which
    left permanent gaps (pins 2–14 with no Pin 1) after any path that deleted
    without going through the client helper.
    """
    from app.services.pin_orphan_service import resequence_pins_on_plan
    await resequence_pins_on_plan(db, org_id=ctx.org_id, floor_plan_id=floor_plan_id)


# ── Capture Pins ────────────────────────────────────────────────────────────
@router.get("/floor-plans/{floor_plan_id}/pins", summary="List capture pins for a floor plan")
async def list_capture_pins(floor_plan_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(
        db, "capture_pins", ctx,
        extra_filter={"floorPlanId": floor_plan_id},
        sort=[("sequenceNumber", 1)],
    ))


# Capture pins are managed as part of the capture workflow, so they follow the
# same permission family as captures (field engineers create/move/delete pins).
@router.post("/floor-plans/{floor_plan_id}/pins", status_code=status.HTTP_201_CREATED, summary="Create capture pin")
async def create_capture_pin(floor_plan_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "create"))):
    payload.setdefault("floorPlanId", floor_plan_id)
    return success_response(data=await _upsert(db, "capture_pins", payload, ctx), message="Capture pin created")


@router.put("/pins/{pin_id}", summary="Update capture pin")
async def update_capture_pin(pin_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "edit"))):
    return success_response(data=await _patch(db, "capture_pins", pin_id, payload, ctx), message="Capture pin updated")


@router.delete("/pins/{pin_id}", summary="Delete capture pin")
async def delete_capture_pin(pin_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "delete"))):
    # Cascade: removing a pin must also remove its capture timeline. Otherwise
    # orphaned captures stay in Mongo and reappear in Media Library / snapshot.
    pin = await db["capture_pins"].find_one({"_id": _id_filter(pin_id), "orgId": ctx.org_id})
    if not pin:
        raise NotFoundException("capture pin", pin_id)
    floor_plan_id = str(pin.get("floorPlanId") or pin.get("floor_plan_id") or "")
    capture_ids = [
        cid for cid in (pin.get("captureIds") or pin.get("capture_ids") or [])
        if isinstance(cid, str) and cid
    ]
    room_id = pin.get("roomId") or pin.get("room_id")
    for cid in capture_ids:
        cap = await db["captures"].find_one({"_id": _id_filter(cid), "orgId": ctx.org_id})
        await db["captures"].delete_one({"_id": _id_filter(cid), "orgId": ctx.org_id})
        if cap:
            await _release_capture_assets(db, ctx, cap.get("mediaAssets") or cap.get("media_assets") or [])
        try:
            purged = await AIProgressService(db).purge_for_timeline(ctx.org_id, cid)
            if purged:
                logger.info("Pin {} cascade: purged {} progress analyses for capture {}", pin_id, purged, cid)
        except Exception:
            logger.exception("Failed to purge progress analyses for capture {} during pin delete {}", cid, pin_id)
    if room_id:
        room_captures = await db["captures"].find({"orgId": ctx.org_id, "roomId": str(room_id)}).to_list(length=None)
        await db["captures"].delete_many({"orgId": ctx.org_id, "roomId": str(room_id)})
        for cap in room_captures:
            await _release_capture_assets(db, ctx, cap.get("mediaAssets") or cap.get("media_assets") or [])
        await db["rooms"].delete_one({"_id": _id_filter(str(room_id)), "orgId": ctx.org_id})
    await _delete(db, "capture_pins", pin_id, ctx)
    await _resequence_pins_on_plan(db, ctx, floor_plan_id)
    return success_response(message="Capture pin deleted")


@router.get("/defects", summary="List defects")
async def list_defects(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "defects", ctx, skip, limit, filters))


@router.post("/defects", status_code=status.HTTP_201_CREATED, summary="Create defect")
async def create_defect(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("defects", "create"))):
    return success_response(data=await _upsert(db, "defects", payload, ctx), message="Defect created")


@router.put("/defects/{defect_id}", summary="Update defect")
async def update_defect(defect_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("defects", "edit"))):
    return success_response(data=await _patch(db, "defects", defect_id, payload, ctx), message="Defect updated")


@router.get("/notifications", summary="List notifications")
async def list_notifications(ctx: CallerContext, db: DB, skip: int = 0, limit: int = 100, read: Optional[bool] = None):
    filters = {"read": read} if read is not None else None
    return success_response(data=await _list(db, "notifications", ctx, skip, limit, filters))


@router.post("/notifications", status_code=status.HTTP_201_CREATED, summary="Create notification")
async def create_notification(payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _upsert(db, "notifications", payload, ctx), message="Notification created")


@router.put("/notifications/{notification_id}/read", summary="Mark notification read")
async def mark_notification_read(notification_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "notifications", notification_id, {"read": True}, ctx))


@router.put("/notifications/read-all", summary="Mark all notifications read")
async def mark_all_notifications_read(ctx: CallerContext, db: DB):
    await db["notifications"].update_many({"orgId": ctx.org_id}, {"$set": {"read": True, "updatedAt": _now()}})
    return success_response(message="Notifications marked read")


@router.delete("/notifications/{notification_id}", summary="Dismiss notification")
async def delete_notification(notification_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "notifications", notification_id, ctx)
    return success_response(message="Notification dismissed")


@router.get("/notifications/unread-count", summary="Get unread notification count")
async def unread_notification_count(ctx: CallerContext, db: DB):
    count = await db["notifications"].count_documents({"orgId": ctx.org_id, "read": False})
    return success_response(data={"count": count})


@router.get("/audit-logs", summary="List project audit logs")
async def list_audit_logs(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100, _=Depends(require_permission("auditLogs", "view"))):
    """Project activity only. Security/identity events (logins, registrations,
    user changes) are excluded — logins alone outnumber every project event, so
    including them buries the construction activity this feed exists to show.
    Read those through `/audit-logs/security` instead."""
    filters: dict[str, Any] = dict(_PROJECT_AUDIT_FILTER)
    if project_id:
        filters["projectId"] = project_id
    return success_response(data=await _list(db, "audit_logs", ctx, skip, limit, filters))


@router.get("/audit-logs/security", summary="List security/identity audit logs")
async def list_security_audit_logs(
    ctx: CallerContext,
    db: DB,
    skip: int = 0,
    limit: int = 100,
    action: Optional[str] = None,
    _=Depends(require_permission("auditLogs", "view")),
):
    """Logins, registrations, user and organization changes — the identity trail,
    kept separate from the project activity feed. Optionally filter by `action`
    (e.g. USER_LOGIN)."""
    filters: dict[str, Any] = {"logCategory": SECURITY_CATEGORY}
    if action:
        filters["action"] = action
    return success_response(data=await _list(db, "audit_logs", ctx, skip, limit, filters))


@router.post("/audit-logs", status_code=status.HTTP_201_CREATED, summary="Create audit log")
async def create_audit_log(payload: dict[str, Any], ctx: CallerContext, db: DB):
    """
    Record one audit event. Identity and timestamp are stamped from the
    authenticated request and always overwrite whatever the client sent.

    An audit trail the client can fill in freely is not a trail: this endpoint
    used to store the payload verbatim, and the client sent
    actorId="u1" / actorName="You" / createdAt="Just now" — a literal string,
    not a timestamp. Every entry was therefore unsortable and attributed to
    nobody, which is precisely why a run of disappearing captures could not be
    traced through the log and had to be reconstructed from storage side
    effects instead.
    """
    now = datetime.now(timezone.utc)
    payload["actorId"] = ctx.user_id
    payload["actorRole"] = ctx.role
    payload["createdAt"] = now.isoformat()
    payload["created_at"] = now.isoformat()

    # Resolve a human-readable actor once, so the feed does not have to join
    # against users (and still reads correctly if the user is later removed).
    try:
        user = await db["users"].find_one(
            {"_id": _id_filter(ctx.user_id)}, {"name": 1, "email": 1, "full_name": 1}
        )
    except Exception as exc:  # never let enrichment break the write
        logger.warning(f"[audit] actor lookup failed for {ctx.user_id}: {exc!r}")
        user = None
    if user:
        payload["actorName"] = user.get("name") or user.get("full_name") or user.get("email") or ctx.user_id
        payload["actorEmail"] = user.get("email")
    else:
        payload.setdefault("actorName", ctx.user_id)

    return success_response(data=await _upsert(db, "audit_logs", payload, ctx), message="Audit log created")


@router.get("/admin/media", summary="Get media storage dashboard stats")
async def media_dashboard(ctx: CallerContext, db: DB):
    captures = await db["captures"].find({"orgId": ctx.org_id}).to_list(length=1000)
    floor_plans = await db["floor_plans"].find({"orgId": ctx.org_id}).to_list(length=1000)
    tours = await db["tours"].find({"orgId": ctx.org_id}).to_list(length=1000)

    all_assets: list[dict[str, Any]] = []
    for capture in captures:
        all_assets.extend(capture.get("mediaAssets") or capture.get("media_assets") or [])
    for plan in floor_plans:
        all_assets.extend(plan.get("mediaAssets") or plan.get("media_assets") or [])

    failed = [
        asset for asset in all_assets
        if asset.get("processing_status") in {"failed", "error"} or asset.get("processingStatus") in {"failed", "error"}
    ]
    recent = sorted(all_assets, key=lambda a: a.get("uploaded_at") or "", reverse=True)[:10]
    storage_bytes = sum(int(asset.get("size") or 0) for asset in all_assets)

    return success_response(data={
        "storageBytes": storage_bytes,
        "totalCaptures": len(captures),
        "totalPanoramas": sum(len(c.get("mediaAssets") or c.get("media_assets") or []) for c in captures),
        "failedProcessing": len(failed),
        "recentUploads": recent,
        "totalTours": len(tours),
        "totalFloorPlans": len(floor_plans),
    })
