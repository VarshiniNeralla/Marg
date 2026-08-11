"""Construction-progress human review persistence (T3).

Reviews stamp model / promptVersion / rigVersion so accuracy summaries never
pool a "before" with an "after".

As of Floor-1 calibration, submitting a review ALSO applies corrections:
- pinRoomVerdicts with roomCorrect=no → pin attribution override (+ optional nudge)
- activityCorrections.correctPercentage → overwrite that room's activity % on the snapshot

A readable copy is appended to project-root ``manual_review.json``.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

_COLLECTION = "construction_progress_reviews"
_SNAPSHOTS = "construction_progress_snapshots"
# backend/app/services/ → repo root
_MANUAL_REVIEW_PATH = Path(__file__).resolve().parents[3] / "manual_review.json"

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _activity_name_lookup() -> dict[str, str]:
    try:
        from app.services.construction_progress_providers.activities import activities_as_dicts
        return {
            str(a.get("activityId") or ""): str(a.get("name") or "")
            for a in activities_as_dicts()
            if a.get("activityId")
        }
    except Exception:
        return {}


def _readable_review(doc: dict[str, Any]) -> dict[str, Any]:
    """Human-friendly shape for manual_review.json (not the API payload)."""
    names = _activity_name_lookup()
    pin_verdicts = doc.get("pinRoomVerdicts") or doc.get("pin_room_verdicts") or []
    pins = []
    if pin_verdicts:
        for v in pin_verdicts:
            if not isinstance(v, dict):
                continue
            pins.append({
                "pinNumber": v.get("pinNumber") if v.get("pinNumber") is not None else v.get("pin_number"),
                "roomCorrect": v.get("roomCorrect") or v.get("room_correct"),
                "actualRoom": v.get("actualRoom") or v.get("actual_room"),
            })
    else:
        for n in doc.get("pinNumbers") or doc.get("pin_numbers") or []:
            pins.append({
                "pinNumber": n,
                "roomCorrect": doc.get("roomCorrect") or doc.get("room_correct"),
                "actualRoom": doc.get("actualRoom") or doc.get("actual_room"),
            })

    activities = []
    for corr in doc.get("activityCorrections") or doc.get("activity_corrections") or []:
        if not isinstance(corr, dict):
            continue
        aid = str(corr.get("activityId") or corr.get("activity_id") or "")
        activities.append({
            "activityId": aid,
            "activityName": names.get(aid) or aid,
            "verdict": corr.get("verdict"),
            "correctPercentage": corr.get("correctPercentage")
            if corr.get("correctPercentage") is not None
            else corr.get("correct_percentage"),
            "reason": corr.get("note") or corr.get("reason") or "",
        })

    return {
        "reviewId": str(doc.get("_id") or doc.get("id") or doc.get("reviewId") or ""),
        "when": _iso(doc.get("createdAt") or doc.get("created_at")),
        "snapshotId": doc.get("snapshotId") or doc.get("snapshot_id") or "",
        "floorId": doc.get("floorId") or doc.get("floor_id") or "",
        "flatName": doc.get("flatName") or doc.get("flat_name") or "",
        "roomName": doc.get("roomName") or doc.get("room_name") or "",
        "pins": pins,
        "progressVerdict": doc.get("progressVerdict") or doc.get("progress_verdict"),
        "activities": activities,
        "note": doc.get("note") or "",
        "model": doc.get("model") or "",
        "promptVersion": doc.get("promptVersion") or doc.get("prompt_version") or "",
        "rigVersion": doc.get("rigVersion") if doc.get("rigVersion") is not None else doc.get("rig_version"),
        "reviewedBy": doc.get("reviewedBy") or doc.get("reviewed_by") or "",
    }


def append_manual_review_json(doc: dict[str, Any]) -> Path:
    """Append one review to repo-root manual_review.json (create if missing)."""
    entry = _readable_review(doc)
    existing: dict[str, Any] = {"reviews": []}
    if _MANUAL_REVIEW_PATH.exists():
        try:
            loaded = json.loads(_MANUAL_REVIEW_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("reviews"), list):
                existing = loaded
            elif isinstance(loaded, list):
                existing = {"reviews": loaded}
        except Exception as exc:
            logger.warning("Could not read %s (%s); rewriting", _MANUAL_REVIEW_PATH, exc)

    reviews: list[Any] = list(existing.get("reviews") or [])
    rid = entry.get("reviewId")
    reviews = [r for r in reviews if not (isinstance(r, dict) and r.get("reviewId") == rid)]
    reviews.append(entry)
    payload = {
        "updatedAt": _utcnow().isoformat(),
        "reviewCount": len(reviews),
        "reviews": reviews,
    }
    _MANUAL_REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    _MANUAL_REVIEW_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return _MANUAL_REVIEW_PATH


def _serialize_review(doc: dict[str, Any]) -> dict[str, Any]:
    created = doc.get("createdAt") or doc.get("created_at")
    return {
        "reviewId": str(doc.get("_id") or doc.get("id") or ""),
        "orgId": doc.get("orgId") or doc.get("org_id") or "",
        "snapshotId": doc.get("snapshotId") or doc.get("snapshot_id") or "",
        "floorId": doc.get("floorId") or doc.get("floor_id") or "",
        "flatName": doc.get("flatName") or doc.get("flat_name") or "",
        "roomName": doc.get("roomName") or doc.get("room_name") or "",
        "pinNumbers": doc.get("pinNumbers") or doc.get("pin_numbers") or [],
        "roomCorrect": doc.get("roomCorrect") or doc.get("room_correct"),
        "actualRoom": doc.get("actualRoom") or doc.get("actual_room"),
        "pinRoomVerdicts": doc.get("pinRoomVerdicts") or doc.get("pin_room_verdicts") or [],
        "progressVerdict": doc.get("progressVerdict") or doc.get("progress_verdict"),
        "activityCorrections": doc.get("activityCorrections") or doc.get("activity_corrections") or [],
        "note": doc.get("note") or "",
        "reviewedBy": doc.get("reviewedBy") or doc.get("reviewed_by") or "",
        "model": doc.get("model") or "",
        "promptVersion": doc.get("promptVersion") or doc.get("prompt_version") or "",
        "rigVersion": doc.get("rigVersion") if doc.get("rigVersion") is not None else doc.get("rig_version"),
        "createdAt": _iso(created) if created else created,
    }


class ConstructionProgressReviewService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._db = db

    async def create_review(
        self,
        *,
        org_id: str,
        reviewed_by: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        snapshot_id = str(payload.get("snapshotId") or "")
        from bson import ObjectId

        def _oid(v: str):
            return ObjectId(v) if ObjectId.is_valid(v) else v

        oid = _oid(snapshot_id)
        snap = await self._db[_SNAPSHOTS].find_one({"_id": oid, "orgId": org_id})
        if not snap:
            # Legacy docs may store a string id / alternate key.
            snap = await self._db[_SNAPSHOTS].find_one(
                {
                    "orgId": org_id,
                    "$or": [
                        {"_id": snapshot_id},
                        {"_id": oid},
                        {"id": snapshot_id},
                        {"id": oid},
                    ],
                }
            )
        if not snap:
            # Stale client snapshotId after re-analyze — use latest for this floor.
            floor_id = str(payload.get("floorId") or "").strip()
            if floor_id:
                snap = await self._db[_SNAPSHOTS].find_one(
                    {"orgId": org_id, "floorId": floor_id},
                    sort=[("createdAt", -1), ("created_at", -1)],
                )
                if snap:
                    snapshot_id = str(snap.get("_id") or snap.get("id") or snapshot_id)
        if not snap:
            raise ValueError("Snapshot not found")

        from app.services.construction_progress_providers.vllm_provider import PROMPT_VERSION
        from app.services.panorama_views import RIG_VERSION

        now = _utcnow()
        review_id = str(uuid.uuid4())
        doc = {
            "_id": review_id,
            "id": review_id,
            "orgId": org_id,
            "org_id": org_id,
            "snapshotId": snapshot_id,
            "floorId": str(payload.get("floorId") or snap.get("floorId") or ""),
            "flatName": str(payload.get("flatName") or ""),
            "roomName": str(payload.get("roomName") or ""),
            "pinNumbers": list(payload.get("pinNumbers") or []),
            "roomCorrect": payload.get("roomCorrect"),
            "actualRoom": payload.get("actualRoom"),
            "pinRoomVerdicts": list(payload.get("pinRoomVerdicts") or []),
            "progressVerdict": payload.get("progressVerdict"),
            "activityCorrections": list(payload.get("activityCorrections") or []),
            "note": str(payload.get("note") or ""),
            "reviewedBy": reviewed_by,
            # Provenance — prefer values frozen on the snapshot; fall back to
            # current constants only when the snapshot predates stamping.
            "model": snap.get("model") or "",
            "promptVersion": snap.get("promptVersion") or snap.get("prompt_version") or PROMPT_VERSION,
            "rigVersion": snap.get("rigVersion") if snap.get("rigVersion") is not None else (
                snap.get("rig_version") if snap.get("rig_version") is not None else RIG_VERSION
            ),
            "createdAt": now,
            "created_at": now,
            "updatedAt": now,
            "updated_at": now,
        }
        await self._db[_COLLECTION].insert_one(doc)
        await self._write_audit(org_id=org_id, reviewed_by=reviewed_by, doc=doc)
        try:
            path = append_manual_review_json(doc)
            logger.info("Appended review to %s", path)
        except Exception as exc:
            # File export must never block saving the review itself.
            logger.warning("Failed to append manual_review.json: %s", exc)
        # Apply pin room + activity % corrections to live pins / latest snapshot
        # so the UI reflects the reviewer's intent (Floor-1 requirement).
        try:
            from app.services.review_correction_applier import ReviewCorrectionApplier
            applied = await ReviewCorrectionApplier(self._db).apply_from_review_doc(doc)
            logger.info("Applied review corrections: %s", applied)
        except Exception as exc:
            logger.warning("Failed to apply review corrections: %s", exc)
        return _serialize_review(doc)

    async def list_reviews(
        self,
        *,
        org_id: str,
        floor_id: str | None = None,
        snapshot_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id}
        if floor_id:
            query["floorId"] = floor_id
        if snapshot_id:
            query["snapshotId"] = snapshot_id
        cursor = self._db[_COLLECTION].find(query).sort("createdAt", -1)
        docs = await cursor.to_list(length=5_000)
        return [_serialize_review(d) for d in docs]

    async def summary(
        self,
        *,
        org_id: str,
        floor_id: str | None = None,
    ) -> dict[str, Any]:
        """Accuracy aggregates grouped by promptVersion / rigVersion — never pooled."""
        query: dict[str, Any] = {"orgId": org_id}
        if floor_id:
            query["floorId"] = floor_id
        docs = await self._db[_COLLECTION].find(query).to_list(length=10_000)

        groups: dict[tuple[str, Any], list[dict[str, Any]]] = {}
        for d in docs:
            key = (
                str(d.get("promptVersion") or d.get("prompt_version") or "unknown"),
                d.get("rigVersion") if d.get("rigVersion") is not None else d.get("rig_version"),
            )
            groups.setdefault(key, []).append(d)

        by_version: list[dict[str, Any]] = []
        for (prompt_version, rig_version), items in sorted(groups.items(), key=lambda x: x[0][0]):
            room_yes = 0
            room_no = 0
            for r in items:
                pin_verdicts = r.get("pinRoomVerdicts") or r.get("pin_room_verdicts") or []
                if pin_verdicts:
                    for v in pin_verdicts:
                        verdict = (v.get("roomCorrect") or v.get("room_correct") or "") if isinstance(v, dict) else ""
                        if verdict == "yes":
                            room_yes += 1
                        elif verdict == "no":
                            room_no += 1
                else:
                    # Legacy room-level yes/no (one judgment for all pins in the room).
                    rollup = r.get("roomCorrect") or r.get("room_correct")
                    if rollup == "yes":
                        room_yes += 1
                    elif rollup == "no":
                        room_no += 1
            room_total = room_yes + room_no
            verdicts = {
                "correct": 0,
                "mostly_correct": 0,
                "wrong": 0,
            }
            for r in items:
                v = r.get("progressVerdict") or r.get("progress_verdict")
                if v in verdicts:
                    verdicts[v] += 1
            progress_total = sum(verdicts.values())
            activity_wrong: dict[str, int] = {}
            for r in items:
                for corr in r.get("activityCorrections") or r.get("activity_corrections") or []:
                    if (corr.get("verdict") or "") == "wrong":
                        aid = str(corr.get("activityId") or corr.get("activity_id") or "")
                        if aid:
                            activity_wrong[aid] = activity_wrong.get(aid, 0) + 1
            by_version.append({
                "promptVersion": prompt_version,
                "rigVersion": rig_version,
                "reviewCount": len(items),
                "roomIdentificationAccuracyPct": round(100.0 * room_yes / room_total, 2) if room_total else None,
                "roomCorrectYes": room_yes,
                "roomCorrectNo": room_no,
                "progressMapping": {
                    **verdicts,
                    "accuracyPct": round(
                        100.0 * (verdicts["correct"] + 0.5 * verdicts["mostly_correct"]) / progress_total,
                        2,
                    ) if progress_total else None,
                },
                "activityWrongCounts": activity_wrong,
            })

        return {
            "floorId": floor_id,
            "totalReviews": len(docs),
            "byVersion": by_version,
        }

    async def _write_audit(self, *, org_id: str, reviewed_by: str, doc: dict[str, Any]) -> None:
        log_id = str(uuid.uuid4())
        now = _utcnow().isoformat() if not isinstance(doc.get("createdAt"), str) else str(doc["createdAt"])
        if isinstance(doc.get("createdAt"), datetime):
            now = doc["createdAt"].isoformat()
        audit = {
            "_id": log_id,
            "id": log_id,
            "orgId": org_id,
            "org_id": org_id,
            "actorId": reviewed_by,
            "actorName": reviewed_by,
            "eventType": "construction_progress_review_submitted",
            "entityType": "construction_progress_review",
            "entityId": doc["_id"],
            "entityName": f"{doc.get('flatName')} / {doc.get('roomName')}",
            "projectId": "",
            "description": (
                f"Progress review for {doc.get('flatName')} · {doc.get('roomName')} "
                f"(room={doc.get('roomCorrect')}, progress={doc.get('progressVerdict')}, "
                f"promptVersion={doc.get('promptVersion')}, rigVersion={doc.get('rigVersion')})"
            ),
            "createdAt": now,
            "created_at": now,
            "updatedAt": now,
            "updated_at": now,
        }
        await self._db["audit_logs"].insert_one(audit)
