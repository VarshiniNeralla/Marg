"""Restore capture pins that were deleted while their photos survived.

Race that creates orphans (observed in production):
  1. Client stamps capture.roomId from a live pin.
  2. Pin is deleted (cascade empties captureIds + deletes the backing room)
     before createCapture reaches the server.
  3. createCapture lands with the stale roomId — gallery shows "Pin N", but
     no pin exists, so Construction Progress and the floor-plan overlay skip it.

Heal by recreating the backing room + pin, linking captureIds, then optionally
resequencing so markers read 1..N with no gaps.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

_PIN_NAME_RE = re.compile(r"^Pin\s+(\d+)$", re.IGNORECASE)
_ROOM_SUFFIX_RE = re.compile(r"r(\d+)$", re.IGNORECASE)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_pin_sequence(room_name: str | None) -> int | None:
    if not room_name:
        return None
    m = _PIN_NAME_RE.match(str(room_name).strip())
    return int(m.group(1)) if m else None


def _pin_id_for_room(room_id: str, cap_id: str) -> str:
    m = _ROOM_SUFFIX_RE.search(room_id)
    if m:
        # Historical client ids: room rN ↔ pin (N-1) roughly; keep stable restore ids.
        n = int(m.group(1))
        return f"pin{max(n - 1, 1)}"
    return f"pin-restored-{cap_id}"


def _polygon_centroid(polygon: list[Any]) -> tuple[float, float] | None:
    pts: list[tuple[float, float]] = []
    for p in polygon or []:
        if isinstance(p, dict):
            pts.append((float(p["x"]), float(p["y"])))
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            pts.append((float(p[0]), float(p[1])))
    if not pts:
        return None
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


_PREFERRED_ROOM_NAMES = (
    "living / dining",
    "living",
    "drawing room",
    "multi-purpose",
    "lobby",
    "pdr",
)


async def _placement_inside_room_map(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    floor_plan_id: str,
    existing_pins: list[dict[str, Any]],
) -> tuple[float, float]:
    """Place a restored pin inside a real room polygon so the heatmap can draw a box.

    Prefer an unoccupied room (no other pin already inside it). Never place off-plan
    (e.g. left of every pin onto a section callout) — that leaves Pin N with no box.
    """
    from app.services.room_map_service import RoomMapService, locate_pin

    cached = await RoomMapService(db).get_cached(floor_plan_id, org_id)
    flats = (cached or {}).get("flats") or []
    occupied: set[tuple[str, str]] = set()
    for pin in existing_pins:
        located = locate_pin(flats, pin.get("x"), pin.get("y"))
        if located:
            occupied.add((located[0], located[1]))

    candidates: list[tuple[int, float, float]] = []
    for flat_entry in flats:
        flat_name = str(flat_entry.get("flat") or "")
        for room in flat_entry.get("rooms") or []:
            room_name = str(room.get("name") or "")
            centroid = _polygon_centroid(room.get("polygon") or [])
            if not centroid:
                continue
            key = (flat_name, room_name)
            if key in occupied:
                continue
            rank = 50
            lower = room_name.strip().lower()
            for i, pref in enumerate(_PREFERRED_ROOM_NAMES):
                if pref in lower:
                    rank = i
                    break
            # Prefer physical flats over common area for restored walkthrough pins.
            if flat_name.lower().startswith("common"):
                rank += 100
            # Prefer Flat 01 when restoring the earliest orphaned walkthrough pin.
            flat_l = flat_name.lower()
            if "flat 01" in flat_l or flat_l.endswith(" 01"):
                rank -= 5
            elif "flat 02" in flat_l or flat_l.endswith(" 02"):
                rank -= 2
            candidates.append((rank, centroid[0], centroid[1]))

    if candidates:
        candidates.sort(key=lambda c: (c[0], c[1], c[2]))
        return candidates[0][1], candidates[0][2]

    if existing_pins:
        xs = [float(p.get("x") or 50) for p in existing_pins]
        ys = [float(p.get("y") or 50) for p in existing_pins]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return 35.0, 70.0


async def heal_unlocated_pins_for_floor(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    floor_id: str,
    floor_plan_id: str | None = None,
) -> int:
    """Report pins that sit outside every room polygon — never relocate them.

    Engineer pin coordinates are source of truth. Moving them to room-map
    centroids (the previous behaviour) made Construction Progress show pins in
    one place while the snapshot heatmap still colored the rooms attributed at
    analysis time — boxes and markers looked "displaced". Unlocated pins still
    get a per-pin halo on the heatmap; field staff must re-place if a pin was
    dropped on a wall/callout.
    """
    from app.services.room_map_service import RoomMapService, locate_pin

    pins = await db["capture_pins"].find({"orgId": org_id, "floorId": floor_id}).to_list(length=2000)
    if not pins:
        return 0
    if not floor_plan_id:
        floor_plan_id = str(pins[0].get("floorPlanId") or pins[0].get("floor_plan_id") or "")
    if not floor_plan_id:
        return 0

    cached = await RoomMapService(db).get_cached(floor_plan_id, org_id)
    flats = (cached or {}).get("flats") or []
    if not flats:
        return 0

    unlocated = 0
    for pin in pins:
        if locate_pin(flats, pin.get("x"), pin.get("y")):
            continue
        unlocated += 1
        logger.warning(
            "[pin-orphan] pin={} seq={} at ({},{}) is outside every room polygon on "
            "floor={} — leaving coordinates untouched (engineer placement wins)",
            pin.get("_id") or pin.get("id"),
            pin.get("sequenceNumber") or pin.get("sequence_number"),
            pin.get("x"),
            pin.get("y"),
            floor_id,
        )
    return unlocated


async def restore_orphan_pins_for_floor(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    floor_id: str,
    floor_plan_id: str | None = None,
    resequence: bool = True,
) -> int:
    """Recreate missing pins for floor-scoped orphan captures. Returns count restored."""
    if not floor_id:
        return 0

    pins = await db["capture_pins"].find({"orgId": org_id, "floorId": floor_id}).to_list(length=2000)
    pin_by_room = {
        str(p.get("roomId") or p.get("room_id") or ""): p
        for p in pins
        if p.get("roomId") or p.get("room_id")
    }
    linked_ids: set[str] = set()
    for p in pins:
        for cid in p.get("captureIds") or p.get("capture_ids") or []:
            if cid:
                linked_ids.add(str(cid))

    # Captures whose roomId is on this floor (prefix) — survives room deletion.
    orphans = await db["captures"].find(
        {
            "orgId": org_id,
            "$or": [
                {"roomId": {"$regex": f"^{re.escape(floor_id)}"}},
                {"room_id": {"$regex": f"^{re.escape(floor_id)}"}},
            ],
        }
    ).to_list(length=5000)

    # Resolve floor plan + template fields from an existing pin when possible.
    template = pins[0] if pins else None
    if not floor_plan_id and template:
        floor_plan_id = str(template.get("floorPlanId") or template.get("floor_plan_id") or "")
    if not floor_plan_id:
        plan = await db["floor_plans"].find_one(
            {"orgId": org_id, "floorId": floor_id}, sort=[("createdAt", -1)]
        )
        floor_plan_id = str((plan or {}).get("_id") or (plan or {}).get("id") or "")
    if not floor_plan_id:
        logger.warning(
            "[pin-orphan] cannot restore orphans on floor={} — no floorPlanId",
            floor_id,
        )
        return 0

    # Place restored pins inside a real room-map polygon so Construction Progress
    # can draw a bounding box. Off-plan defaults (min-x - 8) landed on section
    # callouts with locate_pin=None and no heatmap box.
    default_x, default_y = await _placement_inside_room_map(
        db, org_id=org_id, floor_plan_id=floor_plan_id, existing_pins=pins,
    )

    used_seqs = {
        int(p.get("sequenceNumber") or p.get("sequence_number") or 0)
        for p in pins
    }
    restored = 0
    now = _utcnow()

    for cap in orphans:
        cap_id = str(cap.get("id") or cap.get("_id") or "")
        room_id = str(cap.get("roomId") or cap.get("room_id") or "")
        if not cap_id or not room_id:
            continue
        if cap_id in linked_ids:
            continue
        existing_pin = pin_by_room.get(room_id)
        if existing_pin:
            # Room-owned but missing from captureIds — just link.
            pin_key = existing_pin.get("_id") or existing_pin.get("id")
            if pin_key:
                await db["capture_pins"].update_one(
                    {"_id": pin_key, "orgId": org_id},
                    {"$addToSet": {"captureIds": cap_id}, "$set": {"updatedAt": now}},
                )
                linked_ids.add(cap_id)
                restored += 1
            continue

        room_name = str(cap.get("roomName") or cap.get("room_name") or "Pin")
        seq = _parse_pin_sequence(room_name)
        if seq is None or seq in used_seqs:
            seq = max(used_seqs | {0}) + 1
        used_seqs.add(seq)
        pin_name = f"Pin {seq}"

        flat_id = str(
            cap.get("flatId")
            or cap.get("flat_id")
            or f"{floor_id}-flat-a"
        )
        project_id = str(
            cap.get("projectId")
            or cap.get("project_id")
            or (template or {}).get("projectId")
            or ""
        )
        tower_id = str(
            cap.get("towerId")
            or cap.get("tower_id")
            or (template or {}).get("towerId")
            or ""
        )

        # Recreate backing room with the ORIGINAL id so the capture keeps linking.
        room_doc = {
            "_id": room_id,
            "id": room_id,
            "orgId": org_id,
            "org_id": org_id,
            "name": pin_name,
            "floorId": floor_id,
            "floor_id": floor_id,
            "flatId": flat_id,
            "flat_id": flat_id,
            "projectId": project_id,
            "project_id": project_id,
            "towerId": tower_id,
            "tower_id": tower_id,
            "type": "custom",
            "createdAt": now,
            "updatedAt": now,
            "created_at": now,
            "updated_at": now,
        }
        await db["rooms"].update_one(
            {"_id": room_id, "orgId": org_id},
            {"$setOnInsert": room_doc},
            upsert=True,
        )
        # Ensure name is correct even if a stale room shell existed.
        await db["rooms"].update_one(
            {"_id": room_id, "orgId": org_id},
            {"$set": {"name": pin_name, "updatedAt": now}},
        )

        pin_id = _pin_id_for_room(room_id, cap_id)
        # Avoid colliding with an unrelated live pin that reused the id.
        clash = await db["capture_pins"].find_one({"_id": pin_id, "orgId": org_id})
        if clash and str(clash.get("roomId") or "") != room_id:
            pin_id = f"pin-restored-{cap_id}"

        pin_doc = {
            "_id": pin_id,
            "id": pin_id,
            "orgId": org_id,
            "org_id": org_id,
            "floorPlanId": floor_plan_id,
            "floor_plan_id": floor_plan_id,
            "floorId": floor_id,
            "floor_id": floor_id,
            "towerId": tower_id,
            "tower_id": tower_id,
            "projectId": project_id,
            "project_id": project_id,
            "roomId": room_id,
            "room_id": room_id,
            "sequenceNumber": seq,
            "sequence_number": seq,
            "x": default_x,
            "y": default_y,
            "createdBy": str(cap.get("uploadedBy") or cap.get("uploaded_by") or "You"),
            "created_by": str(cap.get("uploadedBy") or cap.get("uploaded_by") or "You"),
            "createdAt": now,
            "updatedAt": now,
            "created_at": now,
            "updated_at": now,
            "captureIds": [cap_id],
        }
        await db["capture_pins"].update_one(
            {"_id": pin_id, "orgId": org_id},
            {"$set": pin_doc},
            upsert=True,
        )
        await db["captures"].update_one(
            {"orgId": org_id, "$or": [{"_id": cap_id}, {"id": cap_id}]},
            {"$set": {"roomName": pin_name, "room_name": pin_name, "updatedAt": now}},
        )
        pin_by_room[room_id] = pin_doc
        linked_ids.add(cap_id)
        restored += 1
        pins.append(pin_doc)
        # Next orphan gets a fresh empty-room centroid (not the same pixel).
        default_x, default_y = await _placement_inside_room_map(
            db, org_id=org_id, floor_plan_id=floor_plan_id, existing_pins=pins,
        )
        logger.info(
            "[pin-orphan] restored pin={} seq={} room={} capture={} on floor={}",
            pin_id, seq, room_id, cap_id, floor_id,
        )

    # Log pins outside room polygons — never relocate engineer placements.
    await heal_unlocated_pins_for_floor(
        db, org_id=org_id, floor_id=floor_id, floor_plan_id=floor_plan_id,
    )

    if restored and resequence:
        await resequence_pins_on_plan(db, org_id=org_id, floor_plan_id=floor_plan_id)

    return restored


async def restore_orphan_pins_for_org(db: AsyncIOMotorDatabase, *, org_id: str) -> int:
    """Scan all floors that have capture pins or floor-prefixed captures."""
    floor_ids: set[str] = set()
    async for pin in db["capture_pins"].find({"orgId": org_id}, {"floorId": 1}):
        fid = str(pin.get("floorId") or "")
        if fid:
            floor_ids.add(fid)
    # Also floors implied by orphan roomId prefixes (floorId is first 3 hyphen parts
    # for ids like t72554-f3-f72557-flat-a-r74055).
    async for cap in db["captures"].find({"orgId": org_id}, {"roomId": 1, "room_id": 1}):
        rid = str(cap.get("roomId") or cap.get("room_id") or "")
        parts = rid.split("-")
        if len(parts) >= 3:
            # t72554-f3-f72557
            floor_ids.add("-".join(parts[:3]))

    total = 0
    for floor_id in floor_ids:
        total += await restore_orphan_pins_for_floor(
            db, org_id=org_id, floor_id=floor_id, resequence=True
        )
    return total


async def resequence_pins_on_plan(
    db: AsyncIOMotorDatabase,
    *,
    org_id: str,
    floor_plan_id: str,
) -> None:
    """Renumber pins on a floor plan to contiguous 1..N (stable sort by current seq)."""
    if not floor_plan_id:
        return
    pins = await db["capture_pins"].find(
        {"orgId": org_id, "floorPlanId": floor_plan_id},
    ).sort("sequenceNumber", 1).to_list(length=2000)
    now = _utcnow()
    seq = 0
    for pin in pins:
        seq += 1
        pin_id = pin.get("_id") or pin.get("id")
        if not pin_id:
            continue
        if int(pin.get("sequenceNumber") or 0) == seq:
            continue
        room_id = pin.get("roomId") or pin.get("room_id")
        new_name = f"Pin {seq}"
        await db["capture_pins"].update_one(
            {"_id": pin_id, "orgId": org_id},
            {"$set": {"sequenceNumber": seq, "sequence_number": seq, "updatedAt": now}},
        )
        if room_id:
            await db["rooms"].update_one(
                {"_id": str(room_id), "orgId": org_id},
                {"$set": {"name": new_name, "updatedAt": now}},
            )
            await db["captures"].update_many(
                {"orgId": org_id, "roomId": str(room_id)},
                {"$set": {"roomName": new_name, "updatedAt": now}},
            )
