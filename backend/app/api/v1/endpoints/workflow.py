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
from app.core.dependencies import CallerContext, DB, require_admin
from app.core.exceptions import ForbiddenException, NotFoundException, ValidationException
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
from app.services.construction_progress_service import ConstructionProgressService
from app.services.predefined_pins_service import PredefinedPinsService
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


async def _resolve_user_display_name(db: AsyncIOMotorDatabase, user_id: str) -> str:
    """Human-readable name for attribution fields (captures, floor plans, audit)."""
    try:
        user = await db["users"].find_one(
            {"_id": _id_filter(user_id)}, {"name": 1, "email": 1, "full_name": 1}
        )
    except Exception as exc:  # never block the write on lookup failure
        logger.warning(f"[workflow] user lookup failed for {user_id}: {exc!r}")
        return user_id
    if not user:
        return user_id
    return (
        (user.get("name") or user.get("full_name") or user.get("email") or user_id)
    )


async def _user_display_aliases(db: AsyncIOMotorDatabase, user_id: str) -> list[str]:
    """Known legacy uploader strings for this user.

    Older records may have been stamped with name, full_name, or email before we
    standardized on uploadedByUserId. Use all non-empty variants for safe
    same-user backfill.
    """
    try:
        user = await db["users"].find_one(
            {"_id": _id_filter(user_id)}, {"name": 1, "email": 1, "full_name": 1}
        )
    except Exception as exc:  # never block reads on alias lookup failure
        logger.warning(f"[workflow] alias lookup failed for {user_id}: {exc!r}")
        return [user_id]
    if not user:
        return [user_id]
    aliases: list[str] = []
    for value in (user.get("name"), user.get("full_name"), user.get("email"), user_id):
        text = str(value or "").strip()
        if text and text not in aliases:
            aliases.append(text)
    return aliases


def _stamp_uploader(payload: dict[str, Any], display_name: str, user_id: str | None = None) -> None:
    """Overwrite client placeholders like 'You' with the authenticated actor."""
    payload["uploadedBy"] = display_name
    payload["uploaded_by"] = display_name
    if user_id:
        payload["uploadedByUserId"] = user_id
        payload["uploaded_by_user_id"] = user_id


def _is_field_engineer(ctx: CallerContext) -> bool:
    return str(ctx.role or "") == "field_engineer"


def _own_captures_filter(ctx: CallerContext, display_name: str | None = None) -> dict[str, Any] | None:
    """Field engineers only receive their own capture documents.

    Labeled capture *points* stay org-shared; photos/history do not.
    """
    if not _is_field_engineer(ctx):
        return None
    uid = str(ctx.user_id or "").strip()
    clauses: list[dict[str, Any]] = [
        {"uploadedByUserId": uid},
        {"uploaded_by_user_id": uid},
    ]
    name = (display_name or "").strip()
    if name:
        # Legacy captures predating uploadedByUserId.
        clauses.append({
            "$and": [
                {"uploadedByUserId": {"$exists": False}},
                {"uploaded_by_user_id": {"$exists": False}},
                {"$or": [{"uploadedBy": name}, {"uploaded_by": name}]},
            ]
        })
    return {"$or": clauses}


def _legacy_uploader_match(aliases: list[str]) -> dict[str, Any] | None:
    names = [a.strip() for a in aliases if str(a).strip()]
    if not names:
        return None
    return {
        "$and": [
            {"uploadedByUserId": {"$exists": False}},
            {"uploaded_by_user_id": {"$exists": False}},
            {"$or": [{"uploadedBy": {"$in": names}}, {"uploaded_by": {"$in": names}}]},
        ]
    }


async def _backfill_legacy_uploader_records(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    collection: str,
    aliases: list[str],
) -> None:
    """Stamp this engineer's legacy records with uploadedByUserId on read.

    This is a one-time healing step for historical captures/tours created before
    owner ids were stored. It only claims records in the same org whose
    uploader string matches one of this user's known historical aliases.
    """
    if not _is_field_engineer(ctx):
        return
    uid = str(ctx.user_id or "").strip()
    if not uid:
        return
    match = _legacy_uploader_match(aliases)
    if not match:
        return
    try:
        await db[collection].update_many(
            {"orgId": ctx.org_id, **match},
            {
                "$set": {
                    "uploadedByUserId": uid,
                    "uploaded_by_user_id": uid,
                    "updatedAt": _now(),
                }
            },
        )
    except Exception:
        logger.exception(
            "[workflow] failed legacy uploader backfill org={} user={} collection={}",
            ctx.org_id,
            uid,
            collection,
        )


async def _backfill_legacy_tours_from_capture_ownership(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    aliases: list[str],
) -> None:
    """Claim legacy tours whose linked captures already belong to this engineer."""
    if not _is_field_engineer(ctx):
        return
    uid = str(ctx.user_id or "").strip()
    if not uid:
        return
    own_caps = _own_captures_filter(ctx, aliases[0] if aliases else None)
    if not own_caps:
        return
    capture_ids = {
        str(doc.get("_id") or doc.get("id"))
        for doc in await db["captures"]
        .find({"orgId": ctx.org_id, **own_caps}, {"_id": 1, "id": 1})
        .to_list(length=5000)
        if str(doc.get("_id") or doc.get("id") or "").strip()
    }
    if not capture_ids:
        return
    legacy_tours = await db["tours"].find(
        {
            "orgId": ctx.org_id,
            "uploadedByUserId": {"$exists": False},
            "uploaded_by_user_id": {"$exists": False},
        },
        {"_id": 1, "id": 1, "captureId": 1, "capture_id": 1, "steps": 1},
    ).to_list(length=2000)
    for tour in legacy_tours:
        linked_ids = {
            str(tour.get("captureId") or tour.get("capture_id") or "").strip()
        }
        for step in tour.get("steps") or []:
            if not isinstance(step, dict):
                continue
            cid = str(step.get("captureId") or step.get("capture_id") or "").strip()
            if cid:
                linked_ids.add(cid)
        linked_ids.discard("")
        if not (linked_ids & capture_ids):
            continue
        try:
            await db["tours"].update_one(
                {"_id": tour["_id"], "orgId": ctx.org_id},
                {
                    "$set": {
                        "uploadedByUserId": uid,
                        "uploaded_by_user_id": uid,
                        "updatedAt": _now(),
                    }
                },
            )
        except Exception:
            logger.exception(
                "[workflow] failed capture-linked tour backfill org={} user={} tour={}",
                ctx.org_id,
                uid,
                tour.get("_id"),
            )


def _capture_owner_id(doc: dict[str, Any]) -> str:
    return str(doc.get("uploadedByUserId") or doc.get("uploaded_by_user_id") or "").strip()


def _notification_owner_filter(ctx: CallerContext) -> dict[str, Any]:
    uid = str(ctx.user_id or "").strip()
    return {
        "$or": [
            {"recipientUserId": uid},
            {"recipient_user_id": uid},
            {"userId": uid},
            {"user_id": uid},
        ]
    }


def _assert_can_access_capture(ctx: CallerContext, doc: dict[str, Any], display_name: str = "") -> None:
    if not _is_field_engineer(ctx):
        return
    owner = _capture_owner_id(doc)
    if owner and owner == str(ctx.user_id):
        return
    if not owner:
        by = str(doc.get("uploadedBy") or doc.get("uploaded_by") or "").strip()
        if display_name and by == display_name:
            return
    raise ForbiddenException("You can only access your own captures")


def _own_tours_filter(ctx: CallerContext, display_name: str | None = None) -> dict[str, Any] | None:
    """Field engineers only receive tours they published."""
    return _own_captures_filter(ctx, display_name)


def _tour_owner_id(doc: dict[str, Any]) -> str:
    return _capture_owner_id(doc)


def _assert_can_access_tour(ctx: CallerContext, doc: dict[str, Any], display_name: str = "") -> None:
    if not _is_field_engineer(ctx):
        return
    owner = _tour_owner_id(doc)
    if owner and owner == str(ctx.user_id):
        return
    if not owner:
        by = str(doc.get("uploadedBy") or doc.get("uploaded_by") or "").strip()
        if display_name and by == display_name:
            return
    raise ForbiddenException("You can only access your own tours")


async def _own_capture_ids_for_ctx(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    display_name: str | None = None,
) -> set[str] | None:
    if not _is_field_engineer(ctx):
        return None
    aliases = await _user_display_aliases(db, ctx.user_id)
    await _backfill_legacy_uploader_records(db, ctx, "captures", aliases)
    name = display_name if display_name is not None else await _resolve_user_display_name(db, ctx.user_id)
    own = _own_captures_filter(ctx, name)
    docs = await db["captures"].find(
        {"orgId": ctx.org_id, **(own or {})},
        {"_id": 1, "id": 1},
    ).to_list(length=5000)
    return {
        str(doc.get("_id") or doc.get("id") or "").strip()
        for doc in docs
        if str(doc.get("_id") or doc.get("id") or "").strip()
    }


def _pin_capture_ids(doc: dict[str, Any]) -> list[str]:
    return [
        cid for cid in (doc.get("captureIds") or doc.get("capture_ids") or [])
        if isinstance(cid, str) and cid
    ]


def _scope_pin_doc_to_capture_ids(doc: dict[str, Any], own_capture_ids: set[str] | None) -> dict[str, Any]:
    if own_capture_ids is None:
        return doc
    scoped = dict(doc)
    filtered = [cid for cid in _pin_capture_ids(doc) if cid in own_capture_ids]
    scoped["captureIds"] = filtered
    scoped["capture_ids"] = filtered
    return scoped


async def _assert_capture_ids_owned(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    capture_ids: list[str],
    display_name: str,
) -> None:
    if not _is_field_engineer(ctx):
        return
    for cid in capture_ids:
        cap = await db["captures"].find_one({"_id": _id_filter(cid), "orgId": ctx.org_id})
        if not cap:
            continue
        _assert_can_access_capture(ctx, cap, display_name)


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
        "uploadedByUserId": "uploaded_by_user_id",
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
# rather than writing a second copy of a ~13MB payload. Spool lives under
# UPLOAD_ROOT so multi-worker hosts sharing that volume can recover orphans.
def _spool_raw_upload(dedup_key: str, raw_bytes: bytes, ext: str) -> Path:
    from app.services.local_media_service import ensure_upload_root

    spool_dir = ensure_upload_root() / "stitch-spool"
    spool_dir.mkdir(parents=True, exist_ok=True)
    safe_name = dedup_key.rsplit(":", 1)[-1]
    path = spool_dir / f"{safe_name}{ext or '.bin'}"
    if not path.exists():
        path.write_bytes(raw_bytes)
    return path


def _asset_has_real_media(asset: Optional[dict[str, Any]]) -> bool:
    """True when an asset payload has a durable public_id and a viewable URL."""
    if not asset:
        return False
    if not asset.get("public_id"):
        return False
    url = (
        asset.get("processed_panorama_url")
        or asset.get("original_url")
        or asset.get("original_file_url")
    )
    return bool(url)


_PROCESSING_BLOCKED_FOR_TOUR = frozenset({"processing", "pending", "queued", "failed", "error"})


def _capture_media_assets(capture: dict[str, Any]) -> list[dict[str, Any]]:
    raw = capture.get("mediaAssets") or capture.get("media_assets") or []
    return [a for a in raw if isinstance(a, dict)]


def _capture_panorama_url(capture: dict[str, Any]) -> str | None:
    for asset in _capture_media_assets(capture):
        url = (
            asset.get("processed_panorama_url")
            or asset.get("original_file_url")
            or asset.get("original_url")
        )
        if url:
            return str(url)
    for key in ("processedPanoramaUrl", "processed_panorama_url", "original_url"):
        val = capture.get(key)
        if val:
            return str(val)
    return None


def _capture_processing_status(capture: dict[str, Any]) -> str:
    st = capture.get("processingStatus") or capture.get("processing_status")
    if st:
        return str(st).lower()
    assets = _capture_media_assets(capture)
    if assets:
        a0 = assets[0]
        return str(a0.get("processingStatus") or a0.get("processing_status") or "uploaded").lower()
    return "uploaded"


def _assert_capture_publishable(
    ctx: CallerContext,
    capture: dict[str, Any],
    display_name: str,
    *,
    capture_id_label: str,
) -> None:
    _assert_can_access_capture(ctx, capture, display_name)
    status = _capture_processing_status(capture)
    if status in _PROCESSING_BLOCKED_FOR_TOUR:
        raise ValidationException(
            f"Capture {capture_id_label} is not ready for tour publish (status={status})"
        )
    if not _capture_panorama_url(capture):
        raise ValidationException(f"Capture {capture_id_label} has no panorama URL")


async def _validate_tour_capture_refs(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    payload: dict[str, Any],
    display_name: str,
) -> None:
    """Every capture referenced by a tour (top-level or steps[]) must be owned and publishable."""
    capture_ids: list[str] = []
    top = payload.get("captureId") or payload.get("capture_id")
    if top:
        capture_ids.append(str(top))
    steps = payload.get("steps") or []
    if steps is not None and not isinstance(steps, list):
        raise ValidationException("Tour steps must be an array")
    for i, step in enumerate(steps or []):
        if not isinstance(step, dict):
            raise ValidationException(f"Tour step {i + 1} must be an object")
        cid = step.get("captureId") or step.get("capture_id")
        if not cid:
            raise ValidationException(f"Tour step {i + 1} missing captureId")
        capture_ids.append(str(cid))
    seen: set[str] = set()
    for cid in capture_ids:
        if cid in seen:
            continue
        seen.add(cid)
        cap = await db["captures"].find_one({"_id": _id_filter(cid), "orgId": ctx.org_id})
        if not cap:
            raise ValidationException(f"Capture {cid} not found")
        _assert_capture_publishable(ctx, cap, display_name, capture_id_label=cid)
    tour_status = str(payload.get("status") or "").lower()
    if tour_status == "published":
        for i, step in enumerate(steps or []):
            if not isinstance(step, dict):
                continue
            pano = step.get("panoramaUrl") or step.get("panorama_url")
            if not pano:
                raise ValidationException(f"Tour step {i + 1} missing panoramaUrl")


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

    Raw 360 files (.dng/.insp/.insv) are STITCHED into an equirectangular
    JPEG (default ~8K @ high quality; see STITCH_OUTPUT_* settings) before
    storage, and a plain capture JPEG that's still over Cloudinary's cap gets
    re-encoded down to fit (see panorama_service.ensure_under_size) — both
    cases get a larger pre-check cap here because only the FINAL bytes need
    to fit Cloudinary's limit when that backend is used, not whatever the
    camera originally handed us."""
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


def _dedup_asset_matches_capture_storage(asset: dict[str, Any]) -> bool:
    """
    When captures are routed to local disk, refuse to reuse a Cloudinary-only
    dedup cache entry — otherwise a re-upload of the same bytes never lands
    under UPLOAD_ROOT (hybrid MEDIA_STORAGE=local + floorplans→Cloudinary).
    """
    from app.services.cloudinary_service import _resolve_media_storage
    from app.services.local_media_service import is_local_public_id

    preferred = _resolve_media_storage(folder="SiteVision/captures")
    if preferred != "local":
        return True
    storage = (asset.get("storage") or "").lower()
    if storage == "local" or is_local_public_id(asset.get("public_id")):
        return True
    url = str(asset.get("original_url") or "")
    if url.startswith("/media/") or "/media/" in url.split("?", 1)[0]:
        return True
    return False


async def _dedup_asset_is_live(asset: dict[str, Any]) -> bool:
    """
    True only if the cached asset's file is still actually fetchable.

    Local assets: confirm the file still exists under UPLOAD_ROOT.
    Cloudinary assets: confirm the URL belongs to the configured account and
    the Admin API (or delivery HEAD) still sees it. The dedup cache is keyed
    on a hash of the raw bytes and never expires, but the backing file can
    vanish independently — reusing a cache entry is only safe once we know
    the URL it points to is real.
    """
    url = asset.get("original_url")
    if not url:
        return False

    from app.services.local_media_service import is_local_public_id, local_asset_exists

    public_id = asset.get("public_id")
    storage = asset.get("storage") or ""
    if storage == "local" or is_local_public_id(public_id):
        return local_asset_exists(public_id)

    cloud_name = get_settings().CLOUDINARY_CLOUD_NAME
    if cloud_name and f"res.cloudinary.com/{cloud_name}/" not in url:
        return False

    # Ask the account, not the CDN edge — a destroyed asset keeps serving over
    # the CDN for a while, and trusting that 200 is how a destroyed asset got
    # handed back from this cache and produced a capture that went dead later.
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


async def _dedup_asset_has_content(asset: dict[str, Any]) -> bool:
    """False when the cached Cloudinary JPEG is blank/near-blank (failed stitch)."""
    url = asset.get("original_url") or asset.get("processed_panorama_url")
    if not url:
        return False
    try:
        from app.services.image_fetch import download_image
        from app.services.panorama_service import panorama_content_is_blank

        raw, _mime = await download_image(url, timeout=20)
        if panorama_content_is_blank(raw):
            logger.warning(
                f"[capture-upload] dedup asset is blank/near-blank "
                f"({asset.get('public_id')}) — treating as unusable"
            )
            return False
        return True
    except Exception as exc:
        logger.warning(f"[capture-upload] dedup content check failed: {exc!r}")
        # Inconclusive — allow reuse rather than forcing a full re-stitch on every
        # transient download blip; liveness already passed.
        return True


async def _dedup_lookup(db: Optional[AsyncIOMotorDatabase], key: str) -> Optional[dict[str, Any]]:
    """Previously-completed result for these exact bytes, if any — verified to
    still be live on Cloudinary and non-blank before being trusted. A dead or
    blank cache entry is dropped so a later upload of the same bytes doesn't
    hit the same bad result again."""
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
    if not _dedup_asset_matches_capture_storage(asset):
        logger.info(
            f"[capture-upload] dedup entry key={key[-12:]} is Cloudinary but captures "
            f"prefer local disk ({asset.get('original_url')}) — discarding cache and re-uploading"
        )
        try:
            await db[_UPLOAD_DEDUP_COLLECTION].delete_one({"_id": key})
        except Exception as exc:
            logger.warning(f"[capture-upload] failed to evict mismatched dedup entry: {exc!r}")
        return None
    if await _dedup_asset_is_live(asset) and await _dedup_asset_has_content(asset):
        return asset
    logger.warning(
        f"[capture-upload] dedup entry key={key[-12:]} points to a dead/blank asset "
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
    # Never cache a blank/corrupt stitch — otherwise the next upload of the same
    # .insp bytes instantly reuses a grey panorama.
    if not await _dedup_asset_has_content(asset):
        logger.warning(
            f"[capture-upload] refusing to cache blank asset key={key[-12:]} "
            f"public_id={asset.get('public_id')}"
        )
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
                    f"key={dedup_key[-12:]} storage={cached.get('storage')} "
                    f"— skipping stitch + re-upload"
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


# Media URL fields that must never be wiped to null by a review/publish patch
# that happens to include a full capture object still mid-stitch.
_CAPTURE_MEDIA_URL_FIELDS = {
    "mediaAssets", "media_assets",
    "original_url", "originalUrl", "originalFileUrl", "original_file_url",
    "processedPanoramaUrl", "processed_panorama_url",
    "thumbnailUrl", "thumbnail_url",
    "previewUrl", "preview_url",
    "public_id",
}

# Allowlists for review/publish/status endpoints — never accept a full client
# document $set (ownership, media, orgId, etc. must stay server-controlled).
_CAPTURE_REVIEW_FIELDS = {
    "status",
    "reviewStatus", "review_status",
    "reviewedBy", "reviewed_by",
    "reviewNotes", "review_notes",
    "assignedTo", "assigned_to",
    "processingStatus", "processing_status",
    # replaceCapture reuses the review endpoint for a narrow metadata reset
    "fileCount", "file_count",
    "sizeMb", "size_mb",
    "uploadedAt", "uploaded_at",
}
_CAPTURE_PUBLISH_FIELDS = {
    "status",
    "reviewStatus", "review_status",
    "processingStatus", "processing_status",
}
_TOUR_STATUS_FIELDS = {
    "status",
    "managerReviewed", "manager_reviewed",
}


async def _patch(
    db: AsyncIOMotorDatabase,
    collection: str,
    id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    *,
    allowed_fields: set[str] | None = None,
) -> dict[str, Any]:
    update = dict(payload)
    if allowed_fields is not None:
        update = {k: v for k, v in update.items() if k in allowed_fields}
    # Review/publish used to $set the entire client capture object — including
    # null processedPanoramaUrl / thumbnailUrl while a stitch was still running,
    # which wiped a good (or pending) panorama out of Mongo. Drop null media
    # fields so review status changes cannot erase images.
    if collection == "captures":
        for key in list(update.keys()):
            if key in _CAPTURE_MEDIA_URL_FIELDS and update[key] is None:
                update.pop(key)
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


async def _list_all_for_snapshot(
    db: AsyncIOMotorDatabase,
    collection: str,
    ctx: CallerContext,
    *,
    extra_filter: Optional[dict[str, Any]] = None,
    page_size: int = 2000,
    sort: Optional[list[tuple[str, int]]] = None,
) -> list[dict[str, Any]]:
    """
    Fetch every matching document for the org snapshot.

    The old hard cap of 500 silently truncated capture_pins / captures (newest
    first), so older floor-plan pins vanished from the UI on every hydrate even
    though they were still in Mongo — observed as pin counts stepping down
    (114 → 82 → 48) with no user deletes.
    """
    query: dict[str, Any] = {"orgId": ctx.org_id, **(extra_filter or {})}
    order = sort or [("createdAt", 1), ("_id", 1)]
    items: list[dict[str, Any]] = []
    skip = 0
    while True:
        cursor = db[collection].find(query).sort(order).skip(skip).limit(page_size)
        batch = [_serialise(d) for d in await cursor.to_list(length=page_size)]
        items.extend(batch)
        if len(batch) < page_size:
            break
        skip += page_size
        # Safety valve — pathological orgs shouldn't hang the request forever.
        if skip >= 50_000:
            logger.error(
                "[workflow-snapshot] truncated collection={} at {} docs org={}",
                collection,
                skip,
                ctx.org_id,
            )
            break
    return items


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
    engineer_name = None
    engineer_aliases: list[str] = []
    if _is_field_engineer(ctx):
        engineer_name = await _resolve_user_display_name(db, ctx.user_id)
        engineer_aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "captures", engineer_aliases)
        await _backfill_legacy_uploader_records(db, ctx, "tours", engineer_aliases)
        await _backfill_legacy_tours_from_capture_ownership(db, ctx, engineer_aliases)
    own_capture_ids: set[str] | None = None
    for key, collection in COLLECTIONS.items():
        # The snapshot feeds the dashboard activity feed, so it carries project
        # activity only — security/identity events are read separately via
        # /audit-logs/security (see _PROJECT_AUDIT_FILTER).
        if collection == "audit_logs" and _is_field_engineer(ctx):
            data[key] = []
            continue
        extra = _PROJECT_AUDIT_FILTER if collection == "audit_logs" else None
        if collection == "captures":
            own = _own_captures_filter(ctx, engineer_name)
            extra = {**(extra or {}), **(own or {})} if (extra or own) else extra
        if collection == "tours":
            own = _own_tours_filter(ctx, engineer_name)
            extra = {**(extra or {}), **(own or {})} if (extra or own) else extra
        if collection == "notifications":
            own = _notification_owner_filter(ctx)
            extra = {**(extra or {}), **own} if extra else own
        # Audit feed stays capped; everything else must be complete so replace
        # hydrate cannot drop pins/captures that still exist on the server.
        if collection == "audit_logs":
            items = (await _list(db, collection, ctx, limit=200, extra_filter=extra))["items"]
        else:
            items = await _list_all_for_snapshot(db, collection, ctx, extra_filter=extra)
        if collection == "captures" and _is_field_engineer(ctx):
            own_capture_ids = {
                str(item.get("id") or "").strip()
                for item in items
                if str(item.get("id") or "").strip()
            }
        if collection == "capture_pins" and _is_field_engineer(ctx):
            items = [_scope_pin_doc_to_capture_ids(item, own_capture_ids or set()) for item in items]
        data[key] = items
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
    engineer_name = await _resolve_user_display_name(db, ctx.user_id) if _is_field_engineer(ctx) else ""
    room_captures = await db["captures"].find({"orgId": ctx.org_id, "roomId": room_id}).to_list(length=None)
    await _assert_capture_ids_owned(
        db,
        ctx,
        [str(cap.get("_id") or cap.get("id") or "") for cap in room_captures if str(cap.get("_id") or cap.get("id") or "").strip()],
        engineer_name,
    )
    await db["captures"].delete_many({"orgId": ctx.org_id, "roomId": room_id})
    for cap in room_captures:
        await _release_capture_assets(db, ctx, cap.get("mediaAssets") or cap.get("media_assets") or [])
        try:
            await AIProgressService(db).purge_for_timeline(ctx.org_id, cap["_id"])
        except Exception:
            logger.exception("Failed to purge progress analyses for room-delete capture {}", cap["_id"])
        try:
            await ConstructionProgressService(db).purge_snapshots_citing_capture(ctx.org_id, cap["_id"])
        except Exception:
            logger.exception("Failed to purge progress snapshots for room-delete capture {}", cap["_id"])
    await _delete(db, "rooms", room_id, ctx)
    return success_response(message="Room deleted")


@router.get("/captures", summary="List captures")
async def list_captures(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters: dict[str, Any] = {}
    if project_id:
        filters["projectId"] = project_id
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "captures", aliases)
        name = await _resolve_user_display_name(db, ctx.user_id)
        own = _own_captures_filter(ctx, name)
        if own:
            filters = {**filters, **own} if filters else own
    return success_response(data=await _list(db, "captures", ctx, skip, limit, filters or None))


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

    # Fill empty project/tower/floor labels from room → pin → floor plan hierarchy.
    # Predefined-pin rooms used to omit towerId/projectId, which produced gallery
    # labels like "· · Floor 2".
    await _enrich_capture_location_fields(db, ctx, payload)

    # Attribution is server-owned: clients historically sent uploadedBy="You".
    display_name = await _resolve_user_display_name(db, ctx.user_id)
    _stamp_uploader(payload, display_name, ctx.user_id)

    # Media fields are server-owned once written: a late client replay carrying
    # nulls must never clobber a panorama the stitch job produced. But when this
    # request already carries a *completed* stitch asset (real public_id + URL),
    # we must $set those fields — otherwise a placeholder inserted earlier can
    # never be healed (insert_only would leave null panoramas forever).
    media_insert_only = {
        "mediaAssets", "media_assets",
        "processingStatus", "processing_status",
        "original_url", "originalFileUrl",
        "processedPanoramaUrl", "processed_panorama_url",
        "thumbnail_url", "thumbnailUrl", "previewUrl",
        "public_id", "format", "size", "uploaded_at",
    }
    if _asset_has_real_media(first_asset if isinstance(first_asset, dict) else None):
        media_insert_only = set()

    stored = await _upsert_preserving(
        db,
        "captures",
        payload,
        ctx,
        insert_only_fields=media_insert_only,
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
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "captures", aliases)
    doc = await _get(db, "captures", capture_id, ctx)
    name = await _resolve_user_display_name(db, ctx.user_id) if _is_field_engineer(ctx) else ""
    _assert_can_access_capture(ctx, doc, name)
    return success_response(data=doc)


@router.put("/captures/{capture_id}/review", summary="Update capture review")
async def update_capture_review(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "approve"))):
    # Clients historically $set the entire capture document; only review fields
    # may change here so a crafted body cannot overwrite media, ownership, etc.
    return success_response(
        data=await _patch(db, "captures", capture_id, payload, ctx, allowed_fields=_CAPTURE_REVIEW_FIELDS),
        message="Capture review updated",
    )


@router.put("/captures/{capture_id}/publish", summary="Publish or unpublish capture")
async def publish_capture(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "approve"))):
    return success_response(
        data=await _patch(db, "captures", capture_id, payload, ctx, allowed_fields=_CAPTURE_PUBLISH_FIELDS),
        message="Capture publish state updated",
    )


@router.delete("/captures/{capture_id}", summary="Delete capture")
async def delete_capture(capture_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "delete"))):
    # Fetch first so we still have its mediaAssets (Cloudinary public_id/
    # resource_type) after the Mongo document is gone — deleting the doc
    # without this left the actual image orphaned on Cloudinary forever.
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "captures", aliases)
    capture = await db["captures"].find_one({"_id": _id_filter(capture_id), "orgId": ctx.org_id})
    if capture:
        name = await _resolve_user_display_name(db, ctx.user_id) if _is_field_engineer(ctx) else ""
        _assert_can_access_capture(ctx, capture, name)
    await _delete(db, "captures", capture_id, ctx)
    # Keep pin timelines clean even if the client never follows up with
    # updateCapturePin — dangling ids made copy-from treat pins as "has captures".
    # Do NOT delete the pin itself: capture points stay on the plan so the
    # engineer can re-upload at the same annotated location.
    await db["capture_pins"].update_many(
        {"orgId": ctx.org_id, "captureIds": capture_id},
        {"$pull": {"captureIds": capture_id}, "$set": {"updatedAt": _now()}},
    )
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
    # Also drop any construction-progress snapshot whose evidence cites this
    # capture — otherwise the floor keeps reporting a stale, non-zero percent
    # sourced from a capture that no longer exists (confirmed in production:
    # two floors with zero real captures still showed 4.1%/3.0% progress).
    try:
        snap_purged = await ConstructionProgressService(db).purge_snapshots_citing_capture(ctx.org_id, capture_id)
        if snap_purged:
            logger.info("Capture {} deleted with {} stale progress snapshot(s) purged", capture_id, snap_purged)
    except Exception:
        logger.exception("Failed to purge progress snapshots for deleted capture {}", capture_id)
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


@router.post("/uploads/captures/jobs/{job_id}/retry", summary="Retry a failed stitch using retained raw file")
async def retry_capture_stitch_job(job_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "upload"))):
    svc = CaptureStitchService(db)
    existing = await svc.get_job(org_id=ctx.org_id, job_id=job_id)
    if not existing:
        raise NotFoundException("stitch job", job_id)
    try:
        job = await svc.retry_job(org_id=ctx.org_id, job_id=job_id)
    except KeyError:
        raise NotFoundException("stitch job", job_id) from None
    return success_response(data=job, message="Stitch retry queued")


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
    filters: dict[str, Any] = {}
    if project_id:
        filters["projectId"] = project_id
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "tours", aliases)
        await _backfill_legacy_tours_from_capture_ownership(db, ctx, aliases)
        name = await _resolve_user_display_name(db, ctx.user_id)
        own = _own_tours_filter(ctx, name)
        if own:
            filters = {**filters, **own} if filters else own
    return success_response(data=await _list(db, "tours", ctx, skip, limit, filters or None))


@router.post("/tours", status_code=status.HTTP_201_CREATED, summary="Generate tour")
async def create_tour(payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "create"))):
    display_name = await _resolve_user_display_name(db, ctx.user_id)
    await _validate_tour_capture_refs(db, ctx, payload, display_name)
    capture_id = payload.get("captureId") or payload.get("capture_id")
    if capture_id:
        capture = await db["captures"].find_one({"_id": _id_filter(capture_id), "orgId": ctx.org_id})
        if capture:
            assets = _capture_media_assets(capture)
            panorama_urls = [
                url for url in (_capture_panorama_url(capture),)
                if url
            ]
            if not panorama_urls:
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
                if assets:
                    payload["thumbnailUrl"] = (assets[0].get("thumbnail_url") or assets[0].get("preview_url"))
                    payload["thumbnail_url"] = payload["thumbnailUrl"]
    _stamp_uploader(payload, display_name, ctx.user_id)
    return success_response(data=await _upsert(db, "tours", payload, ctx), message="Tour generated")


@router.get("/tours/{tour_id}", summary="Get tour")
async def get_tour(tour_id: str, ctx: CallerContext, db: DB):
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "tours", aliases)
        await _backfill_legacy_tours_from_capture_ownership(db, ctx, aliases)
    doc = await db["tours"].find_one({"_id": _id_filter(tour_id), "orgId": ctx.org_id})
    if not doc:
        raise NotFoundException("tour", tour_id)
    if _is_field_engineer(ctx):
        name = await _resolve_user_display_name(db, ctx.user_id)
        _assert_can_access_tour(ctx, doc, name)
    return success_response(data=_serialise(doc))


@router.put("/tours/{tour_id}/status", summary="Update tour status")
async def update_tour_status(tour_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "publish"))):
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "tours", aliases)
        await _backfill_legacy_tours_from_capture_ownership(db, ctx, aliases)
        doc = await db["tours"].find_one({"_id": _id_filter(tour_id), "orgId": ctx.org_id})
        if doc:
            name = await _resolve_user_display_name(db, ctx.user_id)
            _assert_can_access_tour(ctx, doc, name)
    return success_response(
        data=await _patch(db, "tours", tour_id, payload, ctx, allowed_fields=_TOUR_STATUS_FIELDS),
        message="Tour status updated",
    )


@router.delete("/tours/{tour_id}", summary="Delete tour")
async def delete_tour(tour_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("tours", "delete"))):
    if _is_field_engineer(ctx):
        aliases = await _user_display_aliases(db, ctx.user_id)
        await _backfill_legacy_uploader_records(db, ctx, "tours", aliases)
        await _backfill_legacy_tours_from_capture_ownership(db, ctx, aliases)
        doc = await db["tours"].find_one({"_id": _id_filter(tour_id), "orgId": ctx.org_id})
        if doc:
            name = await _resolve_user_display_name(db, ctx.user_id)
            _assert_can_access_tour(ctx, doc, name)
    # Idempotent: client reconcile often re-DELETEs after a successful first
    # delete (hydrate still briefly contains the id). Treat missing as success.
    result = await db["tours"].delete_one({"_id": _id_filter(tour_id), "orgId": ctx.org_id})
    if result.deleted_count == 0:
        return success_response(message="Tour already deleted")
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
        # Keep the original PDF URL so the floor-plan viewer can use PDF.js
        # (vector-sharp). original_url may be a raster preview for room-map / <img>.
        raw_pdf = asset.get("raw_pdf_url") or asset.get("rawPdfUrl")
        if raw_pdf:
            payload["raw_pdf_url"] = raw_pdf
            payload["rawPdfUrl"] = raw_pdf
        width = asset.get("width")
        height = asset.get("height")
        payload["dimensions"] = {"width": width, "height": height} if width and height else None

    display_name = await _resolve_user_display_name(db, ctx.user_id)
    _stamp_uploader(payload, display_name)

    floor_id = str(payload.get("floorId") or "")
    prior = None
    duplicates: list[dict[str, Any]] = []
    if floor_id:
        duplicates = await db["floor_plans"].find(
            {"orgId": ctx.org_id, "floorId": floor_id},
            sort=[("createdAt", -1)],
        ).to_list(length=50)
        if duplicates:
            pin_plan_ids = set(
                await db["capture_pins"].distinct("floorPlanId", {"orgId": ctx.org_id, "floorId": floor_id})
            )
            prior = next((plan for plan in duplicates if str(plan.get("id") or plan.get("_id") or "") in pin_plan_ids), None)
            if not prior:
                prior = duplicates[0]
            prior_id = str(prior.get("id") or prior.get("_id") or "").strip()
            if prior_id:
                payload["id"] = prior_id
    payload.setdefault("pinsVisible", True)
    payload["pinLayoutStatus"] = "draft"
    payload["needsReannotate"] = bool(prior)
    if prior:
        payload.pop("copiedFromFloorPlanId", None)

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

    # If this floor already had pins (client will re-point them), strip labels
    # so a new drawing cannot silently keep wrong X/Y→room attributions.
    if prior and result.get("id"):
        try:
            await PredefinedPinsService(db).mark_plan_needs_reannotate(
                org_id=ctx.org_id, floor_plan_id=str(result["id"]),
            )
        except Exception:
            logger.exception("Failed to mark floor plan {} for re-annotation", result.get("id"))

    # Self-heal plan-id drift for this floor: keep one canonical plan id and move
    # pins/tours off any superseded duplicates.
    canonical_id = str(result.get("id") or result.get("_id") or "").strip()
    if floor_id and canonical_id and duplicates:
        stale_ids = [
            str(plan.get("id") or plan.get("_id") or "").strip()
            for plan in duplicates
            if str(plan.get("id") or plan.get("_id") or "").strip() and str(plan.get("id") or plan.get("_id") or "").strip() != canonical_id
        ]
        if stale_ids:
            await db["capture_pins"].update_many(
                {"orgId": ctx.org_id, "floorId": floor_id, "floorPlanId": {"$in": stale_ids}},
                {"$set": {"floorPlanId": canonical_id, "floor_plan_id": canonical_id, "updatedAt": _now()}},
            )
            await db["tours"].update_many(
                {"orgId": ctx.org_id, "floorId": floor_id, "floorPlanId": {"$in": stale_ids}},
                {"$set": {"floorPlanId": canonical_id, "floor_plan_id": canonical_id, "updatedAt": _now()}},
            )
            await db["floor_plans"].delete_many({"orgId": ctx.org_id, "_id": {"$in": stale_ids}})
            await db["floors"].update_one(
                {"orgId": ctx.org_id, "_id": _id_filter(floor_id)},
                {"$set": {"floorPlanId": canonical_id, "updatedAt": _now()}},
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
    # Idempotent: already-gone plans return success (write-queue races).
    plan = await db["floor_plans"].find_one({"_id": _id_filter(floor_plan_id), "orgId": ctx.org_id})
    if not plan:
        return success_response(message="Floor plan already deleted")
    await _delete(db, "floor_plans", floor_plan_id, ctx)
    assets = plan.get("mediaAssets") or plan.get("media_assets") or []
    await delete_media_assets(assets)
    return success_response(message="Floor plan deleted")


async def _enrich_capture_location_fields(
    db: AsyncIOMotorDatabase,
    ctx: CallerContext,
    payload: dict[str, Any],
) -> None:
    """Ensure projectId/towerId/floorLabel names are present on capture creates."""
    room_id = str(payload.get("roomId") or payload.get("room_id") or "")
    project_id = str(payload.get("projectId") or payload.get("project_id") or "").strip()
    tower_id = str(payload.get("towerId") or payload.get("tower_id") or "").strip()
    floor_label = str(payload.get("floorLabel") or payload.get("floor_label") or "").strip()
    project_name = str(payload.get("projectName") or payload.get("project_name") or "").strip()
    tower_name = str(payload.get("towerName") or payload.get("tower_name") or "").strip()

    room = None
    pin = None
    if room_id:
        room = await db["rooms"].find_one({"_id": _id_filter(room_id), "orgId": ctx.org_id})
        if not room:
            room = await db["rooms"].find_one({"id": room_id, "orgId": ctx.org_id})
        pin = await db["capture_pins"].find_one({
            "orgId": ctx.org_id,
            "$or": [{"roomId": room_id}, {"room_id": room_id}],
        })

    if not project_id:
        project_id = str(
            (room or {}).get("projectId")
            or (pin or {}).get("projectId")
            or ""
        ).strip()
    if not tower_id:
        tower_id = str(
            (room or {}).get("towerId")
            or (pin or {}).get("towerId")
            or ""
        ).strip()
    floor_id = str(
        payload.get("floorId")
        or (room or {}).get("floorId")
        or (pin or {}).get("floorId")
        or ""
    ).strip()

    # Heal room document if it was created without hierarchy ids.
    if room and room_id and (project_id or tower_id or floor_id):
        room_patch: dict[str, Any] = {"updatedAt": _now()}
        if project_id and not room.get("projectId"):
            room_patch["projectId"] = project_id
        if tower_id and not room.get("towerId"):
            room_patch["towerId"] = tower_id
        if floor_id and not room.get("floorId"):
            room_patch["floorId"] = floor_id
        if len(room_patch) > 1:
            await db["rooms"].update_one(
                {"_id": room["_id"], "orgId": ctx.org_id},
                {"$set": room_patch},
            )

    if project_id and not project_name:
        proj = await db["projects"].find_one({"_id": _id_filter(project_id), "orgId": ctx.org_id})
        if not proj:
            proj = await db["projects"].find_one({"id": project_id, "orgId": ctx.org_id})
        project_name = str((proj or {}).get("name") or "")
    if tower_id and not tower_name:
        tw = await db["towers"].find_one({"_id": _id_filter(tower_id), "orgId": ctx.org_id})
        if not tw:
            tw = await db["towers"].find_one({"id": tower_id, "orgId": ctx.org_id})
        tower_name = str((tw or {}).get("name") or "")
        if not project_id:
            project_id = str((tw or {}).get("projectId") or "")
            if project_id and not project_name:
                proj = await db["projects"].find_one({"_id": _id_filter(project_id), "orgId": ctx.org_id})
                if not proj:
                    proj = await db["projects"].find_one({"id": project_id, "orgId": ctx.org_id})
                project_name = str((proj or {}).get("name") or "")
    if floor_id and not floor_label:
        fl = await db["floors"].find_one({"_id": _id_filter(floor_id), "orgId": ctx.org_id})
        if not fl:
            fl = await db["floors"].find_one({"id": floor_id, "orgId": ctx.org_id})
        floor_label = str((fl or {}).get("label") or "")
        if not tower_id:
            tower_id = str((fl or {}).get("towerId") or "")

    if project_id:
        payload["projectId"] = project_id
    if tower_id:
        payload["towerId"] = tower_id
    if project_name:
        payload["projectName"] = project_name
    if tower_name:
        payload["towerName"] = tower_name
    if floor_label:
        payload["floorLabel"] = floor_label


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
    pin_id_hint = str(capture.get("pinId") or capture.get("pin_id") or "")
    floor_plan_id = str(capture.get("floorPlanId") or capture.get("floor_plan_id") or "")
    pin: dict[str, Any] | None = None
    if pin_id_hint:
        pin = await db["capture_pins"].find_one({"_id": _id_filter(pin_id_hint), "orgId": ctx.org_id})
    room_query: dict[str, Any] = {
        "orgId": ctx.org_id,
        "$or": [{"roomId": room_id}, {"room_id": room_id}],
    }
    if not pin:
        if floor_plan_id:
            pin = await db["capture_pins"].find_one({**room_query, "floorPlanId": floor_plan_id})
        if not pin:
            pin = await db["capture_pins"].find_one(room_query)
    if not pin:
        # Infer floorId from roomId prefix (t72554-f3-f72557-flat-a-rN → floor).
        parts = room_id.split("-")
        floor_id = "-".join(parts[:3]) if len(parts) >= 3 else ""
        if floor_id:
            from app.services.pin_orphan_service import restore_orphan_pins_for_floor
            await restore_orphan_pins_for_floor(
                db, org_id=ctx.org_id, floor_id=floor_id, resequence=True,
            )
            if floor_plan_id:
                pin = await db["capture_pins"].find_one({**room_query, "floorPlanId": floor_plan_id})
            if not pin:
                pin = await db["capture_pins"].find_one(room_query)
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
    result = await _list(
        db, "capture_pins", ctx,
        extra_filter={"floorPlanId": floor_plan_id},
        sort=[("sequenceNumber", 1)],
    )
    if _is_field_engineer(ctx):
        own_capture_ids = await _own_capture_ids_for_ctx(db, ctx)
        result["items"] = [
            _scope_pin_doc_to_capture_ids(item, own_capture_ids or set())
            for item in result["items"]
        ]
    return success_response(data=result)


# Capture-point placement/upload uses the captures permission family.
# Deleting a capture POINT (annotation layout) is manager/admin only —
# field engineers may click existing points and upload, never remove them.
@router.post("/floor-plans/{floor_plan_id}/pins", status_code=status.HTTP_201_CREATED, summary="Create capture pin")
async def create_capture_pin(floor_plan_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "create"))):
    payload.setdefault("floorPlanId", floor_plan_id)
    # Free-place pins without labels inherit nearest predefined flat/room.
    is_predefined = bool(payload.get("isPredefined"))
    has_labels = bool(str(payload.get("flatName") or "").strip() and str(payload.get("roomName") or "").strip())
    if not is_predefined and not has_labels:
        labeled = await db["capture_pins"].find(
            {
                "orgId": ctx.org_id,
                "floorPlanId": floor_plan_id,
                "flatName": {"$exists": True, "$nin": [None, ""]},
                "roomName": {"$exists": True, "$nin": [None, ""]},
            }
        ).to_list(length=500)
        from app.services.predefined_pins_service import apply_nearest_label
        try:
            stamped = apply_nearest_label(
                {"x": payload.get("x"), "y": payload.get("y"), **payload},
                labeled,
            )
            if stamped.get("flatName") and stamped.get("roomName"):
                payload["flatName"] = stamped["flatName"]
                payload["roomName"] = stamped["roomName"]
                payload["inheritedFromPinId"] = stamped.get("inheritedFromPinId")
                payload["source"] = "freeplace"
                payload["isPredefined"] = False
        except Exception:
            logger.exception("Nearest-label resolve failed for new pin on {}", floor_plan_id)
    elif is_predefined and has_labels:
        payload["source"] = payload.get("source") or "predefined"
        payload["isPredefined"] = True
    stored = await _upsert(db, "capture_pins", payload, ctx)
    return success_response(data=stored, message="Capture pin created")


@router.put("/pins/{pin_id}", summary="Update capture pin")
async def update_capture_pin(pin_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB, _=Depends(require_permission("captures", "edit"))):
    # captureIds is a timeline. Blind $set from a stale/short client write used to
    # wipe older visits (Compare / timeline disappeared after re-capture). Never
    # drop an id that still has a live capture document.
    body = dict(payload)
    incoming_ids = body.pop("captureIds", None)
    if incoming_ids is None:
        incoming_ids = body.pop("capture_ids", None)
    if incoming_ids is not None:
        pin = await db["capture_pins"].find_one({"_id": _id_filter(pin_id), "orgId": ctx.org_id})
        if not pin:
            raise NotFoundException("capture pin", pin_id)
        display_name = await _resolve_user_display_name(db, ctx.user_id) if _is_field_engineer(ctx) else ""
        await _assert_capture_ids_owned(
            db,
            ctx,
            [cid for cid in incoming_ids if isinstance(cid, str) and cid],
            display_name,
        )
        existing = [
            cid for cid in (pin.get("captureIds") or pin.get("capture_ids") or [])
            if isinstance(cid, str) and cid
        ]
        incoming = [cid for cid in (incoming_ids or []) if isinstance(cid, str) and cid]
        live: set[str] = set()
        for cid in set(existing) | set(incoming):
            found = await db["captures"].find_one({"_id": _id_filter(cid), "orgId": ctx.org_id})
            if found:
                live.add(cid)
        # Keep every live capture still on the pin, then append any new incoming ids.
        merged: list[str] = []
        for cid in existing:
            if cid in live and cid not in merged:
                merged.append(cid)
        for cid in incoming:
            if cid not in merged:
                merged.append(cid)
        # Drop ids that are neither live nor in the client's incoming list
        # (intentional removals after deleteCapture).
        body["captureIds"] = [
            cid for cid in merged
            if cid in live or cid in incoming
        ]

    updated = await _patch(db, "capture_pins", pin_id, body, ctx)
    # After a free-place move, re-resolve nearest label if still unlabeled.
    if not (updated.get("flatName") and updated.get("roomName")):
        try:
            stamped = await PredefinedPinsService(db).resolve_and_stamp_freeplace(
                org_id=ctx.org_id, pin_id=pin_id,
            )
            if stamped:
                updated = stamped
        except Exception:
            logger.exception("Nearest-label stamp failed for pin {}", pin_id)
    return success_response(data=updated, message="Capture pin updated")


@router.delete("/pins/{pin_id}", summary="Delete capture pin")
async def delete_capture_pin(pin_id: str, ctx: CallerContext, db: DB, _=Depends(require_permission("floorPlans", "delete"))):
    # Layout ownership: only manager/admin (floorPlans:delete) may remove capture
    # points. Field engineers keep captures:delete for their own media, but must
    # never erase annotated points from the plan.
    #
    # Cascade: removing a pin must also remove its capture timeline. Otherwise
    # orphaned captures stay in Mongo and reappear in Media Library / snapshot.
    #
    # Idempotent: floor replace / copy-from / client write-queue races often
    # DELETE the same pin twice. Returning 404 for an already-gone pin floods
    # logs and is not useful — treat as success.
    pin = await db["capture_pins"].find_one({"_id": _id_filter(pin_id), "orgId": ctx.org_id})
    if not pin:
        return success_response(message="Capture pin already deleted")
    floor_plan_id = str(pin.get("floorPlanId") or pin.get("floor_plan_id") or "")
    capture_ids = [
        cid for cid in (pin.get("captureIds") or pin.get("capture_ids") or [])
        if isinstance(cid, str) and cid
    ]
    room_id = pin.get("roomId") or pin.get("room_id")
    engineer_name = await _resolve_user_display_name(db, ctx.user_id) if _is_field_engineer(ctx) else ""
    await _assert_capture_ids_owned(db, ctx, capture_ids, engineer_name)
    if room_id:
        room_caps = await db["captures"].find({"orgId": ctx.org_id, "roomId": str(room_id)}).to_list(length=None)
        await _assert_capture_ids_owned(
            db,
            ctx,
            [str(cap.get("_id") or cap.get("id") or "") for cap in room_caps if str(cap.get("_id") or cap.get("id") or "").strip()],
            engineer_name,
        )
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
        try:
            snap_purged = await ConstructionProgressService(db).purge_snapshots_citing_capture(ctx.org_id, cid)
            if snap_purged:
                logger.info("Pin {} cascade: purged {} stale progress snapshot(s) for capture {}", pin_id, snap_purged, cid)
        except Exception:
            logger.exception("Failed to purge progress snapshots for capture {} during pin delete {}", cid, pin_id)
    if room_id:
        room_captures = await db["captures"].find({"orgId": ctx.org_id, "roomId": str(room_id)}).to_list(length=None)
        await db["captures"].delete_many({"orgId": ctx.org_id, "roomId": str(room_id)})
        for cap in room_captures:
            await _release_capture_assets(db, ctx, cap.get("mediaAssets") or cap.get("media_assets") or [])
            try:
                await AIProgressService(db).purge_for_timeline(ctx.org_id, cap["_id"])
            except Exception:
                logger.exception("Failed to purge progress analyses for room-cascade capture {}", cap["_id"])
            try:
                await ConstructionProgressService(db).purge_snapshots_citing_capture(ctx.org_id, cap["_id"])
            except Exception:
                logger.exception("Failed to purge progress snapshots for room-cascade capture {}", cap["_id"])
        await db["rooms"].delete_one({"_id": _id_filter(str(room_id)), "orgId": ctx.org_id})
    await _delete(db, "capture_pins", pin_id, ctx)
    await _resequence_pins_on_plan(db, ctx, floor_plan_id)
    return success_response(message="Capture pin deleted")


# ── Predefined labeled capture points (admin/manager) ───────────────────────

@router.post(
    "/floor-plans/{floor_plan_id}/predefined-pins",
    status_code=status.HTTP_201_CREATED,
    summary="Create a predefined labeled capture point",
)
async def create_predefined_pin(
    floor_plan_id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    db: DB,
    _=Depends(require_permission("floorPlans", "edit")),
):
    try:
        data = await PredefinedPinsService(db).create_predefined_pin(
            org_id=ctx.org_id,
            floor_plan_id=floor_plan_id,
            payload=payload,
            created_by=getattr(ctx, "user_id", None) or getattr(ctx, "email", None),
        )
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    return success_response(data=data, message="Predefined pin created")


@router.patch(
    "/floor-plans/{floor_plan_id}/predefined-pins/{pin_id}",
    summary="Update a predefined labeled capture point",
)
async def patch_predefined_pin(
    floor_plan_id: str,
    pin_id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    db: DB,
    _=Depends(require_permission("floorPlans", "edit")),
):
    try:
        data = await PredefinedPinsService(db).update_predefined_pin(
            org_id=ctx.org_id,
            floor_plan_id=floor_plan_id,
            pin_id=pin_id,
            patch=payload,
        )
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    return success_response(data=data, message="Predefined pin updated")


@router.delete(
    "/floor-plans/{floor_plan_id}/predefined-pins/{pin_id}",
    summary="Delete a predefined labeled capture point",
)
async def delete_predefined_pin(
    floor_plan_id: str,
    pin_id: str,
    ctx: CallerContext,
    db: DB,
    force: bool = Query(False),
    _=Depends(require_permission("floorPlans", "edit")),
):
    try:
        await PredefinedPinsService(db).delete_predefined_pin(
            org_id=ctx.org_id,
            floor_plan_id=floor_plan_id,
            pin_id=pin_id,
            force=force,
        )
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    return success_response(message="Predefined pin deleted")


@router.patch(
    "/floor-plans/{floor_plan_id}/pins-visibility",
    summary="Show or hide capture points on a floor plan",
)
async def set_pins_visibility(
    floor_plan_id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    db: DB,
    _=Depends(require_permission("floorPlans", "edit")),
):
    visible = payload.get("visible")
    if visible is None:
        visible = payload.get("pinsVisible")
    if visible is None:
        raise ValidationException("visible is required")
    try:
        data = await PredefinedPinsService(db).set_pins_visibility(
            org_id=ctx.org_id,
            floor_plan_id=floor_plan_id,
            visible=bool(visible),
        )
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    return success_response(data=data, message="Pin visibility updated")


@router.post(
    "/floors/{floor_id}/pins/copy-from",
    summary="Copy labeled capture points from another floor in the same project",
)
async def copy_pins_from_floor(
    floor_id: str,
    payload: dict[str, Any],
    ctx: CallerContext,
    db: DB,
    _=Depends(require_permission("floorPlans", "edit")),
):
    source_floor_id = str(payload.get("sourceFloorId") or payload.get("source_floor_id") or "").strip()
    if not source_floor_id:
        raise ValidationException("sourceFloorId is required")
    target_floor_plan_id = str(
        payload.get("targetFloorPlanId") or payload.get("target_floor_plan_id") or ""
    ).strip() or None
    source_floor_plan_id = str(
        payload.get("sourceFloorPlanId") or payload.get("source_floor_plan_id") or ""
    ).strip() or None
    try:
        data = await PredefinedPinsService(db).copy_pins_from_floor(
            org_id=ctx.org_id,
            target_floor_id=floor_id,
            source_floor_id=source_floor_id,
            created_by=getattr(ctx, "user_id", None) or getattr(ctx, "email", None),
            target_floor_plan_id=target_floor_plan_id,
            source_floor_plan_id=source_floor_plan_id,
        )
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    return success_response(data=data, message="Capture points copied")


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
    filters: dict[str, Any] = _notification_owner_filter(ctx)
    if read is not None:
        filters["read"] = read
    return success_response(data=await _list(db, "notifications", ctx, skip, limit, filters))


@router.post("/notifications", status_code=status.HTTP_201_CREATED, summary="Create notification")
async def create_notification(payload: dict[str, Any], ctx: CallerContext, db: DB):
    uid = str(ctx.user_id or "").strip()
    payload["recipientUserId"] = uid
    payload["recipient_user_id"] = uid
    payload["userId"] = uid
    payload["user_id"] = uid
    return success_response(data=await _upsert(db, "notifications", payload, ctx), message="Notification created")


@router.put("/notifications/{notification_id}/read", summary="Mark notification read")
async def mark_notification_read(notification_id: str, ctx: CallerContext, db: DB):
    doc = await db["notifications"].find_one({"_id": _id_filter(notification_id), "orgId": ctx.org_id})
    if not doc:
        raise NotFoundException("notification", notification_id)
    if not any(
        str(doc.get(key) or "").strip() == str(ctx.user_id or "").strip()
        for key in ("recipientUserId", "recipient_user_id", "userId", "user_id")
    ):
        raise ForbiddenException("You can only access your own notifications")
    return success_response(data=await _patch(db, "notifications", notification_id, {"read": True}, ctx))


@router.put("/notifications/read-all", summary="Mark all notifications read")
async def mark_all_notifications_read(ctx: CallerContext, db: DB):
    await db["notifications"].update_many(
        {"orgId": ctx.org_id, **_notification_owner_filter(ctx)},
        {"$set": {"read": True, "updatedAt": _now()}},
    )
    return success_response(message="Notifications marked read")


@router.delete("/notifications/{notification_id}", summary="Dismiss notification")
async def delete_notification(notification_id: str, ctx: CallerContext, db: DB):
    doc = await db["notifications"].find_one({"_id": _id_filter(notification_id), "orgId": ctx.org_id})
    if not doc:
        raise NotFoundException("notification", notification_id)
    if not any(
        str(doc.get(key) or "").strip() == str(ctx.user_id or "").strip()
        for key in ("recipientUserId", "recipient_user_id", "userId", "user_id")
    ):
        raise ForbiddenException("You can only access your own notifications")
    await _delete(db, "notifications", notification_id, ctx)
    return success_response(message="Notification dismissed")


@router.get("/notifications/unread-count", summary="Get unread notification count")
async def unread_notification_count(ctx: CallerContext, db: DB):
    count = await db["notifications"].count_documents(
        {"orgId": ctx.org_id, "read": False, **_notification_owner_filter(ctx)}
    )
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
    Record one project-activity audit event. Identity/timestamp are stamped from
    the authenticated request. Event types are allowlisted so clients cannot
    invent arbitrary identity/security events.
    """
    allowed_events = {
        "project_created", "project_updated", "project_deleted", "project_archived",
        "capture_uploaded", "capture_deleted", "capture_approved", "capture_rejected",
        "capture_pin_deleted", "review_assigned",
        "tour_published", "tour_deleted", "tour_draft",
        "floor_plan_uploaded", "floor_plan_deleted",
        "defect_created", "defect_resolved",
        "room_deleted", "pin_created", "pin_deleted",
        "user_invited", "user_role_changed",
        "progress_analysis_completed",
    }
    event_type = str(payload.get("eventType") or payload.get("action") or "").strip()
    if event_type and event_type not in allowed_events:
        raise ValidationException(
            f"Unsupported audit event type '{event_type}'. "
            "Only project-activity events may be written by clients."
        )

    now = datetime.now(timezone.utc)
    payload["actorId"] = ctx.user_id
    payload["actorRole"] = ctx.role
    payload["createdAt"] = now.isoformat()
    payload["created_at"] = now.isoformat()
    # Never let clients classify as security logs.
    payload.pop("logCategory", None)

    payload["actorName"] = await _resolve_user_display_name(db, ctx.user_id)
    try:
        user = await db["users"].find_one(
            {"_id": _id_filter(ctx.user_id)}, {"email": 1}
        )
    except Exception as exc:  # never let enrichment break the write
        logger.warning(f"[audit] actor lookup failed for {ctx.user_id}: {exc!r}")
        user = None
    if user:
        payload["actorEmail"] = user.get("email")

    return success_response(data=await _upsert(db, "audit_logs", payload, ctx), message="Audit log created")


@router.get("/admin/media", summary="Get media storage dashboard stats")
async def media_dashboard(
    ctx: CallerContext,
    db: DB,
    _admin=Depends(require_admin),
):
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
