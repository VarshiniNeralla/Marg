"""
Orchestrates AI Construction Progress Monitoring: joins real floor/capture/
room-map data with a ConstructionProgressProvider (a real vLLM vision model)
and persists the result as an immutable snapshot per floor per day — the
source of truth for the progress dashboard, timeline, heatmap, and
comparison views.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_providers import (
    ALL_ACTIVITIES,
    COMPLETE_THRESHOLD,
    CaptureRef,
    ConstructionProgressProvider,
    VllmConstructionProgressProvider,
)
from app.services.room_map_service import RoomMapService, _COMMON_AREA_FLAT

_COLLECTION = "construction_progress_snapshots"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def get_construction_progress_provider() -> ConstructionProgressProvider:
    """Factory — mirrors `ai_progress_service.get_vision_provider()`'s
    factory-swap pattern. Currently always the local vLLM-backed provider;
    swap this one function to change models."""
    return VllmConstructionProgressProvider()


class ConstructionProgressService:
    def __init__(
        self,
        db: AsyncIOMotorDatabase,
        *,
        provider: ConstructionProgressProvider | None = None,
    ) -> None:
        self._db = db
        self._provider = provider or get_construction_progress_provider()
        self._room_maps = RoomMapService(db)

    # ── Floor + capture resolution ────────────────────────────────────────────

    async def _get_floor_context(self, org_id: str, floor_id: str) -> dict[str, Any] | None:
        floor = await self._db["floors"].find_one({"_id": floor_id, "orgId": org_id}) \
            or await self._db["floors"].find_one({"id": floor_id, "orgId": org_id})
        if not floor:
            return None
        tower = await self._db["towers"].find_one({"_id": floor.get("towerId"), "orgId": org_id}) \
            or await self._db["towers"].find_one({"id": floor.get("towerId"), "orgId": org_id})
        project_id = tower.get("projectId") if tower else None
        project = None
        if project_id:
            project = await self._db["projects"].find_one({"_id": project_id, "orgId": org_id}) \
                or await self._db["projects"].find_one({"id": project_id, "orgId": org_id})
        floor_plan = await self._db["floor_plans"].find_one(
            {"floorId": floor_id, "orgId": org_id}, sort=[("createdAt", -1)]
        )
        return {
            "floorId": floor_id,
            "floorLabel": floor.get("label") or "",
            "towerId": floor.get("towerId") or "",
            "towerName": (tower or {}).get("name") or "",
            "projectId": project_id or "",
            "projectName": (project or {}).get("name") or "",
            "floorPlanId": (floor_plan or {}).get("_id") or (floor_plan or {}).get("id") or "",
            "floorPlanImageUrl": str((floor_plan or {}).get("fileUrl") or (floor_plan or {}).get("file_url") or ""),
        }

    async def _get_capture_refs(self, org_id: str, floor_id: str, floor_plan_id: str) -> list[CaptureRef]:
        """Floor -> capture_pins (real floorId) -> captureIds -> captures.
        Captures themselves don't reliably carry floorId, so pins are the only
        reliable join key from floor to its captures (confirmed empirically:
        real capture docs commonly have floorId=None)."""
        pins = await self._db["capture_pins"].find({"orgId": org_id, "floorId": floor_id}).to_list(length=1000)
        if not pins:
            return []

        capture_ids: list[str] = []
        pin_by_capture: dict[str, dict[str, Any]] = {}
        for pin in pins:
            for cid in pin.get("captureIds") or []:
                capture_ids.append(cid)
                pin_by_capture[cid] = pin

        if not capture_ids:
            return []

        captures = await self._db["captures"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": capture_ids}}, {"id": {"$in": capture_ids}}]}
        ).to_list(length=2000)

        refs: list[CaptureRef] = []
        for cap in captures:
            cap_id = str(cap.get("id") or cap.get("_id") or "")
            pin = pin_by_capture.get(cap_id)
            # Defence-in-depth against stale/corrupted pin<->capture links: a
            # capture's own roomId is stamped from the pin that created it, so
            # it must start with that pin's floorId. Without this check, a
            # leftover captureId on the wrong pin (confirmed to happen from old
            # seed/demo data) would silently pull a DIFFERENT floor's photo
            # into this floor's analysis — evidence for one floor showing up
            # under another floor's activities.
            if pin:
                pin_floor = str(pin.get("floorId") or "")
                cap_room = str(cap.get("roomId") or cap.get("room_id") or "")
                if pin_floor and cap_room and not cap_room.startswith(pin_floor):
                    logger.warning(
                        "[construction-progress] skipping capture={} — belongs to roomId={} "
                        "but is linked from a pin on floorId={} (stale pin<->capture link)",
                        cap_id, cap_room, pin_floor,
                    )
                    continue
            flat_name, room_name = _FALLBACK_LOCATION
            if pin and floor_plan_id:
                flat_name, room_name = await self._room_maps.resolve_pin_location(
                    floor_plan_id=floor_plan_id,
                    org_id=org_id,
                    pin_x=pin.get("x"),
                    pin_y=pin.get("y"),
                    fallback_pin_name=cap.get("roomName") or f"Pin {pin.get('sequenceNumber', '?')}",
                )
            image_url = str(
                cap.get("processedPanoramaUrl")
                or cap.get("original_url")
                or cap.get("originalFileUrl")
                or cap.get("thumbnailUrl")
                or ""
            )
            captured_at = _parse_dt(cap.get("createdAt")) or _parse_dt(cap.get("uploadedAt"))
            refs.append(
                CaptureRef(
                    capture_id=cap_id,
                    pin_id=str((pin or {}).get("_id") or (pin or {}).get("id") or ""),
                    room_name=room_name,
                    flat_name=flat_name,
                    captured_at=captured_at,
                    image_url=image_url,
                )
            )
        return refs

    async def _get_room_heatmap(
        self,
        org_id: str,
        floor_plan_id: str,
        activities_by_room: dict[tuple[str, str], list[float]],
        captures_by_room: dict[tuple[str, str], int],
    ) -> list[dict[str, Any]]:
        """Colors every room the floor plan's room-map knows about.

        "no_images" vs the rest is driven by REAL capture presence
        (`captures_by_room`, built directly from resolved pin->room captures)
        — NOT by whether the AI found confirmable activity evidence there.
        Those are different questions: a room can have real uploaded photos
        that the model simply couldn't match to any checklist activity (still
        "uploaded", genuinely photographed, just not scoreable yet), which
        must not look identical to a room nobody has ever photographed at all
        (previously both showed grey — this was the bug: only 1 of 63 rooms
        ever got colored even when captures existed in several rooms, because
        `activities_by_room` only has entries where the AI actually confirmed
        something).
        """
        if not floor_plan_id:
            return []
        cached = await self._room_maps.get_cached(floor_plan_id, org_id)
        flats = (cached or {}).get("flats") or []

        heatmap: list[dict[str, Any]] = []
        for flat_entry in flats:
            flat_name = flat_entry.get("flat") or ""
            for room in flat_entry.get("rooms") or []:
                room_name = room.get("name") or ""
                polygon = room.get("polygon") or []
                key = (flat_name, room_name)
                captures_count = captures_by_room.get(key, 0)
                pcts = activities_by_room.get(key, [])
                if captures_count == 0:
                    state = "no_images"
                elif not pcts:
                    state = "uploaded"
                else:
                    # "Completed" requires EVERY confirmed activity in this
                    # room to individually clear the threshold — not just an
                    # average across them. An average let a room with e.g.
                    # six activities at 100% and one at 60% still read
                    # "Completed" (avg ~94%) here while the same room
                    # correctly failed the stricter per-activity rule on the
                    # Flat Finishing Works page, which is confusing since a
                    # room is either genuinely fully done or it isn't — the
                    # two views must never disagree on that.
                    avg_pct = sum(pcts) / len(pcts)
                    if all(p >= COMPLETE_THRESHOLD for p in pcts):
                        state = "completed"
                    elif avg_pct > 2:
                        state = "in_progress"
                    else:
                        state = "uploaded"
                heatmap.append({
                    "flatName": flat_name,
                    "roomName": room_name,
                    "polygon": polygon,
                    "state": state,
                    "capturesCount": captures_count,
                })
        return heatmap

    # ── Snapshot generation ────────────────────────────────────────────────────

    async def analyze_floor(self, org_id: str, floor_id: str, *, as_of: datetime | None = None) -> dict[str, Any]:
        context = await self._get_floor_context(org_id, floor_id)
        if not context:
            raise ValueError("Floor not found")

        as_of = as_of or _utcnow()
        captures = await self._get_capture_refs(org_id, floor_id, context["floorPlanId"])
        capture_lookup = {c.capture_id: c for c in captures}

        # "Flat Finishing Works" must reach 100% only once EVERY ROOM in every
        # physical flat confirms an activity, not just one photographed room
        # in that flat — so the provider needs the full roster of rooms per
        # flat (and per common-area) from the room map, not just the ones
        # that happen to have a capture yet. A room with zero evidence still
        # occupies a denominator slot (it contributes 0%), which is what
        # makes "2 of 40 rooms done" read as 5%, not 100%.
        flat_units: list[str] = []
        common_area_units: list[str] = []
        flat_room_rosters: dict[str, list[str]] = {}
        floor_plan_id = context.get("floorPlanId")
        if floor_plan_id:
            cached_room_map = await self._room_maps.get_cached(floor_plan_id, org_id)
            for flat_entry in (cached_room_map or {}).get("flats") or []:
                flat_name = flat_entry.get("flat") or ""
                if not flat_name:
                    continue
                room_names = [r.get("name") or "" for r in flat_entry.get("rooms") or [] if r.get("name")]
                if flat_name == _COMMON_AREA_FLAT:
                    common_area_units = room_names
                else:
                    flat_units.append(flat_name)
                    flat_room_rosters[flat_name] = room_names

        result = await self._provider.assess_floor_progress(
            floor_id=floor_id,
            activities=ALL_ACTIVITIES,
            captures=captures,
            as_of=as_of,
            flat_units=flat_units or None,
            common_area_units=common_area_units or None,
            flat_room_rosters=flat_room_rosters or None,
        )

        # Built from each capture's OWN raw per-activity results, not from
        # which capture "won" an activity's flat-level best-evidence
        # comparison. A room's heatmap status must reflect what its own
        # photo showed — a sibling room in the same flat scoring higher on
        # the same activities must never make THIS room look untouched, even
        # though only one of them can be the flat-level "winner" for the
        # activity card. Falls back to the old evidence-id-based behaviour
        # for a provider that doesn't populate per_capture_completion.
        activities_by_room: dict[tuple[str, str], list[float]] = {}
        if result.per_capture_completion:
            for cap_id, pcts in result.per_capture_completion.items():
                cap = capture_lookup.get(cap_id)
                if cap:
                    activities_by_room.setdefault((cap.flat_name, cap.room_name), []).extend(pcts)
        else:
            for a in result.activities:
                for cid in a.evidence_capture_ids:
                    cap = capture_lookup.get(cid)
                    if cap:
                        activities_by_room.setdefault((cap.flat_name, cap.room_name), []).append(a.completion_pct)

        activity_docs = []
        for a in result.activities:
            activity_docs.append({
                "activityId": a.activity.activity_id,
                "name": a.activity.name,
                "section": a.activity.section,
                "sequenceIndex": a.activity.sequence_index,
                "status": a.status,
                "completionPct": a.completion_pct,
                "confidencePct": a.confidence_pct,
                "evidenceCaptureIds": a.evidence_capture_ids,
            })

        captures_by_room: dict[tuple[str, str], int] = {}
        for cap in captures:
            key = (cap.flat_name, cap.room_name)
            captures_by_room[key] = captures_by_room.get(key, 0) + 1

        room_heatmap = await self._get_room_heatmap(
            org_id, context["floorPlanId"], activities_by_room, captures_by_room
        )

        # Three honest buckets, not two: lumping "actively being worked on,
        # with real photos" together with "never photographed at all" under
        # one "pending" number is what made a floor with visible in-progress
        # rooms still read as "0 completed / 54 pending" — indistinguishable
        # from a floor nobody has touched yet.
        rooms_completed = sum(1 for r in room_heatmap if r["state"] == "completed")
        rooms_in_progress = sum(1 for r in room_heatmap if r["state"] in ("uploaded", "in_progress"))
        rooms_not_started = sum(1 for r in room_heatmap if r["state"] == "no_images")
        # ActivityStatus has its own explicit "no_evidence" state now — an
        # activity nobody has photographed anywhere is never mislabelled
        # "in_progress" (which would falsely claim observed work).
        activities_completed = sum(1 for a in activity_docs if a["status"] == "completed")
        activities_not_started = sum(1 for a in activity_docs if a["status"] == "no_evidence")
        activities_in_progress = sum(1 for a in activity_docs if a["status"] == "in_progress")
        confident_docs = [a for a in activity_docs if a["confidencePct"] > 0]
        avg_confidence = (
            round(sum(a["confidencePct"] for a in confident_docs) / len(confident_docs), 1)
            if confident_docs else 0.0
        )
        last_inspection = max((c.captured_at for c in captures if c.captured_at), default=None)

        # Floor-level status: "Completed" only if EVERY activity that was
        # genuinely assessed is "completed" — one confirmed in-progress
        # activity (or one never confirmed at all) keeps the whole floor at
        # "Work in Progress". An unassessed activity is treated as NOT
        # complete (never silently excluded), so a floor with almost nothing
        # photographed yet cannot read as "Completed" by default.
        overall_status = "completed" if activities_completed == len(activity_docs) and activity_docs else "in_progress"

        flat_progress_docs = [
            {
                "flatName": fp.flat_name,
                "completionPct": fp.completion_pct,
                "roomsComplete": fp.rooms_complete,
                "roomsTotal": fp.rooms_total,
                "rooms": [
                    {
                        "roomName": r.room_name,
                        "isComplete": r.is_complete,
                        "activities": [
                            {
                                "activityId": a.activity_id,
                                "activityName": a.activity_name,
                                "completionPct": a.completion_pct,
                                "confidencePct": a.confidence_pct,
                                "evidenceCaptureIds": a.evidence_capture_ids,
                            }
                            for a in r.activities
                        ],
                    }
                    for r in fp.rooms
                ],
            }
            for fp in result.flat_progress
        ]

        doc = {
            "orgId": org_id,
            "projectId": context["projectId"],
            "towerId": context["towerId"],
            "floorId": floor_id,
            "projectName": context["projectName"],
            "towerName": context["towerName"],
            "floorName": context["floorLabel"],
            "floorPlanId": context["floorPlanId"],
            "floorPlanImageUrl": context["floorPlanImageUrl"],
            "snapshotDate": as_of,
            "overallProgressPct": result.overall_progress_pct,
            "overallConfidencePct": result.overall_confidence_pct,
            "overallStatus": overall_status,
            "imagesAnalyzedCount": len(captures),
            "activities": activity_docs,
            "roomHeatmap": room_heatmap,
            "flatProgress": flat_progress_docs,
            "summaryCards": {
                "roomsCompleted": rooms_completed,
                "roomsInProgress": rooms_in_progress,
                "roomsNotStarted": rooms_not_started,
                "activitiesCompleted": activities_completed,
                "activitiesInProgress": activities_in_progress,
                "activitiesNotStarted": activities_not_started,
                "imagesAnalyzed": len(captures),
                "lastInspection": last_inspection,
                "avgConfidencePct": avg_confidence,
            },
            "executiveSummary": result.executive_summary,
            "model": result.model,
            "createdAt": _utcnow(),
        }
        insert_result = await self._db[_COLLECTION].insert_one(doc)
        doc["_id"] = insert_result.inserted_id
        logger.info(
            "Construction progress snapshot created floor_id={} org_id={} overall={}%",
            floor_id, org_id, result.overall_progress_pct,
        )
        return _serialize_snapshot(doc)

    # ── Reads ──────────────────────────────────────────────────────────────────

    async def get_latest_snapshot(self, org_id: str, floor_id: str) -> dict[str, Any] | None:
        doc = await self._db[_COLLECTION].find_one(
            {"orgId": org_id, "floorId": floor_id}, sort=[("snapshotDate", -1)]
        )
        return _serialize_snapshot(doc) if doc else None

    async def delete_floor_reports(self, org_id: str, floor_id: str) -> int:
        """Delete every progress snapshot for a floor, resetting it back to 'not analyzed'."""
        result = await self._db[_COLLECTION].delete_many({"orgId": org_id, "floorId": floor_id})
        return result.deleted_count

    async def list_floor_summaries(self, org_id: str) -> list[dict[str, Any]]:
        """One row per floor — the picker list for the Construction Progress
        overview page. Floors never analyzed show progress=None so the UI can
        offer "Analyze now". Batches all lookups (towers/projects/latest
        snapshots) instead of one round trip per floor — with 100+ floors per
        org, the naive per-floor version took 15+ seconds; this is a handful
        of queries regardless of floor count."""
        floors = await self._db["floors"].find({"orgId": org_id}).to_list(length=1000)
        if not floors:
            return []

        tower_ids = {str(f.get("towerId")) for f in floors if f.get("towerId")}
        towers = await self._db["towers"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": list(tower_ids)}}, {"id": {"$in": list(tower_ids)}}]}
        ).to_list(length=1000)
        tower_by_id = {str(t.get("id") or t.get("_id")): t for t in towers}

        project_ids = {str(t.get("projectId")) for t in towers if t.get("projectId")}
        projects = await self._db["projects"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": list(project_ids)}}, {"id": {"$in": list(project_ids)}}]}
        ).to_list(length=1000)
        project_by_id = {str(p.get("id") or p.get("_id")): p for p in projects}

        # Latest snapshot per floor via a single aggregation instead of N finds.
        latest_by_floor: dict[str, dict[str, Any]] = {}
        pipeline = [
            {"$match": {"orgId": org_id}},
            {"$sort": {"snapshotDate": -1}},
            {"$group": {"_id": "$floorId", "doc": {"$first": "$$ROOT"}}},
        ]
        async for row in self._db[_COLLECTION].aggregate(pipeline):
            latest_by_floor[str(row["_id"])] = row["doc"]

        # A floor only counts as having captures if at least one of its pins
        # has a captureIds entry that resolves to a REAL capture document —
        # dangling/stale pin references (known to exist from earlier data)
        # must not make an empty floor appear analyzable.
        pins = await self._db["capture_pins"].find(
            {"orgId": org_id, "captureIds.0": {"$exists": True}}
        ).to_list(length=5000)
        candidate_capture_ids: set[str] = set()
        pin_ids_by_floor: dict[str, list[str]] = {}
        for pin in pins:
            fid = str(pin.get("floorId") or "")
            if not fid:
                continue
            ids = [cid for cid in (pin.get("captureIds") or []) if cid]
            if not ids:
                continue
            pin_ids_by_floor.setdefault(fid, []).extend(ids)
            candidate_capture_ids.update(ids)

        existing_capture_ids: set[str] = set()
        if candidate_capture_ids:
            cursor = self._db["captures"].find(
                {
                    "orgId": org_id,
                    "$or": [
                        {"_id": {"$in": list(candidate_capture_ids)}},
                        {"id": {"$in": list(candidate_capture_ids)}},
                    ],
                },
                {"_id": 1, "id": 1},
            )
            async for doc in cursor:
                existing_capture_ids.add(str(doc.get("id") or doc.get("_id") or ""))

        floors_with_captures = {
            fid for fid, cids in pin_ids_by_floor.items()
            if any(cid in existing_capture_ids for cid in cids)
        }

        summaries: list[dict[str, Any]] = []
        for floor in floors:
            floor_id = str(floor.get("id") or floor.get("_id"))
            if floor_id not in floors_with_captures:
                continue
            tower = tower_by_id.get(str(floor.get("towerId")))
            project = project_by_id.get(str(tower.get("projectId"))) if tower else None
            latest = latest_by_floor.get(floor_id)
            summaries.append({
                "floorId": floor_id,
                "projectId": str((tower or {}).get("projectId") or ""),
                "projectName": str((project or {}).get("name") or ""),
                "towerId": str(floor.get("towerId") or ""),
                "towerName": str((tower or {}).get("name") or ""),
                "floorName": str(floor.get("label") or ""),
                "overallProgressPct": latest.get("overallProgressPct") if latest else None,
                "overallStatus": latest.get("overallStatus", "in_progress") if latest else None,
                "lastInspection": (latest.get("summaryCards") or {}).get("lastInspection") if latest else None,
                "analyzed": latest is not None,
            })
        return summaries

    async def get_timeline(self, org_id: str, floor_id: str) -> list[dict[str, Any]]:
        docs = await self._db[_COLLECTION].find(
            {"orgId": org_id, "floorId": floor_id}
        ).sort("snapshotDate", 1).to_list(length=1000)
        return [
            {
                "snapshotId": str(d["_id"]),
                "snapshotDate": d.get("snapshotDate"),
                "overallProgressPct": d.get("overallProgressPct", 0.0),
            }
            for d in docs
        ]

    async def compare(self, org_id: str, floor_id: str, from_id: str, to_id: str) -> dict[str, Any]:
        from bson import ObjectId

        def _oid(v: str):
            return ObjectId(v) if ObjectId.is_valid(v) else v

        before = await self._db[_COLLECTION].find_one({"_id": _oid(from_id), "orgId": org_id, "floorId": floor_id})
        after = await self._db[_COLLECTION].find_one({"_id": _oid(to_id), "orgId": org_id, "floorId": floor_id})
        if not before or not after:
            raise ValueError("Snapshot not found")

        before_by_id = {a["activityId"]: a for a in before.get("activities", [])}
        newly_completed = []
        for a in after.get("activities", []):
            prev = before_by_id.get(a["activityId"])
            if a["status"] == "completed" and (not prev or prev["status"] != "completed"):
                newly_completed.append(a["name"])

        return {
            "before": _serialize_snapshot(before),
            "after": _serialize_snapshot(after),
            "progressDelta": round(after.get("overallProgressPct", 0) - before.get("overallProgressPct", 0), 1),
            "newlyCompletedActivities": newly_completed,
        }

    async def get_heatmap(self, org_id: str, floor_id: str) -> list[dict[str, Any]]:
        latest = await self._db[_COLLECTION].find_one(
            {"orgId": org_id, "floorId": floor_id}, sort=[("snapshotDate", -1)]
        )
        return (latest or {}).get("roomHeatmap", [])


_FALLBACK_LOCATION = ("Unknown", "Unknown")


def _serialize_snapshot(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    return {
        "snapshotId": str(doc["_id"]),
        "projectId": doc.get("projectId", ""),
        "projectName": doc.get("projectName", ""),
        "towerId": doc.get("towerId", ""),
        "towerName": doc.get("towerName", ""),
        "floorId": doc.get("floorId", ""),
        "floorName": doc.get("floorName", ""),
        "floorPlanId": doc.get("floorPlanId", ""),
        "floorPlanImageUrl": doc.get("floorPlanImageUrl", ""),
        "snapshotDate": doc.get("snapshotDate"),
        "overallProgressPct": doc.get("overallProgressPct", 0.0),
        "overallConfidencePct": doc.get("overallConfidencePct", 0.0),
        "overallStatus": doc.get("overallStatus", "in_progress"),
        "imagesAnalyzedCount": doc.get("imagesAnalyzedCount", 0),
        "activities": doc.get("activities", []),
        "roomHeatmap": doc.get("roomHeatmap", []),
        "flatProgress": doc.get("flatProgress", []),
        "summaryCards": doc.get("summaryCards", {}),
        "executiveSummary": doc.get("executiveSummary", ""),
        "model": doc.get("model", ""),
        "createdAt": doc.get("createdAt"),
    }
