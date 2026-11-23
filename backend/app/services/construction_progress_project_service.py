"""
Project-wide construction-progress reads: the floor list of a project, which floors have photos,
and the read-only ``overview`` rollup that feeds the Project Analysis page.

Every number comes from ``present_snapshot_doc`` (the same calculation as the floor dashboard and
Drishti), so the project page can never disagree with a floor page. Nothing here writes.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_providers.activities import CORE_ACTIVITIES
from app.services.construction_progress_providers.progress_aggregation import activity_pct
from app.services.construction_progress_scope_service import (
    ConstructionProgressScopeService,
    all_core_ids,
)
from app.services.construction_progress_service import (
    _COLLECTION as SNAPSHOT_COLLECTION,
    _core_applicable_ids,
    _is_legacy_activity_set,
    iso_utc,
    present_snapshot_doc,
)

STATUS_COMPLETED = "completed"
STATUS_IN_PROGRESS = "in_progress"
STATUS_NOT_STARTED = "not_started"
STATUS_NO_PHOTOS = "no_photos"
STATUS_NOT_ANALYSED = "not_analysed"

_CORE_NAME_BY_ID = {a.activity_id: a.name for a in CORE_ACTIVITIES}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _natural_key(text: str) -> list[Any]:
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text or "")]


def _round1(value: float) -> float:
    return round(float(value), 1)


def _mean(values: list[float]) -> float:
    return _round1(sum(values) / len(values)) if values else 0.0


def _day(value: Any) -> str | None:
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    return None


def _blend(flat: dict[str, Any], common: dict[str, Any], key: str) -> float | None:
    """Floor-level value of a flat/common summary key with the headline weights (flats 1 each, common area 1)."""
    parts: list[tuple[float, float]] = []
    n_flats = int(flat.get("total") or 0)
    if n_flats and flat.get(key) is not None:
        parts.append((float(flat[key]), float(n_flats)))
    if int(common.get("total") or 0) and common.get(key) is not None:
        parts.append((float(common[key]), 1.0))
    weight = sum(w for _, w in parts)
    if not weight:
        return None
    return _round1(sum(v * w for v, w in parts) / weight)


def floor_status(present: dict[str, Any] | None, captures_count: int) -> str:
    """Floor status from the single calculation. 'completed' only when every flat AND every common region is."""
    if present is None:
        return STATUS_NOT_ANALYSED if captures_count > 0 else STATUS_NO_PHOTOS
    flat = present.get("flatFinishing") or {}
    common = present.get("commonFinishing") or {}
    if (
        int(flat.get("total") or 0) > 0
        and int(flat.get("completed") or 0) == int(flat.get("total") or 0)
        and int(common.get("completed") or 0) == int(common.get("total") or 0)
    ):
        return STATUS_COMPLETED
    if float(present.get("overallProgressPct") or 0.0) > 0:
        return STATUS_IN_PROGRESS
    return STATUS_NOT_STARTED


class ConstructionProgressProjectService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    # ── Project / floors lookup ───────────────────────────────────────────

    async def get_project(self, org_id: str, project_id: str) -> dict[str, Any] | None:
        """The (non-archived) project, or None. Archived projects are not part of the Projects page."""
        keys: list[Any] = [project_id]
        if ObjectId.is_valid(project_id):
            keys.append(ObjectId(project_id))
        project = await self._db["projects"].find_one({"orgId": org_id, "_id": {"$in": keys}}) \
            or await self._db["projects"].find_one({"orgId": org_id, "id": project_id})
        if not project or project.get("archived") is True:
            return None
        return project

    async def list_project_floors(self, org_id: str, project_id: str) -> list[dict[str, Any]]:
        """Every floor of the project: [{floorId, floorName, towerId, towerName}] ordered by tower, floor."""
        towers = await self._db["towers"].find({"orgId": org_id, "projectId": project_id}).to_list(length=1000)
        towers.sort(key=lambda t: _natural_key(str(t.get("name") or "")))
        tower_by_id = {str(t.get("id") or t.get("_id")): t for t in towers}
        if not tower_by_id:
            return []
        floors = await self._db["floors"].find(
            {"orgId": org_id, "towerId": {"$in": list(tower_by_id)}}
        ).to_list(length=5000)
        rows = []
        for f in floors:
            tower = tower_by_id.get(str(f.get("towerId")), {})
            rows.append({
                "floorId": str(f.get("id") or f.get("_id")),
                "floorName": str(f.get("label") or ""),
                "towerId": str(f.get("towerId") or ""),
                "towerName": str(tower.get("name") or ""),
            })
        tower_order = {tid: i for i, tid in enumerate(tower_by_id)}
        rows.sort(key=lambda r: (tower_order.get(r["towerId"], 0), _natural_key(r["floorName"])))
        return rows

    async def capture_counts(self, org_id: str, floor_ids: list[str]) -> dict[str, int]:
        """floor_id -> number of real captures on the floor (via pin captureIds and via pin room ids).

        Same notion of "has photos" as the floor picker (``list_floor_summaries``), but counted and
        limited to the floors asked about. A pin pointing at a deleted capture counts nothing.
        """
        counts: dict[str, int] = {fid: 0 for fid in floor_ids}
        if not floor_ids:
            return counts
        pins = await self._db["capture_pins"].find(
            {"orgId": org_id, "floorId": {"$in": list(floor_ids)}}
        ).to_list(length=20000)
        ids_by_floor: dict[str, set[str]] = defaultdict(set)
        floors_by_room: dict[str, set[str]] = defaultdict(set)
        for pin in pins:
            fid = str(pin.get("floorId") or "")
            if not fid:
                continue
            for cid in (pin.get("captureIds") or pin.get("capture_ids") or []):
                if cid:
                    ids_by_floor[fid].add(str(cid))
            room_id = str(pin.get("roomId") or pin.get("room_id") or "")
            if room_id:
                floors_by_room[room_id].add(fid)

        candidate = {cid for ids in ids_by_floor.values() for cid in ids}
        existing: set[str] = set()
        if candidate:
            async for doc in self._db["captures"].find(
                {"orgId": org_id, "$or": [{"_id": {"$in": list(candidate)}}, {"id": {"$in": list(candidate)}}]},
                {"_id": 1, "id": 1},
            ):
                existing.add(str(doc.get("id") or doc.get("_id") or ""))
        found: dict[str, set[str]] = {fid: {c for c in ids if c in existing} for fid, ids in ids_by_floor.items()}

        if floors_by_room:
            room_ids = list(floors_by_room)
            async for doc in self._db["captures"].find(
                {"orgId": org_id, "$or": [{"roomId": {"$in": room_ids}}, {"room_id": {"$in": room_ids}}]},
                {"_id": 1, "id": 1, "roomId": 1, "room_id": 1},
            ):
                rid = str(doc.get("roomId") or doc.get("room_id") or "")
                cap_id = str(doc.get("id") or doc.get("_id") or "")
                for fid in floors_by_room.get(rid, ()):
                    found.setdefault(fid, set()).add(cap_id)
        for fid in floor_ids:
            counts[fid] = len(found.get(fid, ()))
        return counts

    async def floors_with_photos(self, org_id: str, project_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """(floors with at least one capture, floors without) for a project, in display order."""
        floors = await self.list_project_floors(org_id, project_id)
        counts = await self.capture_counts(org_id, [f["floorId"] for f in floors])
        with_photos = [f for f in floors if counts.get(f["floorId"], 0) > 0]
        without = [f for f in floors if counts.get(f["floorId"], 0) <= 0]
        return with_photos, without

    async def _latest_present_by_floor(self, org_id: str, floor_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not floor_ids:
            return {}
        pipeline = [
            {"$match": {"orgId": org_id, "floorId": {"$in": list(floor_ids)}}},
            {"$sort": {"snapshotDate": -1}},
            {"$group": {"_id": "$floorId", "doc": {"$first": "$$ROOT"}}},
        ]
        out: dict[str, dict[str, Any]] = {}
        async for row in self._db[SNAPSHOT_COLLECTION].aggregate(pipeline):
            out[str(row["_id"])] = present_snapshot_doc(row["doc"])
        return out

    # ── Overview ──────────────────────────────────────────────────────────

    async def get_overview(
        self, org_id: str, project_id: str, *, last_run: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        project = await self.get_project(org_id, project_id)
        if project is None:
            return None
        floors = await self.list_project_floors(org_id, project_id)
        floor_ids = [f["floorId"] for f in floors]
        counts = await self.capture_counts(org_id, floor_ids)
        latest = await self._latest_present_by_floor(org_id, floor_ids)
        stored_scopes = await ConstructionProgressScopeService(self._db).get_scopes_for_floors(org_id, floor_ids)

        rows: list[dict[str, Any]] = []
        for f in floors:
            fid = f["floorId"]
            p = latest.get(fid)
            captures_count = int(counts.get(fid, 0))
            status = floor_status(p, captures_count)
            scope = (p or {}).get("activityScope") if p else None
            scope_size = len(scope) if isinstance(scope, list) else len(stored_scopes.get(fid) or all_core_ids())
            if p is None:
                rows.append({
                    **f, "status": status, "progressPct": 0.0, "estimatePct": None, "coveragePct": 0.0,
                    "flatsTotal": 0, "flatsCompleted": 0, "roomsTotal": 0, "roomsPhotographed": 0,
                    "capturesCount": captures_count, "lastAnalysedAt": None, "lastInspection": None,
                    "scopeSize": scope_size, "needsReview": False,
                    "_observed": 0,
                })
                continue
            flat_s = p.get("flatFinishing") or {}
            common_s = p.get("commonFinishing") or {}
            flat_docs = list(p.get("flatProgress") or [])
            rooms_total = sum(int(fp.get("roomsTotal") or len(fp.get("rooms") or [])) for fp in flat_docs)
            rooms_photo = sum(int(fp.get("roomsPhotographed") or 0) for fp in flat_docs)
            observed = sum(
                int(r.get("observedActivities") or 0) for fp in flat_docs for r in (fp.get("rooms") or [])
            )
            rows.append({
                **f,
                "status": status,
                "progressPct": _round1(p.get("overallProgressPct") or 0.0),
                "estimatePct": _blend(flat_s, common_s, "estimatePct"),
                "coveragePct": _blend(flat_s, common_s, "coveragePct") or 0.0,
                "flatsTotal": int(flat_s.get("total") or 0),
                "flatsCompleted": int(flat_s.get("completed") or 0),
                "roomsTotal": rooms_total,
                "roomsPhotographed": rooms_photo,
                "capturesCount": captures_count,
                "lastAnalysedAt": p.get("snapshotDate"),
                "lastInspection": (p.get("summaryCards") or {}).get("lastInspection"),
                "scopeSize": scope_size,
                "needsReview": any(bool(fp.get("reviewRequired")) for fp in flat_docs),
                "_observed": observed,
            })

        def count(status: str) -> int:
            return sum(1 for r in rows if r["status"] == status)

        analysed_rows = [r for r in rows if r["status"] not in (STATUS_NO_PHOTOS, STATUS_NOT_ANALYSED)]
        estimates = [r["estimatePct"] for r in analysed_rows if r["estimatePct"] is not None]
        totals = {
            "floors": len(rows),
            "analysed": len(analysed_rows),
            "completed": count(STATUS_COMPLETED),
            "inProgress": count(STATUS_IN_PROGRESS),
            "notStarted": count(STATUS_NOT_STARTED),
            "noPhotos": count(STATUS_NO_PHOTOS),
            "notAnalysed": count(STATUS_NOT_ANALYSED),
            # Analysed floors where not a single activity could be read yet (a subset of notStarted).
            "awaitingEvidence": sum(
                1 for r in analysed_rows if r["status"] == STATUS_NOT_STARTED and r["coveragePct"] <= 0
            ),
            # Project total: mean of EVERY floor's overall %; floors with no snapshot count as 0.
            "progressPct": _mean([r["progressPct"] for r in rows]),
            "estimatePct": _mean(estimates) if estimates else None,
            "coveragePct": _mean([r["coveragePct"] for r in rows]),
            "roomsTotal": sum(r["roomsTotal"] for r in rows),
            "roomsPhotographed": sum(r["roomsPhotographed"] for r in rows),
            "activitiesAssessed": sum(r["_observed"] for r in rows),
            "needsReview": sum(1 for r in rows if r["needsReview"]),
        }

        towers_out: list[dict[str, Any]] = []
        tower_order: list[str] = []
        by_tower: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            if r["towerId"] not in by_tower:
                tower_order.append(r["towerId"])
            by_tower[r["towerId"]].append(r)
        for tid in tower_order:
            tr = by_tower[tid]
            towers_out.append({
                "towerId": tid,
                "towerName": tr[0]["towerName"],
                "floors": len(tr),
                "progressPct": _mean([r["progressPct"] for r in tr]),
                "completed": sum(1 for r in tr if r["status"] == STATUS_COMPLETED),
                "inProgress": sum(1 for r in tr if r["status"] == STATUS_IN_PROGRESS),
                "notStarted": sum(1 for r in tr if r["status"] in (STATUS_NOT_STARTED, STATUS_NOT_ANALYSED)),
                "noPhotos": sum(1 for r in tr if r["status"] == STATUS_NO_PHOTOS),
            })

        for r in rows:
            r.pop("_observed", None)

        return {
            "projectId": project_id,
            "projectName": str(project.get("name") or ""),
            "generatedAt": iso_utc(_utcnow()),
            "lastRun": last_run,
            "totals": totals,
            "towers": towers_out,
            "floors": rows,
            "activities": self._activity_rollup(latest),
            "timeline": await self._timeline(org_id, floor_ids, latest),
        }

    # ── Rollups ───────────────────────────────────────────────────────────

    @staticmethod
    def _activity_rollup(latest: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """Project-wide per activity: progress = mean over floors that observed it, coverage = observed / applicable."""
        per_floor_means: dict[str, list[float]] = defaultdict(list)
        applicable_n: dict[str, int] = defaultdict(int)
        observed_n: dict[str, int] = defaultdict(int)
        names: dict[str, str] = {}
        order: list[str] = []

        for doc in latest.values():
            flats = list(doc.get("flatProgress") or [])
            scope = doc.get("activityScope")
            legacy = _is_legacy_activity_set(flats)
            floor_obs: dict[str, list[float]] = defaultdict(list)
            for fp in flats:
                flat_name = str(fp.get("flatName") or "")
                for room in fp.get("rooms") or []:
                    allowed = None if legacy else set(
                        _core_applicable_ids(flat_name, str(room.get("roomName") or ""), scope)
                    )
                    seen: set[str] = set()
                    for act in room.get("activities") or []:
                        aid = str(act.get("activityId") or "")
                        if not aid or (allowed is not None and aid not in allowed):
                            continue
                        names.setdefault(aid, _CORE_NAME_BY_ID.get(aid) or str(act.get("activityName") or aid))
                        if aid not in order:
                            order.append(aid)
                        seen.add(aid)
                        pct = activity_pct(act)
                        if pct is not None:
                            floor_obs[aid].append(max(0.0, min(100.0, pct)))
                            observed_n[aid] += 1
                        if legacy:
                            applicable_n[aid] += 1
                    if allowed is not None:
                        for aid in allowed:
                            applicable_n[aid] += 1
                            names.setdefault(aid, _CORE_NAME_BY_ID.get(aid, aid))
                            if aid not in order:
                                order.append(aid)
            for aid, vals in floor_obs.items():
                per_floor_means[aid].append(sum(vals) / len(vals))

        core_order = {a.activity_id: i for i, a in enumerate(CORE_ACTIVITIES)}
        first_seen = {a: i for i, a in enumerate(order)}
        order = sorted(order, key=lambda a: (core_order.get(a, 10_000), first_seen[a]))
        out = []
        for aid in order:
            means = per_floor_means.get(aid, [])
            app_n = applicable_n.get(aid, 0)
            out.append({
                "activityId": aid,
                "name": names.get(aid, aid),
                "progressPct": _mean(means) if means else None,
                "coveragePct": _round1(100.0 * observed_n.get(aid, 0) / app_n) if app_n else 0.0,
                "floorsObserved": len(means),
            })
        return out

    async def _timeline(
        self, org_id: str, floor_ids: list[str], latest: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Project progress over time: at each snapshot day, every floor's latest snapshot up to that day
        (floors with none yet count 0). The newest value of each floor is the presented (current) one."""
        if not floor_ids or not latest:
            return []
        cursor = self._db[SNAPSHOT_COLLECTION].find(
            {"orgId": org_id, "floorId": {"$in": list(floor_ids)}},
            {"floorId": 1, "snapshotDate": 1, "overallProgressPct": 1},
        )
        events: list[tuple[str, str, float]] = []
        async for d in cursor:
            day = _day(d.get("snapshotDate"))
            if day:
                events.append((day, str(d.get("floorId")), float(d.get("overallProgressPct") or 0.0), ))
        if not events:
            return []
        events.sort(key=lambda e: e[0])
        # Replace each floor's newest stored value with the presented one so the last point equals the total.
        newest_day: dict[str, str] = {}
        for day, fid, _ in events:
            newest_day[fid] = day
        current: dict[str, float] = {}
        timeline: list[dict[str, Any]] = []
        days = sorted({e[0] for e in events})
        by_day: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for day, fid, pct in events:
            if day == newest_day[fid] and fid in latest:
                pct = float(latest[fid].get("overallProgressPct") or 0.0)
            by_day[day].append((fid, pct))
        for day in days:
            for fid, pct in by_day[day]:
                current[fid] = pct
            timeline.append({
                "date": day,
                "progressPct": _mean([current.get(fid, 0.0) for fid in floor_ids]),
            })
        return timeline
