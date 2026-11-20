"""Recycle bin for deleted captures and tours.

Why this exists: on 2026-11-19 a clean-up from the web app deleted 76 captures and 2 tours in 18 seconds. The image
files survived (the media bucket is versioned), but the *records* (which pin, room, floor, who captured it) were gone
for good, and the audit log only keeps a one-line description. Restoring them needed a database snapshot restore.

From now on every capture and tour is copied here, in full, before it is deleted. Nothing about deleting changes for
the person using the app. An administrator can list the bin and restore an item (the record, plus its link back to the
pin it was on). Items are kept for RETENTION_DAYS and are never read by the normal app screens.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

COLLECTION = "deleted_items"
RETENTION_DAYS = 180

KIND_CAPTURE = "capture"
KIND_TOUR = "tour"
_SOURCE = {KIND_CAPTURE: "captures", KIND_TOUR: "tours"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    entry = {
        "kind": kind,
        "sourceCollection": _SOURCE[kind],
        "docId": doc.get("_id"),
        "orgId": org_id,
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
    already listed). A tour is re-inserted. The entry is marked restored, not removed."""
    source = db[entry["sourceCollection"]]
    doc = copy.deepcopy(entry["doc"])
    doc_id = doc.get("_id", entry.get("docId"))
    if doc_id is None:
        return "skipped"
    if await source.find_one({"_id": doc_id}):
        outcome = "already_present"
    else:
        await source.insert_one(doc)
        outcome = "restored"
    if entry["kind"] == KIND_CAPTURE:
        capture_id = str(doc.get("id") or doc_id)
        for pin_id in entry.get("pinIds") or []:
            await db["capture_pins"].update_one(
                {"$or": [{"_id": pin_id}, {"id": pin_id}], "captureIds": {"$ne": capture_id}},
                {"$addToSet": {"captureIds": capture_id}, "$set": {"updatedAt": _now().isoformat()}},
            )
    await db[COLLECTION].update_one({"_id": entry["_id"]}, {"$set": {"restoredAt": _now()}})
    logger.info("[recycle-bin] {} {} -> {}", entry["kind"], doc_id, outcome)
    return outcome
