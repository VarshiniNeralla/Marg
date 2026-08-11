"""Apply human construction-progress review corrections to pins + snapshots.

Reviews used to be judgment-only. Floor-1 feedback showed pin room mistakes and
activity % errors that must actually update the live attribution / displayed
scores so the next UI load matches the reviewer's intent.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.room_map_service import RoomMapService, _canonical_flat_label, _point_in_polygon

logger = logging.getLogger(__name__)

_PINS = "capture_pins"
_SNAPSHOTS = "construction_progress_snapshots"
_REVIEWS = "construction_progress_reviews"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _norm_room(name: str) -> str:
    s = (name or "").strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[/_\-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _rooms_match(a: str, b: str) -> bool:
    na, nb = _norm_room(a), _norm_room(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # Living / Dining ↔ Living and Dining ↔ Living Dining
    if na.replace(" ", "") == nb.replace(" ", ""):
        return True
    # Do NOT use substring containment — "Master Bedroom" must not match
    # "Sit-Out (Master Bedroom)" or "Dress (Master Bedroom)".
    return False


def _polygon_centroid(poly: list[dict[str, float]]) -> tuple[float, float] | None:
    if not poly:
        return None
    xs = [float(p["x"]) for p in poly if "x" in p and "y" in p]
    ys = [float(p["y"]) for p in poly if "x" in p and "y" in p]
    if not xs:
        return None
    return (sum(xs) / len(xs), sum(ys) / len(ys))


class ReviewCorrectionApplier:
    """Writes pin room overrides + snapshot activity % from human reviews."""

    def __init__(self, db: AsyncIOMotorDatabase):
        self._db = db
        self._room_maps = RoomMapService(db)

    async def apply_from_review_doc(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Apply pin + activity corrections encoded in one review document."""
        org_id = str(doc.get("orgId") or doc.get("org_id") or "")
        floor_id = str(doc.get("floorId") or doc.get("floor_id") or "")
        flat_name = str(doc.get("flatName") or doc.get("flat_name") or "")
        room_name = str(doc.get("roomName") or doc.get("room_name") or "")
        snapshot_id = str(doc.get("snapshotId") or doc.get("snapshot_id") or "")

        pin_verdicts = list(doc.get("pinRoomVerdicts") or [])
        pin_result = await self.apply_pin_verdicts(
            org_id=org_id,
            floor_id=floor_id,
            flat_name=flat_name,
            pin_verdicts=pin_verdicts,
            legacy_room_correct=doc.get("roomCorrect"),
            legacy_actual_room=doc.get("actualRoom"),
            legacy_pin_numbers=doc.get("pinNumbers") or [],
        )

        # If every pin on the card was remapped to the same actual room, the
        # photos (and activity judgments) belong there — not the mislabelled room.
        activity_room = room_name
        no_verdicts = [
            v for v in pin_verdicts
            if isinstance(v, dict) and (v.get("roomCorrect") or v.get("room_correct")) == "no"
        ]
        yes_verdicts = [
            v for v in pin_verdicts
            if isinstance(v, dict) and (v.get("roomCorrect") or v.get("room_correct")) == "yes"
        ]
        if not pin_verdicts and doc.get("roomCorrect") == "no" and doc.get("actualRoom"):
            activity_room = str(doc.get("actualRoom")).strip() or room_name
        elif no_verdicts and not yes_verdicts:
            destinations = {
                str(v.get("actualRoom") or v.get("actual_room") or "").strip()
                for v in no_verdicts
            }
            destinations.discard("")
            if len(destinations) == 1:
                activity_room = next(iter(destinations))

        activity_result = await self.apply_activity_corrections(
            org_id=org_id,
            floor_id=floor_id,
            flat_name=flat_name,
            room_name=activity_room,
            snapshot_id=snapshot_id,
            corrections=doc.get("activityCorrections") or [],
        )
        return {
            "pins": pin_result,
            "activities": activity_result,
            "activityRoom": activity_room,
        }

    async def apply_pin_verdicts(
        self,
        *,
        org_id: str,
        floor_id: str,
        flat_name: str,
        pin_verdicts: list[Any],
        legacy_room_correct: Any = None,
        legacy_actual_room: Any = None,
        legacy_pin_numbers: list[Any] | None = None,
    ) -> dict[str, Any]:
        verdicts: list[dict[str, Any]] = [v for v in pin_verdicts if isinstance(v, dict)]
        if not verdicts and legacy_room_correct == "no" and legacy_actual_room:
            for n in legacy_pin_numbers or []:
                try:
                    verdicts.append({
                        "pinNumber": int(n),
                        "roomCorrect": "no",
                        "actualRoom": str(legacy_actual_room),
                    })
                except (TypeError, ValueError):
                    continue

        applied: list[dict[str, Any]] = []
        for v in verdicts:
            if (v.get("roomCorrect") or v.get("room_correct")) != "no":
                continue
            actual = (v.get("actualRoom") or v.get("actual_room") or "").strip()
            if not actual:
                continue
            try:
                seq = int(v.get("pinNumber") if v.get("pinNumber") is not None else v.get("pin_number"))
            except (TypeError, ValueError):
                continue
            updated = await self.correct_pin_room(
                org_id=org_id,
                floor_id=floor_id,
                sequence_number=seq,
                flat_name=flat_name,
                room_name=actual,
                # Never move engineer pin tips — only re-label attribution.
                nudge_coords=False,
            )
            if updated:
                applied.append(updated)
        return {"appliedCount": len(applied), "pins": applied}

    async def correct_pin_room(
        self,
        *,
        org_id: str,
        floor_id: str,
        sequence_number: int,
        flat_name: str,
        room_name: str,
        nudge_coords: bool = False,
    ) -> dict[str, Any] | None:
        pin = await self._db[_PINS].find_one({
            "orgId": org_id,
            "floorId": floor_id,
            "sequenceNumber": sequence_number,
        })
        if not pin:
            logger.warning(
                "Pin correction skipped — no pin seq=%s on floor=%s",
                sequence_number, floor_id,
            )
            return None

        floor_plan_id = str(pin.get("floorPlanId") or pin.get("floor_plan_id") or "")
        new_x = pin.get("x")
        new_y = pin.get("y")
        nudged = False

        if nudge_coords and floor_plan_id:
            try:
                flats = await self._room_maps.get_sanitized_flats(floor_plan_id, org_id)
                target = self._find_room_polygon(flats, flat_name, room_name)
                if target:
                    poly = target.get("polygon") or []
                    try:
                        px, py = float(pin.get("x")), float(pin.get("y"))
                    except (TypeError, ValueError):
                        px = py = None
                    inside = (
                        px is not None
                        and py is not None
                        and poly
                        and _point_in_polygon(px, py, poly)
                    )
                    if not inside:
                        centroid = _polygon_centroid(poly)
                        if centroid:
                            new_x, new_y = centroid
                            nudged = True
            except Exception as exc:
                logger.warning("Pin nudge failed seq=%s: %s", sequence_number, exc)

        now = _utcnow()
        update: dict[str, Any] = {
            "correctedFlatName": flat_name,
            "correctedRoomName": room_name,
            "attributionSource": "human",
            "attributionUpdatedAt": now,
            "updatedAt": now,
        }
        if nudged:
            update["x"] = new_x
            update["y"] = new_y
            update["previousX"] = pin.get("x")
            update["previousY"] = pin.get("y")

        await self._db[_PINS].update_one({"_id": pin["_id"]}, {"$set": update})
        logger.info(
            "Applied pin correction seq=%s → %s / %s (nudged=%s)",
            sequence_number, flat_name, room_name, nudged,
        )
        return {
            "pinId": str(pin.get("_id") or pin.get("id") or ""),
            "sequenceNumber": sequence_number,
            "flatName": flat_name,
            "roomName": room_name,
            "nudged": nudged,
            "x": new_x,
            "y": new_y,
        }

    def _find_room_polygon(
        self,
        flats: list[dict[str, Any]],
        flat_name: str,
        room_name: str,
    ) -> dict[str, Any] | None:
        want_flat = _canonical_flat_label(flat_name)
        for flat in flats:
            fname = _canonical_flat_label(str(flat.get("flat") or flat.get("flatName") or ""))
            if fname != want_flat:
                continue
            for room in flat.get("rooms") or []:
                rname = str(room.get("name") or room.get("roomName") or "")
                if _rooms_match(rname, room_name):
                    return room
        return None

    async def apply_activity_corrections(
        self,
        *,
        org_id: str,
        floor_id: str,
        flat_name: str,
        room_name: str,
        snapshot_id: str,
        corrections: list[Any],
    ) -> dict[str, Any]:
        usable = [c for c in corrections if isinstance(c, dict) and c.get("activityId")]
        if not usable:
            return {"updatedCount": 0}

        # Always patch the LATEST floor snapshot so UI (which loads latest) reflects
        # corrections even when the review was filed against an older analyze run.
        snap = await self._db[_SNAPSHOTS].find_one(
            {"orgId": org_id, "floorId": floor_id},
            sort=[("snapshotDate", -1)],
        )
        if not snap and snapshot_id:
            from bson import ObjectId

            oid = ObjectId(snapshot_id) if ObjectId.is_valid(snapshot_id) else snapshot_id
            snap = await self._db[_SNAPSHOTS].find_one({"_id": oid, "orgId": org_id})
            if not snap:
                snap = await self._db[_SNAPSHOTS].find_one({
                    "orgId": org_id,
                    "$or": [{"_id": snapshot_id}, {"id": snapshot_id}],
                })
        if not snap:
            return {"updatedCount": 0, "error": "snapshot_not_found"}

        corr_by_id = {
            str(c.get("activityId")): c
            for c in usable
            if c.get("activityId")
        }
        updated = 0
        flats = list(snap.get("flatProgress") or [])
        want_flat = _canonical_flat_label(flat_name)
        target_room = None
        target_fp = None

        for fp in flats:
            if _canonical_flat_label(str(fp.get("flatName") or "")) != want_flat:
                continue
            for room in fp.get("rooms") or []:
                if not _rooms_match(str(room.get("roomName") or ""), room_name):
                    continue
                target_room = room
                target_fp = fp
                break
            if target_room:
                break

        if target_room is None:
            # Create the flat/room entry so corrections still land (pin moved here).
            target_fp = next(
                (
                    fp for fp in flats
                    if _canonical_flat_label(str(fp.get("flatName") or "")) == want_flat
                ),
                None,
            )
            if target_fp is None:
                target_fp = {
                    "flatName": flat_name,
                    "completionPct": 0.0,
                    "roomsComplete": 0,
                    "roomsTotal": 0,
                    "rooms": [],
                }
                flats.append(target_fp)
            target_room = {
                "roomName": room_name,
                "isComplete": False,
                "activities": [],
                "pinNumbers": [],
                "capturesCount": 0,
            }
            target_fp.setdefault("rooms", []).append(target_room)

        by_id = {
            str(a.get("activityId") or ""): a
            for a in (target_room.get("activities") or [])
            if a.get("activityId")
        }

        for aid, corr in corr_by_id.items():
            pct = corr.get("correctPercentage")
            if pct is None:
                pct = corr.get("correct_percentage")
            if pct is None:
                continue
            try:
                pct_f = float(pct)
            except (TypeError, ValueError):
                continue
            pct_f = max(0.0, min(100.0, pct_f))
            verdict = str(corr.get("verdict") or "")
            note = str(corr.get("note") or corr.get("reason") or "")
            if pct_f >= 100.0:
                status = "completed"
            else:
                # Human-reviewed → always assessed (never "No Photos Yet").
                status = "in_progress"

            act = by_id.get(aid)
            if act is None:
                names = {}
                try:
                    from app.services.construction_progress_providers.activities import activities_as_dicts
                    names = {
                        str(a.get("activityId") or ""): str(a.get("name") or "")
                        for a in activities_as_dicts()
                    }
                except Exception:
                    names = {}
                act = {
                    "activityId": aid,
                    "activityName": names.get(aid) or aid.split(".")[-1].replace("_", " ").title(),
                    "completionPct": pct_f,
                    "confidencePct": 90.0,
                    "evidenceCaptureIds": [],
                    "evidence": note,
                    "status": status,
                    "humanCorrected": True,
                    "humanVerdict": verdict,
                }
                target_room.setdefault("activities", []).append(act)
            else:
                act["completionPct"] = pct_f
                act["completion_pct"] = pct_f
                act["humanCorrected"] = True
                act["humanVerdict"] = verdict
                if note:
                    act["evidence"] = note
                act["status"] = status
            updated += 1

        # Floor-level activity cards are averages — leave them alone.
        if updated:
            await self._db[_SNAPSHOTS].update_one(
                {"_id": snap["_id"]},
                {
                    "$set": {
                        "flatProgress": flats,
                        "updatedAt": _utcnow(),
                        "humanCorrectionsAppliedAt": _utcnow(),
                    }
                },
            )
            # Rebuild heatmap pin room labels from pin overrides when possible.
            await self._relabel_heatmap_pins(snap)

        return {"updatedCount": updated, "snapshotId": str(snap.get("_id") or "")}

    async def _relabel_heatmap_pins(self, snap: dict[str, Any]) -> None:
        pins = await self._db[_PINS].find({
            "orgId": snap.get("orgId"),
            "floorId": snap.get("floorId"),
        }).to_list(1000)
        by_seq = {
            int(p["sequenceNumber"]): p
            for p in pins
            if p.get("sequenceNumber") is not None
            and p.get("correctedFlatName")
            and p.get("correctedRoomName")
        }
        if not by_seq:
            return
        heatmap = list(snap.get("heatmapPins") or [])
        changed = False
        for hp in heatmap:
            try:
                seq = int(hp.get("sequenceNumber"))
            except (TypeError, ValueError):
                continue
            pin = by_seq.get(seq)
            if not pin:
                continue
            hp["flatName"] = pin["correctedFlatName"]
            hp["roomName"] = pin["correctedRoomName"]
            if pin.get("x") is not None:
                hp["x"] = pin["x"]
            if pin.get("y") is not None:
                hp["y"] = pin["y"]
            changed = True
        if changed:
            await self._db[_SNAPSHOTS].update_one(
                {"_id": snap["_id"]},
                {"$set": {"heatmapPins": heatmap}},
            )

    async def backfill_floor(self, *, org_id: str, floor_id: str) -> dict[str, Any]:
        docs = await self._db[_REVIEWS].find({
            "orgId": org_id,
            "floorId": floor_id,
        }).sort("createdAt", 1).to_list(5_000)
        pin_apps = 0
        act_apps = 0
        for doc in docs:
            result = await self.apply_from_review_doc(doc)
            pin_apps += int((result.get("pins") or {}).get("appliedCount") or 0)
            act_apps += int((result.get("activities") or {}).get("updatedCount") or 0)
        # After pin moves, re-stamp pinNumbers + heatmap labels on the latest snapshot.
        await self._refresh_room_pin_numbers(org_id=org_id, floor_id=floor_id)
        latest = await self._db[_SNAPSHOTS].find_one(
            {"orgId": org_id, "floorId": floor_id},
            sort=[("snapshotDate", -1)],
        )
        if latest:
            await self._relabel_heatmap_pins(latest)
        return {
            "reviewsProcessed": len(docs),
            "pinCorrectionsApplied": pin_apps,
            "activityPctUpdates": act_apps,
        }

    async def _refresh_room_pin_numbers(self, *, org_id: str, floor_id: str) -> None:
        snap = await self._db[_SNAPSHOTS].find_one(
            {"orgId": org_id, "floorId": floor_id},
            sort=[("snapshotDate", -1)],
        )
        if not snap:
            return
        pins = await self._db[_PINS].find({"orgId": org_id, "floorId": floor_id}).to_list(1000)
        # Build (flat, room) → sequences using overrides first, else heatmap.
        from collections import defaultdict

        grouping: dict[tuple[str, str], list[int]] = defaultdict(list)
        heatmap_by_seq = {
            int(h["sequenceNumber"]): h
            for h in (snap.get("heatmapPins") or [])
            if h.get("sequenceNumber") is not None
        }
        for p in pins:
            try:
                seq = int(p.get("sequenceNumber"))
            except (TypeError, ValueError):
                continue
            if p.get("correctedFlatName") and p.get("correctedRoomName"):
                flat = str(p["correctedFlatName"])
                room = str(p["correctedRoomName"])
            else:
                h = heatmap_by_seq.get(seq) or {}
                flat = str(h.get("flatName") or "")
                room = str(h.get("roomName") or "")
            if flat and room:
                grouping[(_canonical_flat_label(flat), _norm_room(room))].append(seq)

        flats = list(snap.get("flatProgress") or [])
        for fp in flats:
            fname = _canonical_flat_label(str(fp.get("flatName") or ""))
            for room in fp.get("rooms") or []:
                key = (fname, _norm_room(str(room.get("roomName") or "")))
                seqs = sorted(set(grouping.get(key) or []))
                # Preserve existing if we have nothing better, but clear wrong ones
                # when overrides moved pins out.
                room["pinNumbers"] = seqs
                room["capturesCount"] = max(int(room.get("capturesCount") or 0), len(seqs))

        await self._db[_SNAPSHOTS].update_one(
            {"_id": snap["_id"]},
            {"$set": {"flatProgress": flats, "updatedAt": _utcnow()}},
        )
