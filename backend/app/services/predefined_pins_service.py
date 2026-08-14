"""Predefined labeled capture points on floor plans.

Admin/manager places points with flatName + roomName. Engineers capture at
those points, or free-place (inherits nearest labeled point). Layouts can be
copied within the same tower (X/Y % + labels).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _oid(value: str | ObjectId) -> ObjectId | str:
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except Exception:
        return str(value)


def pin_distance_pct(ax: float, ay: float, bx: float, by: float) -> float:
    """Euclidean distance in floor-plan percent space."""
    return math.hypot(float(ax) - float(bx), float(ay) - float(by))


def find_nearest_labeled_pin(
    pins: list[dict[str, Any]],
    *,
    x: float,
    y: float,
    exclude_pin_id: str | None = None,
) -> dict[str, Any] | None:
    """Return the closest pin that has both flatName and roomName set."""
    best: dict[str, Any] | None = None
    best_d = float("inf")
    for pin in pins:
        pid = str(pin.get("_id") or pin.get("id") or "")
        if exclude_pin_id and pid == str(exclude_pin_id):
            continue
        flat = str(pin.get("flatName") or pin.get("flat_name") or "").strip()
        room = str(pin.get("roomName") or pin.get("room_name") or "").strip()
        if not flat or not room:
            continue
        try:
            px = float(pin["x"])
            py = float(pin["y"])
        except (KeyError, TypeError, ValueError):
            continue
        d = pin_distance_pct(x, y, px, py)
        if d < best_d:
            best_d = d
            best = pin
    return best


def apply_nearest_label(
    pin: dict[str, Any],
    labeled_pins: list[dict[str, Any]],
) -> dict[str, Any]:
    """Mutate a free-place pin dict with nearest labeled flat/room (copy)."""
    out = dict(pin)
    if str(out.get("flatName") or "").strip() and str(out.get("roomName") or "").strip():
        return out
    try:
        x = float(out["x"])
        y = float(out["y"])
    except (KeyError, TypeError, ValueError):
        return out
    nearest = find_nearest_labeled_pin(
        labeled_pins,
        x=x,
        y=y,
        exclude_pin_id=str(out.get("_id") or out.get("id") or "") or None,
    )
    if not nearest:
        return out
    out["flatName"] = str(nearest.get("flatName") or nearest.get("flat_name") or "")
    out["roomName"] = str(nearest.get("roomName") or nearest.get("room_name") or "")
    out["inheritedFromPinId"] = str(nearest.get("_id") or nearest.get("id") or "")
    out["source"] = out.get("source") or "freeplace"
    out["isPredefined"] = False
    return out


def pick_location_from_pin(pin: dict[str, Any] | None) -> tuple[str, str] | None:
    """Progress attribution preference for a capture pin.

    Order:
      1. Human review corrections (correctedFlatName / correctedRoomName)
      2. Pin flatName + roomName (predefined / copied / inherited)
      3. None → caller falls back to AI polygon lookup
    """
    if not pin:
        return None
    corr_flat = str(pin.get("correctedFlatName") or pin.get("corrected_flat_name") or "").strip()
    corr_room = str(pin.get("correctedRoomName") or pin.get("corrected_room_name") or "").strip()
    if corr_flat and corr_room:
        return corr_flat, corr_room
    flat = str(pin.get("flatName") or pin.get("flat_name") or "").strip()
    room = str(pin.get("roomName") or pin.get("room_name") or "").strip()
    if flat and room:
        return flat, room
    return None


def assert_same_tower(target_tower_id: str, source_tower_id: str) -> None:
    """Raise if copy-from crosses towers."""
    t = str(target_tower_id or "").strip()
    s = str(source_tower_id or "").strip()
    if not t or t != s:
        raise ValueError("copy is only allowed within the same tower")


class PredefinedPinsService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._db = db

    async def _next_sequence(self, org_id: str, floor_plan_id: str) -> int:
        cursor = (
            self._db["capture_pins"]
            .find({"orgId": org_id, "floorPlanId": floor_plan_id})
            .sort("sequenceNumber", -1)
            .limit(1)
        )
        docs = await cursor.to_list(length=1)
        if not docs:
            return 1
        try:
            return int(docs[0].get("sequenceNumber") or 0) + 1
        except (TypeError, ValueError):
            return 1

    async def _mark_layout_ready(self, org_id: str, floor_plan_id: str) -> None:
        count = await self._db["capture_pins"].count_documents(
            {
                "orgId": org_id,
                "floorPlanId": floor_plan_id,
                "isPredefined": True,
                "flatName": {"$exists": True, "$ne": ""},
                "roomName": {"$exists": True, "$ne": ""},
            }
        )
        status = "ready" if count > 0 else "draft"
        await self._db["floor_plans"].update_one(
            {"_id": _oid(floor_plan_id), "orgId": org_id},
            {"$set": {"pinLayoutStatus": status, "updatedAt": _utcnow()}},
        )

    async def create_predefined_pin(
        self,
        *,
        org_id: str,
        floor_plan_id: str,
        payload: dict[str, Any],
        created_by: str | None = None,
    ) -> dict[str, Any]:
        plan = await self._db["floor_plans"].find_one(
            {"orgId": org_id, "$or": [{"_id": _oid(floor_plan_id)}, {"id": floor_plan_id}]}
        )
        if not plan:
            raise ValueError("floor plan not found")

        flat_name = str(payload.get("flatName") or "").strip()
        room_name = str(payload.get("roomName") or "").strip()
        if not flat_name or not room_name:
            raise ValueError("flatName and roomName are required")

        x = float(payload["x"])
        y = float(payload["y"])
        label = str(payload.get("label") or room_name).strip()
        seq = await self._next_sequence(org_id, floor_plan_id)
        pin_id = str(ObjectId())
        room_id = str(payload.get("roomId") or f"{plan.get('floorId')}-predef-{pin_id[-6:]}")

        # Ensure a backing room exists for capture join (name = room label).
        # `name` must only appear in $set — Mongo rejects the same path in both
        # $setOnInsert and $set ("Updating the path 'name' would create a conflict").
        await self._db["rooms"].update_one(
            {"_id": room_id, "orgId": org_id},
            {
                "$setOnInsert": {
                    "_id": room_id,
                    "id": room_id,
                    "orgId": org_id,
                    "floorId": plan.get("floorId"),
                    "towerId": plan.get("towerId"),
                    "projectId": plan.get("projectId"),
                    "room_number": f"Pin {seq}",
                    "type": "custom",
                    "createdAt": _utcnow(),
                },
                "$set": {
                    "name": room_name,
                    # Heal older rooms that were created without tower/project.
                    "towerId": plan.get("towerId"),
                    "projectId": plan.get("projectId"),
                    "floorId": plan.get("floorId"),
                    "updatedAt": _utcnow(),
                },
            },
            upsert=True,
        )

        doc = {
            "_id": pin_id,
            "id": pin_id,
            "orgId": org_id,
            "floorPlanId": floor_plan_id,
            "floorId": plan.get("floorId"),
            "towerId": plan.get("towerId"),
            "projectId": plan.get("projectId"),
            "roomId": room_id,
            "sequenceNumber": seq,
            "x": x,
            "y": y,
            "flatName": flat_name,
            "roomName": room_name,
            "label": label,
            "source": "predefined",
            "isPredefined": True,
            "captureIds": [],
            "createdBy": created_by or "system",
            "createdAt": _utcnow(),
            "updatedAt": _utcnow(),
        }
        await self._db["capture_pins"].insert_one(doc)
        await self._mark_layout_ready(org_id, floor_plan_id)
        out = {**doc, "id": pin_id}
        out.pop("_id", None)
        out["_id"] = pin_id
        return out

    async def update_predefined_pin(
        self,
        *,
        org_id: str,
        floor_plan_id: str,
        pin_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        allowed = {"x", "y", "flatName", "roomName", "label", "sequenceNumber"}
        updates = {k: patch[k] for k in allowed if k in patch}
        if "flatName" in updates:
            updates["flatName"] = str(updates["flatName"]).strip()
        if "roomName" in updates:
            updates["roomName"] = str(updates["roomName"]).strip()
        if not updates:
            pin = await self._db["capture_pins"].find_one(
                {"_id": _oid(pin_id), "orgId": org_id, "floorPlanId": floor_plan_id}
            )
            if not pin:
                raise ValueError("pin not found")
            return pin

        updates["updatedAt"] = _utcnow()
        # Keep predefined flag when labels are present.
        if updates.get("flatName") and updates.get("roomName"):
            updates["isPredefined"] = True
            updates.setdefault("source", "predefined")

        result = await self._db["capture_pins"].find_one_and_update(
            {"_id": _oid(pin_id), "orgId": org_id, "floorPlanId": floor_plan_id},
            {"$set": updates},
            return_document=True,
        )
        if not result:
            raise ValueError("pin not found")
        await self._mark_layout_ready(org_id, floor_plan_id)
        return result

    async def delete_predefined_pin(
        self,
        *,
        org_id: str,
        floor_plan_id: str,
        pin_id: str,
        force: bool = False,
    ) -> None:
        pin = await self._db["capture_pins"].find_one(
            {"_id": _oid(pin_id), "orgId": org_id, "floorPlanId": floor_plan_id}
        )
        if not pin:
            raise ValueError("pin not found")
        caps = pin.get("captureIds") or pin.get("capture_ids") or []
        if caps and not force:
            raise ValueError("pin has captures; delete captures first or pass force=true")
        await self._db["capture_pins"].delete_one({"_id": _oid(pin_id), "orgId": org_id})
        await self._mark_layout_ready(org_id, floor_plan_id)

    async def set_pins_visibility(
        self, *, org_id: str, floor_plan_id: str, visible: bool
    ) -> dict[str, Any]:
        # Match other floor-plan lookups: client ids are strings like "fp74609",
        # not always ObjectIds. Querying only {"_id": ObjectId(...)} caused 422
        # "floor plan not found" right after upload/import.
        filt = {
            "orgId": org_id,
            "$or": [
                {"_id": _oid(floor_plan_id)},
                {"_id": floor_plan_id},
                {"id": floor_plan_id},
            ],
        }
        result = await self._db["floor_plans"].find_one_and_update(
            filt,
            {"$set": {"pinsVisible": bool(visible), "updatedAt": _utcnow()}},
            return_document=True,
        )
        if not result:
            raise ValueError("floor plan not found")
        return result

    async def copy_pins_from_floor(
        self,
        *,
        org_id: str,
        target_floor_id: str,
        source_floor_id: str,
        created_by: str | None = None,
        target_floor_plan_id: str | None = None,
        source_floor_plan_id: str | None = None,
    ) -> dict[str, Any]:
        if target_floor_id == source_floor_id:
            raise ValueError("source and target floors must differ")

        target_floor = await self._db["floors"].find_one(
            {"$or": [{"_id": _oid(target_floor_id)}, {"id": target_floor_id}], "orgId": org_id}
        )
        source_floor = await self._db["floors"].find_one(
            {"$or": [{"_id": _oid(source_floor_id)}, {"id": source_floor_id}], "orgId": org_id}
        )
        if not target_floor:
            target_floor = await self._db["floors"].find_one({"id": target_floor_id, "orgId": org_id})
        if not source_floor:
            source_floor = await self._db["floors"].find_one({"id": source_floor_id, "orgId": org_id})

        async def _latest_plan(floor_id: str) -> dict[str, Any] | None:
            return await self._db["floor_plans"].find_one(
                {"orgId": org_id, "floorId": floor_id}, sort=[("createdAt", -1)]
            )

        async def _plan_by_id(plan_id: str | None) -> dict[str, Any] | None:
            if not plan_id:
                return None
            return await self._db["floor_plans"].find_one(
                {"orgId": org_id, "$or": [{"_id": _oid(plan_id)}, {"id": plan_id}]}
            )

        async def _best_labeled_plan(floor_id: str) -> dict[str, Any] | None:
            """Prefer the floor-plan record that actually owns labeled pins.

            Re-uploads create a newer empty plan; annotations often remain on the
            older record. Picking strictly by createdAt made copy-from import 0 points.
            """
            plans = await self._db["floor_plans"].find(
                {"orgId": org_id, "floorId": floor_id}
            ).sort("createdAt", -1).to_list(length=50)
            if not plans:
                return None
            best = None
            best_count = -1
            for plan in plans:
                pid = str(plan.get("_id") or plan.get("id") or "")
                if not pid:
                    continue
                count = await self._db["capture_pins"].count_documents(
                    {
                        "orgId": org_id,
                        "$or": [{"floorPlanId": pid}, {"floorPlanId": str(plan.get("id") or "")}],
                        "flatName": {"$exists": True, "$nin": [None, ""]},
                        "roomName": {"$exists": True, "$nin": [None, ""]},
                    }
                )
                if count > best_count:
                    best_count = count
                    best = plan
            return best if best_count > 0 else plans[0]

        target_plan = await _plan_by_id(target_floor_plan_id) or await _latest_plan(target_floor_id)
        source_plan = await _plan_by_id(source_floor_plan_id) or await _best_labeled_plan(source_floor_id)

        if not target_plan or not source_plan:
            raise ValueError("source or target floor plan not found")

        if target_floor and source_floor:
            t_tower = str(target_floor.get("towerId") or target_floor.get("tower_id") or "")
            s_tower = str(source_floor.get("towerId") or source_floor.get("tower_id") or "")
        else:
            t_tower = str(target_plan.get("towerId") or "")
            s_tower = str(source_plan.get("towerId") or "")
        assert_same_tower(t_tower, s_tower)

        source_plan_id = str(source_plan.get("_id") or source_plan.get("id") or "")
        target_plan_id = str(target_plan.get("_id") or target_plan.get("id") or "")
        source_plan_alt = str(source_plan.get("id") or "")

        # Prefer labeled pins on the chosen source plan; fall back to any labeled
        # pins on the source floor (covers plan-id drift after re-upload).
        source_pins = await self._db["capture_pins"].find(
            {
                "orgId": org_id,
                "$or": [
                    {"floorPlanId": source_plan_id},
                    *([{"floorPlanId": source_plan_alt}] if source_plan_alt and source_plan_alt != source_plan_id else []),
                ],
                "flatName": {"$exists": True, "$nin": [None, ""]},
                "roomName": {"$exists": True, "$nin": [None, ""]},
            }
        ).sort("sequenceNumber", 1).to_list(length=500)

        if not source_pins:
            source_pins = await self._db["capture_pins"].find(
                {
                    "orgId": org_id,
                    "floorId": source_floor_id,
                    "flatName": {"$exists": True, "$nin": [None, ""]},
                    "roomName": {"$exists": True, "$nin": [None, ""]},
                }
            ).sort("sequenceNumber", 1).to_list(length=500)

        if not source_pins:
            source_pins = await self._db["capture_pins"].find(
                {
                    "orgId": org_id,
                    "$or": [
                        {"floorPlanId": source_plan_id},
                        {"floorId": source_floor_id},
                    ],
                    "isPredefined": True,
                }
            ).sort("sequenceNumber", 1).to_list(length=500)

        if not source_pins:
            raise ValueError("source floor has no labeled predefined pins")

        # Deduplicate by sequence / coordinates if floor-wide fallback pulled overlaps.
        seen_keys: set[str] = set()
        unique_source: list[dict[str, Any]] = []
        for src in source_pins:
            key = f"{float(src.get('x', 0)):.3f}:{float(src.get('y', 0)):.3f}:{src.get('flatName')}:{src.get('roomName')}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            unique_source.append(src)
        source_pins = unique_source

        # Remove empty predefined pins on target (keep pins that already have captures).
        existing = await self._db["capture_pins"].find(
            {"orgId": org_id, "floorPlanId": target_plan_id}
        ).to_list(length=500)
        # Also clear empties keyed by alternate id field.
        target_alt = str(target_plan.get("id") or "")
        if target_alt and target_alt != target_plan_id:
            existing += await self._db["capture_pins"].find(
                {"orgId": org_id, "floorPlanId": target_alt}
            ).to_list(length=500)

        preserved: list[dict[str, Any]] = []
        preserved_coord_keys: set[str] = set()
        preserved_fr_keys: set[str] = set()
        for pin in existing:
            caps = pin.get("captureIds") or pin.get("capture_ids") or []
            if caps:
                preserved.append(pin)
                preserved_coord_keys.add(
                    f"{float(pin.get('x', 0)):.3f}:{float(pin.get('y', 0)):.3f}:"
                    f"{pin.get('flatName')}:{pin.get('roomName')}"
                )
                flat = str(pin.get("flatName") or "").strip()
                room = str(pin.get("roomName") or "").strip()
                if flat and room:
                    preserved_fr_keys.add(f"{flat}|{room}")
                continue
            if pin.get("isPredefined") or (
                pin.get("flatName") and pin.get("roomName") and not caps
            ):
                await self._db["capture_pins"].delete_one({"_id": pin["_id"], "orgId": org_id})

        created: list[dict[str, Any]] = []
        errors = 0
        for src in source_pins:
            flat = str(src.get("flatName") or src.get("flat_name") or "").strip()
            room = str(src.get("roomName") or src.get("room_name") or "").strip()
            coord_key = (
                f"{float(src.get('x', 0)):.3f}:{float(src.get('y', 0)):.3f}:{flat}:{room}"
            )
            # Do not duplicate a target pin that already has captures for this room.
            if coord_key in preserved_coord_keys or (flat and room and f"{flat}|{room}" in preserved_fr_keys):
                continue
            try:
                doc = await self.create_predefined_pin(
                    org_id=org_id,
                    floor_plan_id=target_plan_id,
                    payload={
                        "x": float(src["x"]),
                        "y": float(src["y"]),
                        "flatName": flat,
                        "roomName": room,
                        "label": src.get("label") or room,
                    },
                    created_by=created_by,
                )
                await self._db["capture_pins"].update_one(
                    {"$or": [{"_id": _oid(doc["id"])}, {"_id": doc["id"]}, {"id": doc["id"]}], "orgId": org_id},
                    {"$set": {"source": "copied", "copiedFromPinId": str(src.get("_id") or src.get("id") or "")}},
                )
                doc["source"] = "copied"
                created.append(doc)
            except Exception as exc:
                errors += 1
                logger.warning("copy pin failed: {}", exc)

        # Include preserved capture pins in the response so the client keeps timelines.
        def _pin_out(p: dict[str, Any]) -> dict[str, Any]:
            out = {**p, "id": str(p.get("id") or p.get("_id") or "")}
            out.pop("_id", None)
            return out

        result_pins = created + [_pin_out(p) for p in preserved]
        if not result_pins:
            raise ValueError(
                f"failed to copy pins from source floor ({len(source_pins)} found, {errors} errors)"
            )

        await self._db["floor_plans"].update_one(
            {"orgId": org_id, "$or": [{"_id": _oid(target_plan_id)}, {"id": target_plan_id}]},
            {
                "$set": {
                    "copiedFromFloorPlanId": source_plan_id,
                    "pinLayoutStatus": "ready",
                    "needsReannotate": False,
                    "pinsVisible": True,
                    "updatedAt": _utcnow(),
                }
            },
        )
        return {
            "copiedCount": len(result_pins),
            "pins": result_pins,
            "targetFloorPlanId": target_plan_id,
            "sourceFloorPlanId": source_plan_id,
        }

    async def resolve_and_stamp_freeplace(
        self,
        *,
        org_id: str,
        pin_id: str,
    ) -> dict[str, Any] | None:
        """If pin lacks labels, stamp nearest predefined labels onto it."""
        pin = await self._db["capture_pins"].find_one({"_id": _oid(pin_id), "orgId": org_id})
        if not pin:
            return None
        if str(pin.get("flatName") or "").strip() and str(pin.get("roomName") or "").strip():
            return pin
        floor_plan_id = str(pin.get("floorPlanId") or "")
        labeled = await self._db["capture_pins"].find(
            {
                "orgId": org_id,
                "floorPlanId": floor_plan_id,
                "flatName": {"$exists": True, "$nin": [None, ""]},
                "roomName": {"$exists": True, "$nin": [None, ""]},
            }
        ).to_list(length=500)
        stamped = apply_nearest_label(pin, labeled)
        if stamped.get("flatName") and stamped.get("roomName"):
            await self._db["capture_pins"].update_one(
                {"_id": pin["_id"], "orgId": org_id},
                {
                    "$set": {
                        "flatName": stamped["flatName"],
                        "roomName": stamped["roomName"],
                        "inheritedFromPinId": stamped.get("inheritedFromPinId"),
                        "source": "freeplace",
                        "isPredefined": False,
                        "updatedAt": _utcnow(),
                    }
                },
            )
            pin.update(
                {
                    "flatName": stamped["flatName"],
                    "roomName": stamped["roomName"],
                    "inheritedFromPinId": stamped.get("inheritedFromPinId"),
                    "source": "freeplace",
                }
            )
        return pin

    async def mark_plan_needs_reannotate(self, *, org_id: str, floor_plan_id: str) -> None:
        """Called when a floor plan image is replaced — labels/coords are untrusted."""
        await self._db["floor_plans"].update_one(
            {"_id": _oid(floor_plan_id), "orgId": org_id},
            {
                "$set": {
                    "pinLayoutStatus": "draft",
                    "needsReannotate": True,
                    "updatedAt": _utcnow(),
                },
                "$unset": {"copiedFromFloorPlanId": ""},
            },
        )
        # Strip labels from pins that have no captures so admin must re-place.
        await self._db["capture_pins"].update_many(
            {
                "orgId": org_id,
                "floorPlanId": floor_plan_id,
                "$or": [{"captureIds": {"$size": 0}}, {"captureIds": {"$exists": False}}],
            },
            {
                "$unset": {
                    "flatName": "",
                    "roomName": "",
                    "label": "",
                    "inheritedFromPinId": "",
                },
                "$set": {"isPredefined": False, "source": "freeplace", "updatedAt": _utcnow()},
            },
        )
