"""Recycle bin for deleted captures, tours, floor plans and projects.

Why this exists: on 2026-11-19 a clean-up from the web app deleted 76 captures and 2 tours in 18 seconds. The image
files survived (the media bucket is versioned), but the *records* (which pin, room, floor, who captured it) were gone
for good, and the audit log only keeps a one-line description. Restoring them needed a database snapshot restore.

Every capture, tour and floor plan is copied here, in full, before it is deleted, and its image files are kept until
the item is purged. A project is "deleted" by archiving it (the project record stays, flagged with ``deletedAt``).
People can list the bin, restore an item, or empty it. Items are purged for good RETENTION_DAYS after deletion.

The bin also holds "pin" entries (capture points removed together with a floor plan). They are never shown on their
own: restoring a floor plan brings its capture points back with it.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

COLLECTION = "deleted_items"
RETENTION_DAYS = 30

KIND_CAPTURE = "capture"
KIND_TOUR = "tour"
KIND_FLOOR_PLAN = "floor_plan"
KIND_PIN = "pin"          # hidden: restored together with its floor plan
KIND_PROJECT = "project"  # virtual: an archived project, not a row in COLLECTION

_SOURCE = {
    KIND_CAPTURE: "captures",
    KIND_TOUR: "tours",
    KIND_FLOOR_PLAN: "floor_plans",
    KIND_PIN: "capture_pins",
}
# Kinds a person sees in the bin.
VISIBLE_KINDS = (KIND_CAPTURE, KIND_TOUR, KIND_FLOOR_PLAN, KIND_PROJECT)
PROJECT_ID_PREFIX = "project:"

# What a project owns. Purging a project removes all of it.
_PROJECT_CHILD_COLLECTIONS = ("towers", "flats", "rooms", "capture_pins", "tours", "floor_plans", "captures")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def expiry_of(deleted_at: Any) -> Optional[datetime]:
    """When an item deleted at ``deleted_at`` is purged for good."""
    at = _as_utc(deleted_at)
    return at + timedelta(days=RETENTION_DAYS) if at else None


def _first(doc: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = doc.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def describe(kind: str, doc: dict[str, Any]) -> dict[str, str]:
    """A short name and a one-line place for a bin row, so listing never has to open the full copy."""
    floor = _first(doc, "floorLabel", "floor_label", "floorName")
    tower = _first(doc, "towerName", "tower_name")
    project = _first(doc, "projectName", "project_name")
    place = " · ".join(p for p in (project, tower, floor) if p)
    if kind == KIND_CAPTURE:
        return {"title": _first(doc, "roomName", "room_name", "name") or "Capture", "subtitle": place}
    if kind == KIND_TOUR:
        return {"title": _first(doc, "title", "name", "roomName", "room_name") or "Walkthrough", "subtitle": place}
    if kind == KIND_FLOOR_PLAN:
        return {"title": floor or _first(doc, "name", "title") or "Floor plan", "subtitle": " · ".join(p for p in (project, tower) if p)}
    if kind == KIND_PIN:
        return {"title": f"Capture point {doc.get('sequenceNumber') or ''}".strip(), "subtitle": place}
    return {"title": _first(doc, "name", "title") or "Item", "subtitle": place}


async def archive(
    db: AsyncIOMotorDatabase,
    *,
    kind: str,
    doc: dict[str, Any],
    org_id: Any,
    actor_id: Any = None,
    actor_name: Optional[str] = None,
    pin_ids: Optional[list[str]] = None,
) -> str:
    """Copy ``doc`` into the bin and return the bin entry id. Raises if the copy cannot be stored: the caller must then
    NOT delete (a delete that cannot be undone is exactly what this protects against)."""
    if kind not in _SOURCE:
        raise ValueError(f"unsupported kind {kind!r}")
    now = _now()
    label = describe(kind, doc)
    entry = {
        "kind": kind,
        "sourceCollection": _SOURCE[kind],
        "docId": doc.get("_id"),
        "orgId": org_id,
        "projectId": _first(doc, "projectId", "project_id") or None,
        "floorPlanId": _first(doc, "floorPlanId", "floor_plan_id") or (str(doc.get("id") or doc.get("_id")) if kind == KIND_FLOOR_PLAN else None),
        "title": label["title"],
        "subtitle": label["subtitle"],
        "deletedAt": now,
        "deletedBy": str(actor_id) if actor_id is not None else None,
        "deletedByName": actor_name,
        "expiresAt": now + timedelta(days=RETENTION_DAYS),
        "pinIds": list(pin_ids or []),
        "doc": copy.deepcopy(doc),
        "restoredAt": None,
    }
    result = await db[COLLECTION].insert_one(entry)
    return str(result.inserted_id)


async def list_items(
    db: AsyncIOMotorDatabase,
    org_id: Any,
    *,
    kind: Optional[str] = None,
    since: Optional[datetime] = None,
    include_restored: bool = False,
    limit: int = 500,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"orgId": org_id}
    if kind:
        query["kind"] = kind
    if since:
        query["deletedAt"] = {"$gte": since}
    if not include_restored:
        query["restoredAt"] = None
    return await db[COLLECTION].find(query).sort("deletedAt", -1).to_list(length=limit)


async def restore(db: AsyncIOMotorDatabase, entry: dict[str, Any]) -> str:
    """Put one bin entry back. Never overwrites: returns 'restored', 'already_present' or 'skipped'.

    A capture is re-inserted and re-linked to the pins it was on (only pins that still exist, and only if the id is not
    already listed). A tour or floor plan is re-inserted; restoring a floor plan also brings back the capture points
    that were removed with it. The entry is marked restored, not removed. A restored record carries ``restoredAt`` so
    a phone that deleted it earlier does not delete it again (see tombstones in the web app)."""
    source = db[entry["sourceCollection"]]
    doc = copy.deepcopy(entry["doc"])
    doc_id = doc.get("_id", entry.get("docId"))
    if doc_id is None:
        return "skipped"
    stamp = _now().isoformat()
    if await source.find_one({"_id": doc_id}):
        outcome = "already_present"
    else:
        doc["restoredAt"] = stamp
        doc["updatedAt"] = stamp
        await source.insert_one(doc)
        outcome = "restored"
    if entry["kind"] == KIND_CAPTURE:
        capture_id = str(doc.get("id") or doc_id)
        for pin_id in entry.get("pinIds") or []:
            await db["capture_pins"].update_one(
                {"$or": [{"_id": pin_id}, {"id": pin_id}], "captureIds": {"$ne": capture_id}},
                {"$addToSet": {"captureIds": capture_id}, "$set": {"updatedAt": stamp}},
            )
    if entry["kind"] == KIND_FLOOR_PLAN:
        plan_id = str(doc.get("id") or doc_id)
        # Only the points removed along with this plan (the app removes them seconds before the plan itself), not
        # one somebody deleted on purpose last week.
        window_start = (_as_utc(entry.get("deletedAt")) or _now()) - timedelta(minutes=10)
        pins = await db[COLLECTION].find(
            {"kind": KIND_PIN, "orgId": entry.get("orgId"), "floorPlanId": plan_id, "restoredAt": None,
             "deletedAt": {"$gte": window_start}}
        ).to_list(length=5000)
        for pin_entry in pins:
            await restore(db, pin_entry)
    await db[COLLECTION].update_one({"_id": entry["_id"]}, {"$set": {"restoredAt": _now()}})
    logger.info("[recycle-bin] {} {} -> {}", entry["kind"], doc_id, outcome)
    return outcome


# ── Listing for people ────────────────────────────────────────────────────────

SORTS = ("newest", "oldest", "expiring", "name", "type")
_KIND_ORDER = {KIND_PROJECT: 0, KIND_FLOOR_PLAN: 1, KIND_TOUR: 2, KIND_CAPTURE: 3}


def _row(entry_id: str, kind: str, title: str, subtitle: str, project_id: Optional[str], deleted_at: Any,
         deleted_by_name: Optional[str], now: datetime) -> Optional[dict[str, Any]]:
    at = _as_utc(deleted_at)
    expires = expiry_of(at)
    if at is None or expires is None:
        return None
    seconds = (expires - now).total_seconds()
    return {
        "id": entry_id,
        "kind": kind,
        "title": title,
        "subtitle": subtitle,
        "projectId": project_id,
        "deletedAt": at.isoformat().replace("+00:00", "Z"),
        "deletedByName": deleted_by_name or "",
        "expiresAt": expires.isoformat().replace("+00:00", "Z"),
        "daysLeft": max(0, int(-(-seconds // 86400))),  # whole days, rounded up
    }


def _visibility(role: str, user_id: str, accessible: Optional[list[str]]) -> dict[str, Any]:
    """Which bin rows this person may see. Admin: everything. Manager: their projects' items plus their own deletions.
    Field engineer (and anyone else): only what they deleted themselves."""
    if role in ("admin", "super_admin"):
        return {}
    mine = {"deletedBy": str(user_id)}
    if role in ("manager", "reviewer") and accessible:
        return {"$or": [mine, {"projectId": {"$in": list(accessible)}}]}
    return mine


async def list_rows(
    db: AsyncIOMotorDatabase,
    *,
    org_id: Any,
    user_id: str,
    role: str,
    accessible: Optional[list[str]],
    kind: Optional[str] = None,
    sort: str = "newest",
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Every visible, not-yet-expired row (sorted) and the count per kind (before the kind filter)."""
    now = _now()
    cutoff = now - timedelta(days=RETENTION_DAYS)
    vis = _visibility(role, user_id, accessible)
    rows: list[dict[str, Any]] = []

    query: dict[str, Any] = {
        "orgId": org_id, "kind": {"$in": [KIND_CAPTURE, KIND_TOUR, KIND_FLOOR_PLAN]},
        "restoredAt": None, "deletedAt": {"$gt": cutoff},
    }
    if vis:
        query = {"$and": [query, vis]}
    async for e in db[COLLECTION].find(query, {"doc": 0}):
        row = _row(str(e["_id"]), e["kind"], e.get("title") or "Item", e.get("subtitle") or "",
                   e.get("projectId"), e.get("deletedAt"), e.get("deletedByName"), now)
        if row:
            rows.append(row)

    pquery: dict[str, Any] = {"orgId": org_id, "archived": True, "deletedAt": {"$ne": None}}
    if role in ("admin", "super_admin"):
        pass
    elif role in ("manager", "reviewer") and accessible:
        pquery["$or"] = [{"_id": {"$in": list(accessible)}}, {"id": {"$in": list(accessible)}}, {"deletedBy": str(user_id)}]
    else:
        pquery["deletedBy"] = str(user_id)
    async for p in db["projects"].find(pquery):
        pid = str(p.get("id") or p["_id"])
        row = _row(f"{PROJECT_ID_PREFIX}{pid}", KIND_PROJECT, str(p.get("name") or "Project"),
                   str(p.get("location") or ""), pid, p.get("deletedAt"), p.get("deletedByName"), now)
        if row and _as_utc(p.get("deletedAt")) > cutoff:
            rows.append(row)

    counts = {k: 0 for k in VISIBLE_KINDS}
    for r in rows:
        counts[r["kind"]] += 1
    counts_all = {"all": len(rows), **counts}

    if kind and kind != "all":
        rows = [r for r in rows if r["kind"] == kind]
    if sort == "oldest":
        rows.sort(key=lambda r: r["deletedAt"])
    elif sort == "expiring":
        rows.sort(key=lambda r: r["expiresAt"])
    elif sort == "name":
        rows.sort(key=lambda r: (r["title"].lower(), r["deletedAt"]))
    elif sort == "type":
        rows.sort(key=lambda r: (_KIND_ORDER.get(r["kind"], 9), -(_as_utc(r["deletedAt"]) or now).timestamp()))
    else:
        rows.sort(key=lambda r: r["deletedAt"], reverse=True)
    return rows, counts_all


def _id_variants(value: str) -> list[Any]:
    return [value, ObjectId(value)] if ObjectId.is_valid(value) else [value]


async def find_visible_entry(
    db: AsyncIOMotorDatabase, *, entry_id: str, org_id: Any, user_id: str, role: str, accessible: Optional[list[str]],
) -> Optional[dict[str, Any]]:
    """The bin entry (or, for a project, a stand-in dict) if this person may act on it; otherwise None."""
    vis = _visibility(role, user_id, accessible)
    if entry_id.startswith(PROJECT_ID_PREFIX):
        pid = entry_id[len(PROJECT_ID_PREFIX):]
        project = await db["projects"].find_one(
            {"orgId": org_id, "archived": True, "deletedAt": {"$ne": None}, "$or": [{"_id": {"$in": _id_variants(pid)}}, {"id": pid}]}
        )
        if not project:
            return None
        if role not in ("admin", "super_admin"):
            allowed = (role in ("manager", "reviewer") and accessible and pid in accessible) or str(project.get("deletedBy") or "") == str(user_id)
            if not allowed:
                return None
        return {"kind": KIND_PROJECT, "project": project, "projectId": pid}
    if not ObjectId.is_valid(entry_id):
        return None
    query: dict[str, Any] = {"_id": ObjectId(entry_id), "orgId": org_id, "kind": {"$in": [KIND_CAPTURE, KIND_TOUR, KIND_FLOOR_PLAN]}}
    if vis:
        query = {"$and": [query, vis]}
    return await db[COLLECTION].find_one(query)


async def restore_entry(db: AsyncIOMotorDatabase, entry: dict[str, Any]) -> str:
    """Restore a row found by ``find_visible_entry`` (a project is un-archived, anything else goes through restore)."""
    if entry["kind"] == KIND_PROJECT:
        project = entry["project"]
        await db["projects"].update_one(
            {"_id": project["_id"]},
            {"$set": {"archived": False, "status": "active", "deletedAt": None, "deletedBy": None,
                      "deletedByName": None, "restoredAt": _now().isoformat(), "updatedAt": _now().isoformat()}},
        )
        return "restored"
    return await restore(db, entry)


# ── Permanent deletion ────────────────────────────────────────────────────────

async def _asset_still_used(db: AsyncIOMotorDatabase, org_id: Any, public_id: str, skip_entry_id: Any) -> bool:
    """True when a live capture, or another capture still waiting in the bin, uses this stored file."""
    refs = [{"mediaAssets.public_id": public_id}, {"media_assets.public_id": public_id}, {"public_id": public_id}]
    if await db["captures"].find_one({"orgId": org_id, "$or": refs}, {"_id": 1}):
        return True
    in_bin = [{"doc." + list(r)[0]: public_id} for r in refs]
    other = await db[COLLECTION].find_one(
        {"orgId": org_id, "kind": KIND_CAPTURE, "restoredAt": None, "_id": {"$ne": skip_entry_id}, "$or": in_bin}, {"_id": 1}
    )
    return other is not None


async def _destroy_files(db: AsyncIOMotorDatabase, org_id: Any, assets: list[dict[str, Any]], skip_entry_id: Any = None) -> None:
    """Delete stored files nothing else uses (best effort: never raises) and forget their upload-dedup entries."""
    from app.services.cloudinary_service import delete_media_assets

    releasable = []
    for asset in assets or []:
        public_id = (asset or {}).get("public_id")
        if not public_id:
            continue
        try:
            if await _asset_still_used(db, org_id, public_id, skip_entry_id):
                continue
        except Exception as exc:
            logger.warning("[recycle-bin] reference check failed for {}: {!r}", public_id, exc)
            continue  # fail safe: keep the file
        releasable.append(asset)
    if not releasable:
        return
    await delete_media_assets(releasable, org_id=str(org_id))
    try:
        from app.api.v1.endpoints.workflow import _dedup_evict_for_assets

        await _dedup_evict_for_assets(db, releasable)
    except Exception as exc:
        logger.warning("[recycle-bin] dedup eviction failed: {!r}", exc)


async def purge_entry(db: AsyncIOMotorDatabase, entry: dict[str, Any]) -> None:
    """Permanently remove one row from the bin together with the files only it was keeping alive."""
    if entry["kind"] == KIND_PROJECT:
        await purge_project(db, entry["project"])
        return
    doc = entry.get("doc") or {}
    if entry["kind"] in (KIND_CAPTURE, KIND_FLOOR_PLAN):
        assets = doc.get("mediaAssets") or doc.get("media_assets") or []
        if not assets and doc.get("public_id"):
            assets = [{"public_id": doc.get("public_id"), "resource_type": doc.get("resource_type") or "image"}]
        await _destroy_files(db, entry.get("orgId"), assets, skip_entry_id=entry["_id"])
    await db[COLLECTION].delete_one({"_id": entry["_id"]})


async def purge_project(db: AsyncIOMotorDatabase, project: dict[str, Any]) -> None:
    """Permanently remove an archived project and everything that belongs to it."""
    org_id = project.get("orgId")
    pid = str(project.get("id") or project["_id"])
    towers = await db["towers"].find({"orgId": org_id, "projectId": pid}, {"_id": 1, "id": 1}).to_list(length=5000)
    tower_ids = [str(t.get("id") or t["_id"]) for t in towers]
    # Files first (captures and floor plans), then the records.
    for coll in ("captures", "floor_plans"):
        docs = await db[coll].find({"orgId": org_id, "projectId": pid}).to_list(length=None)
        for d in docs:
            assets = d.get("mediaAssets") or d.get("media_assets") or []
            if assets:
                await db[coll].delete_one({"_id": d["_id"]})
                await _destroy_files(db, org_id, assets)
    for e in await db[COLLECTION].find({"orgId": org_id, "projectId": pid, "restoredAt": None}).to_list(length=None):
        await purge_entry(db, e)
    if tower_ids:
        await db["floors"].delete_many({"orgId": org_id, "towerId": {"$in": tower_ids}})
    for coll in _PROJECT_CHILD_COLLECTIONS:
        await db[coll].delete_many({"orgId": org_id, "projectId": pid})
    await db["projects"].delete_one({"_id": project["_id"]})
    logger.info("[recycle-bin] project {} purged with {} tower(s)", pid, len(tower_ids))


async def purge_expired(db: AsyncIOMotorDatabase) -> int:
    """Permanently delete everything deleted more than RETENTION_DAYS ago (every organisation). Returns how many rows."""
    cutoff = _now() - timedelta(days=RETENTION_DAYS)
    purged = 0
    for e in await db[COLLECTION].find({"restoredAt": None, "deletedAt": {"$lte": cutoff}}).to_list(length=None):
        try:
            await purge_entry(db, e)
            purged += 1
        except Exception:
            logger.exception("[recycle-bin] could not purge {}", e.get("_id"))
    for p in await db["projects"].find({"archived": True, "deletedAt": {"$ne": None, "$lte": cutoff}}).to_list(length=None):
        try:
            await purge_project(db, p)
            purged += 1
        except Exception:
            logger.exception("[recycle-bin] could not purge project {}", p.get("_id"))
    # Rows for items that were restored long ago carry nothing worth keeping.
    await db[COLLECTION].delete_many({"restoredAt": {"$ne": None, "$lte": cutoff}})
    if purged:
        logger.info("[recycle-bin] purged {} expired item(s)", purged)
    return purged
