from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, File, Query, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.core.dependencies import CallerContext, DB
from app.core.exceptions import NotFoundException, ValidationException
from app.services.cloudinary_service import cloudinary_folder, signed_upload_params, upload_media
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
    if id_value:
        doc["_id"] = id_value
        doc["id"] = id_value
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


def _processing_status(kind: str, ext: str) -> str:
    if kind == "captures" and ext in {".dng", ".insp", ".insv"}:
        return "queued"
    return "converted"


def _asset_payload(asset: dict[str, Any], *, kind: str, entity_id: Optional[str], ext: str) -> dict[str, Any]:
    original_url = asset["original_url"]
    thumbnail_url = asset["thumbnail_url"]
    # PDFs are uploaded as resource_type=image and original_url is already an image-render URL
    processed_url = original_url if ext in {".jpg", ".jpeg", ".png", ".pdf"} else None
    return {
        **asset,
        "originalUrl": original_url,
        "thumbnailUrl": thumbnail_url,
        "original_file_url": original_url,
        "processed_panorama_url": processed_url,
        "processedPanoramaUrl": processed_url,
        "preview_url": thumbnail_url,
        "previewUrl": thumbnail_url,
        "file_type": ext.lstrip("."),
        "fileType": ext.lstrip("."),
        "processing_status": _processing_status(kind, ext),
        "processingStatus": _processing_status(kind, ext),
        "capture_id": entity_id if kind == "captures" else None,
        "captureId": entity_id if kind == "captures" else None,
    }


async def _upload_files(
    *,
    ctx: CallerContext,
    kind: str,
    files: list[UploadFile],
    entity_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    allowed = MEDIA_EXTENSIONS[kind]
    folder = cloudinary_folder(kind, ctx.org_id, entity_id)
    uploaded: list[dict[str, Any]] = []
    for file in files:
        ext = _extension(file.filename or "")
        if ext not in allowed:
            raise ValidationException(f"Unsupported {kind} file type: {ext or 'unknown'}")
        asset = await upload_media(
            file_obj=file.file,
            filename=file.filename or f"upload{ext}",
            folder=folder,
            resource_type="image" if ext == ".pdf" else "auto",
        )
        uploaded.append(_asset_payload(asset, kind=kind, entity_id=entity_id, ext=ext))
    return uploaded


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
    data = {}
    for key, collection in COLLECTIONS.items():
        data[key] = (await _list(db, collection, ctx, limit=500))["items"]
    return success_response(data=data)


@router.get("/projects", summary="List projects")
async def list_projects(ctx: CallerContext, db: DB, skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    return success_response(data=await _list(db, "projects", ctx, skip, limit))


@router.post("/projects", status_code=status.HTTP_201_CREATED, summary="Create project")
async def create_project(payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _upsert(db, "projects", payload, ctx), message="Project created")


@router.get("/projects/{project_id}", summary="Get project")
async def get_project(project_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _get(db, "projects", project_id, ctx))


@router.put("/projects/{project_id}", summary="Update project")
async def update_project(project_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "projects", project_id, payload, ctx), message="Project updated")


@router.delete("/projects/{project_id}", summary="Delete project")
async def delete_project(project_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "projects", project_id, ctx)
    return success_response(message="Project deleted")


@router.get("/projects/{project_id}/towers", summary="List project towers")
async def list_towers(project_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "towers", ctx, extra_filter={"projectId": project_id}))


@router.post("/projects/{project_id}/towers", status_code=status.HTTP_201_CREATED, summary="Create tower")
async def create_tower(project_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    payload["projectId"] = project_id
    return success_response(data=await _upsert(db, "towers", payload, ctx), message="Tower created")


@router.put("/towers/{tower_id}", summary="Update tower")
async def update_tower(tower_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "towers", tower_id, payload, ctx), message="Tower updated")


@router.delete("/towers/{tower_id}", summary="Delete tower")
async def delete_tower(tower_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "towers", tower_id, ctx)
    return success_response(message="Tower deleted")


@router.get("/towers/{tower_id}/floors", summary="List tower floors")
async def list_floors(tower_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "floors", ctx, extra_filter={"towerId": tower_id}, sort=[("number", 1)]))


@router.post("/towers/{tower_id}/floors", status_code=status.HTTP_201_CREATED, summary="Create floor")
async def create_floor(tower_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    payload["towerId"] = tower_id
    return success_response(data=await _upsert(db, "floors", payload, ctx), message="Floor created")


@router.put("/floors/{floor_id}", summary="Update floor")
async def update_floor(floor_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "floors", floor_id, payload, ctx), message="Floor updated")


@router.delete("/floors/{floor_id}", summary="Delete floor")
async def delete_floor(floor_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "floors", floor_id, ctx)
    return success_response(message="Floor deleted")


@router.get("/floors/{floor_id}/flats", summary="List floor flats")
async def list_flats(floor_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "flats", ctx, extra_filter={"floorId": floor_id}, sort=[("number", 1)]))


@router.post("/floors/{floor_id}/flats", status_code=status.HTTP_201_CREATED, summary="Create flat")
async def create_flat(floor_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    payload["floorId"] = floor_id
    return success_response(data=await _upsert(db, "flats", payload, ctx), message="Flat created")


@router.put("/flats/{flat_id}", summary="Update flat")
async def update_flat(flat_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "flats", flat_id, payload, ctx), message="Flat updated")


@router.delete("/flats/{flat_id}", summary="Delete flat")
async def delete_flat(flat_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "flats", flat_id, ctx)
    return success_response(message="Flat deleted")


@router.get("/flats/{flat_id}/rooms", summary="List flat rooms")
async def list_rooms(flat_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(db, "rooms", ctx, extra_filter={"flatId": flat_id}, sort=[("name", 1)]))


@router.post("/flats/{flat_id}/rooms", status_code=status.HTTP_201_CREATED, summary="Create room")
async def create_room(flat_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    payload["flatId"] = flat_id
    return success_response(data=await _upsert(db, "rooms", payload, ctx), message="Room created")


@router.put("/rooms/{room_id}", summary="Update room")
async def update_room(room_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "rooms", room_id, payload, ctx), message="Room updated")


@router.delete("/rooms/{room_id}", summary="Delete room")
async def delete_room(room_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "rooms", room_id, ctx)
    return success_response(message="Room deleted")


@router.get("/captures", summary="List captures")
async def list_captures(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "captures", ctx, skip, limit, filters))


@router.post("/captures", status_code=status.HTTP_201_CREATED, summary="Create capture")
async def create_capture(payload: dict[str, Any], ctx: CallerContext, db: DB):
    assets = payload.get("mediaAssets") or payload.get("media_assets") or []
    first_asset = assets[0] if assets else None
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
    return success_response(data=await _upsert(db, "captures", payload, ctx), message="Capture uploaded")


@router.get("/captures/{capture_id}", summary="Get capture")
async def get_capture(capture_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _get(db, "captures", capture_id, ctx))


@router.put("/captures/{capture_id}/review", summary="Update capture review")
async def update_capture_review(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "captures", capture_id, payload, ctx), message="Capture review updated")


@router.put("/captures/{capture_id}/publish", summary="Publish or unpublish capture")
async def publish_capture(capture_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "captures", capture_id, payload, ctx), message="Capture publish state updated")


@router.delete("/captures/{capture_id}", summary="Delete capture")
async def delete_capture(capture_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "captures", capture_id, ctx)
    return success_response(message="Capture deleted")


@router.post("/captures/upload-signature", summary="Get upload signature placeholder")
async def get_upload_signature(payload: dict[str, Any], ctx: CallerContext):
    kind = payload.get("kind", "captures")
    entity_id = payload.get("entity_id") or payload.get("capture_id") or payload.get("id")
    return success_response(data=signed_upload_params(kind, ctx.org_id, entity_id))


@router.post("/uploads/captures", status_code=status.HTTP_201_CREATED, summary="Upload capture files")
async def upload_capture_files(ctx: CallerContext, files: list[UploadFile] = File(...), capture_id: Optional[str] = None):
    uploaded = await _upload_files(ctx=ctx, kind="captures", files=files, entity_id=capture_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Capture files uploaded")


@router.post("/uploads/floorplans", status_code=status.HTTP_201_CREATED, summary="Upload floor plan file")
async def upload_floor_plan_files(ctx: CallerContext, files: list[UploadFile] = File(...), floor_plan_id: Optional[str] = None):
    uploaded = await _upload_files(ctx=ctx, kind="floorplans", files=files, entity_id=floor_plan_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Floor plan uploaded")


@router.post("/uploads/avatars", status_code=status.HTTP_201_CREATED, summary="Upload avatar")
async def upload_avatar_files(ctx: CallerContext, files: list[UploadFile] = File(...)):
    uploaded = await _upload_files(ctx=ctx, kind="avatars", files=files, entity_id=ctx.user_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Avatar uploaded")


@router.post("/uploads/projects", status_code=status.HTTP_201_CREATED, summary="Upload project media")
async def upload_project_files(ctx: CallerContext, files: list[UploadFile] = File(...), project_id: Optional[str] = None):
    uploaded = await _upload_files(ctx=ctx, kind="projects", files=files, entity_id=project_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Project media uploaded")


@router.post("/uploads/tours", status_code=status.HTTP_201_CREATED, summary="Upload tour panorama media")
async def upload_tour_files(ctx: CallerContext, files: list[UploadFile] = File(...), tour_id: Optional[str] = None):
    uploaded = await _upload_files(ctx=ctx, kind="tours", files=files, entity_id=tour_id)
    return success_response(data={"files": uploaded, "count": len(uploaded)}, message="Tour media uploaded")


@router.get("/tours", summary="List tours")
async def list_tours(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "tours", ctx, skip, limit, filters))


@router.post("/tours", status_code=status.HTTP_201_CREATED, summary="Generate tour")
async def create_tour(payload: dict[str, Any], ctx: CallerContext, db: DB):
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
async def update_tour_status(tour_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "tours", tour_id, payload, ctx), message="Tour status updated")


@router.post("/floor-plans", status_code=status.HTTP_201_CREATED, summary="Upload floor plan")
async def create_floor_plan(payload: dict[str, Any], ctx: CallerContext, db: DB):
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
    return success_response(data=await _upsert(db, "floor_plans", payload, ctx), message="Floor plan uploaded")


# ── Capture Pins ────────────────────────────────────────────────────────────
@router.get("/floor-plans/{floor_plan_id}/pins", summary="List capture pins for a floor plan")
async def list_capture_pins(floor_plan_id: str, ctx: CallerContext, db: DB):
    return success_response(data=await _list(
        db, "capture_pins", ctx,
        extra_filter={"floorPlanId": floor_plan_id},
        sort=[("sequenceNumber", 1)],
    ))


@router.post("/floor-plans/{floor_plan_id}/pins", status_code=status.HTTP_201_CREATED, summary="Create capture pin")
async def create_capture_pin(floor_plan_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    payload.setdefault("floorPlanId", floor_plan_id)
    return success_response(data=await _upsert(db, "capture_pins", payload, ctx), message="Capture pin created")


@router.put("/pins/{pin_id}", summary="Update capture pin")
async def update_capture_pin(pin_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _patch(db, "capture_pins", pin_id, payload, ctx), message="Capture pin updated")


@router.delete("/pins/{pin_id}", summary="Delete capture pin")
async def delete_capture_pin(pin_id: str, ctx: CallerContext, db: DB):
    await _delete(db, "capture_pins", pin_id, ctx)
    return success_response(message="Capture pin deleted")


@router.get("/defects", summary="List defects")
async def list_defects(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "defects", ctx, skip, limit, filters))


@router.post("/defects", status_code=status.HTTP_201_CREATED, summary="Create defect")
async def create_defect(payload: dict[str, Any], ctx: CallerContext, db: DB):
    return success_response(data=await _upsert(db, "defects", payload, ctx), message="Defect created")


@router.put("/defects/{defect_id}", summary="Update defect")
async def update_defect(defect_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
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


@router.get("/audit-logs", summary="List audit logs")
async def list_audit_logs(ctx: CallerContext, db: DB, project_id: Optional[str] = None, skip: int = 0, limit: int = 100):
    filters = {"projectId": project_id} if project_id else None
    return success_response(data=await _list(db, "audit_logs", ctx, skip, limit, filters))


@router.post("/audit-logs", status_code=status.HTTP_201_CREATED, summary="Create audit log")
async def create_audit_log(payload: dict[str, Any], ctx: CallerContext, db: DB):
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
