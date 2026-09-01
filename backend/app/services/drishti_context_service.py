"""
Read-only aggregation layer for Drishti.

Reads the same Mongo collections `ConstructionProgressService` reads
(`floors`, `towers`, `projects`, `construction_progress_snapshots`) but never
modifies that service or its collections — Drishti needs project/tower-scoped
rollups that don't exist there today (`list_floor_summaries` is org-wide and
unfiltered), so this module mirrors its batched-lookup aggregation style
instead of extending it.

Every method here is a pure read. Nothing in this file ever re-derives a
progress percentage, room roster, or activity status from scratch — those are
read verbatim from the persisted snapshot, which remains the single source of
truth for numbers (see `construction_progress_service.py`).
"""
from __future__ import annotations

from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_service import ConstructionProgressService

_SNAPSHOT_COLLECTION = "construction_progress_snapshots"
_COMMON_AREA_FLAT = "Common Area"

# Activity statuses that mean the AI actually looked at evidence and scored
# something — as opposed to `not_assessed` (no photo coverage yet) or
# `not_observable` (concealed/document-only), which must never be counted as
# "assessed" or treated as 0% complete.
_ASSESSED_STATUSES = {"in_progress", "completed", "no_evidence"}


class DrishtiContextService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        self._progress_service = ConstructionProgressService(db)

    # ── Project picker ────────────────────────────────────────────────────

    async def list_accessible_projects(
        self, org_id: str, accessible_project_ids: Optional[list[str]]
    ) -> list[dict[str, Any]]:
        """Projects Drishti can be asked about, enriched with a cheap progress
        rollup. `accessible_project_ids=None` means the caller is a system
        admin (RBACService's sentinel for "all projects") — no filter applied
        in that case; otherwise the list is the hard boundary of what this
        user may see."""
        query: dict[str, Any] = {"orgId": org_id}
        if accessible_project_ids is not None:
            # `projects._id` is stored as an ObjectId (see
            # user_project_service.py's own lookup), but the accessible-id
            # list from user_projects is always plain strings — matching
            # only the string form here silently returned zero projects for
            # every non-admin (manager) even when correctly assigned.
            object_ids = [
                ObjectId(pid) for pid in accessible_project_ids if ObjectId.is_valid(pid)
            ]
            query["$or"] = [
                {"_id": {"$in": accessible_project_ids}},
                {"_id": {"$in": object_ids}},
                {"id": {"$in": accessible_project_ids}},
            ]
        projects = await self._db["projects"].find(query).to_list(length=1000)
        if not projects:
            return []

        results: list[dict[str, Any]] = []
        for project in projects:
            project_id = str(project.get("id") or project.get("_id"))
            rollup = await self.get_project_context(org_id, project_id)
            results.append({
                "projectId": project_id,
                "projectName": str(project.get("name") or ""),
                "towerCount": len(rollup["towers"]),
                "floorCount": sum(len(t["floors"]) for t in rollup["towers"]),
                "overallProgressPct": rollup["overallProgressPct"],
                "floorsAnalyzed": rollup["floorsAnalyzed"],
                "floorsNotYetAnalyzed": rollup["floorsNotYetAnalyzed"],
                "lastAnalyzedAt": rollup["lastAnalyzedAt"],
            })
        return results

    # ── Project / tower rollup ────────────────────────────────────────────

    async def get_project_context(self, org_id: str, project_id: str) -> dict[str, Any]:
        """Aggregates existing floor snapshots up to tower/project granularity
        on the fly. Mirrors `ConstructionProgressService.list_floor_summaries`'s
        batched-lookup style, scoped to one project."""
        towers = await self._db["towers"].find(
            {"orgId": org_id, "projectId": project_id}
        ).to_list(length=1000)
        tower_ids = [str(t.get("id") or t.get("_id")) for t in towers]

        floors: list[dict[str, Any]] = []
        if tower_ids:
            floors = await self._db["floors"].find(
                {"orgId": org_id, "towerId": {"$in": tower_ids}}
            ).to_list(length=2000)
        floor_ids = [str(f.get("id") or f.get("_id")) for f in floors]
        latest_by_floor = await self.get_latest_snapshots_for_floors(org_id, floor_ids)

        floors_by_tower: dict[str, list[dict[str, Any]]] = {tid: [] for tid in tower_ids}
        for floor in floors:
            floor_id = str(floor.get("id") or floor.get("_id"))
            tower_id = str(floor.get("towerId") or "")
            latest = latest_by_floor.get(floor_id)
            floors_by_tower.setdefault(tower_id, []).append({
                "floorId": floor_id,
                "floorName": str(floor.get("label") or ""),
                "overallProgressPct": latest.get("overallProgressPct") if latest else None,
                "overallStatus": latest.get("overallStatus") if latest else None,
                "lastInspection": (latest.get("summaryCards") or {}).get("lastInspection") if latest else None,
                "analyzed": latest is not None,
            })

        tower_rollups: list[dict[str, Any]] = []
        for tower in towers:
            tower_id = str(tower.get("id") or tower.get("_id"))
            tower_floors = floors_by_tower.get(tower_id, [])
            analyzed_pcts = [f["overallProgressPct"] for f in tower_floors if f["analyzed"]]
            tower_rollups.append({
                "towerId": tower_id,
                "towerName": str(tower.get("name") or ""),
                "overallProgressPct": (
                    round(sum(analyzed_pcts) / len(analyzed_pcts), 1) if analyzed_pcts else None
                ),
                "floors": tower_floors,
            })

        all_analyzed_floors = [f for t in tower_rollups for f in t["floors"] if f["analyzed"]]
        all_unanalyzed_floors = [f for t in tower_rollups for f in t["floors"] if not f["analyzed"]]
        overall_pct = (
            round(
                sum(f["overallProgressPct"] for f in all_analyzed_floors) / len(all_analyzed_floors), 1
            )
            if all_analyzed_floors
            else None
        )
        summary_cards = self._sum_summary_cards(latest_by_floor.values())
        last_analyzed_at = max(
            (d.get("snapshotDate") for d in latest_by_floor.values() if d.get("snapshotDate")),
            default=None,
        )

        return {
            "projectId": project_id,
            "overallProgressPct": overall_pct,
            "floorsAnalyzed": len(all_analyzed_floors),
            "floorsNotYetAnalyzed": len(all_unanalyzed_floors),
            "summaryCards": summary_cards,
            "towers": tower_rollups,
            "lastAnalyzedAt": last_analyzed_at,
        }

    @staticmethod
    def _sum_summary_cards(snapshots: Any) -> dict[str, Any]:
        keys = (
            "roomsCompleted", "roomsInProgress", "roomsNotStarted",
            "activitiesCompleted", "activitiesInProgress", "activitiesNotStarted",
            "activitiesNotAssessed", "activitiesNotObservable", "imagesAnalyzed",
        )
        totals = {k: 0 for k in keys}
        for doc in snapshots:
            cards = doc.get("summaryCards") or {}
            for k in keys:
                totals[k] += int(cards.get(k) or 0)
        return totals

    # ── Floor / flat context ──────────────────────────────────────────────

    async def get_floor_context(self, org_id: str, floor_id: str) -> Optional[dict[str, Any]]:
        """Thin read of the existing latest-snapshot lookup. Returns None if
        the floor has never been analyzed — callers must treat that as
        "not enough data", never as 0% progress."""
        return await self._progress_service.get_latest_snapshot(org_id, floor_id)

    async def get_flat_context(
        self, org_id: str, floor_id: str, flat_name: str
    ) -> Optional[dict[str, Any]]:
        snapshot = await self.get_floor_context(org_id, floor_id)
        if not snapshot:
            return None
        return _find_flat(snapshot, flat_name)

    # ── Targeted room / common-area / activity lookups (never a floor-wide
    # dump) — each returns {"resolutionStatus", ...} so the answer prompt can
    # phrase "not configured" vs "configured but no evidence" vs a real
    # answer honestly, instead of the LLM ever having to guess. ──

    async def get_room_context(
        self,
        org_id: str,
        floor_id: str,
        flat_name: str,
        room_name: str,
        *,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        snapshot = snapshot if snapshot is not None else await self.get_floor_context(org_id, floor_id)
        result = {"flatName": flat_name, "roomName": room_name, "room": None, "resolutionStatus": "not_configured"}
        if not snapshot:
            return result
        flat = _find_flat(snapshot, flat_name)
        if not flat:
            return result
        room = _find_room(flat, room_name)
        if not room:
            return result
        result["room"] = room
        result["resolutionStatus"] = _room_resolution_status(room)
        return result

    async def get_common_area_context(
        self,
        org_id: str,
        floor_id: str,
        common_area_name: str,
        *,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        snapshot = snapshot if snapshot is not None else await self.get_floor_context(org_id, floor_id)
        result = {
            "flatName": _COMMON_AREA_FLAT, "commonAreaName": common_area_name,
            "room": None, "resolutionStatus": "not_configured",
        }
        if not snapshot:
            return result
        common_flat = _find_flat(snapshot, _COMMON_AREA_FLAT)
        if not common_flat:
            return result
        room = _find_room(common_flat, common_area_name)
        if not room:
            return result
        result["room"] = room
        result["resolutionStatus"] = _room_resolution_status(room)
        return result

    async def get_activity_context(
        self,
        org_id: str,
        floor_id: str,
        activity_ids: list[str] | str,
        *,
        flat_name: Optional[str] = None,
        room_name: Optional[str] = None,
        common_area_name: Optional[str] = None,
        common_area_only: bool = False,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Finds every occurrence of any of `activity_ids` within the
        requested scope. A category keyword ("tiling", "MEP", "painting")
        legitimately resolves to several real activity ids upstream — this
        method searches for all of them in one pass, not just one. Accepts a
        single id string too, for callers with exactly one resolved
        activity. Filters by activityId only — names are already resolved
        against ALL_ACTIVITIES upstream, this is a pure exact-id lookup.

        Scoping (checked in order):
        - `flat_name` given: only that flat's rooms.
        - `common_area_name` given: only that ONE named common-area unit.
        - `common_area_only=True` (and no `common_area_name`): every unit
          under the "Common Area" pseudo-flat, not narrowed to one name —
          this is what "painting status across ALL common areas" needs;
          before this flag existed, there was no way to restrict a search
          to "common areas, but not one specific unit."
        - none of the above: the whole floor, every flat AND common area
          (today's original unscoped behavior, unchanged)."""
        ids = [activity_ids] if isinstance(activity_ids, str) else list(activity_ids)
        id_set = set(ids)
        snapshot = snapshot if snapshot is not None else await self.get_floor_context(org_id, floor_id)
        if not snapshot:
            return {"activityIds": ids, "hits": [], "resolutionStatus": "not_configured"}

        flats = snapshot.get("flatProgress", [])
        if flat_name:
            flats = [f for f in flats if str(f.get("flatName") or "").strip().lower() == flat_name.strip().lower()]
        elif common_area_name or common_area_only:
            flats = [f for f in flats if str(f.get("flatName") or "") == _COMMON_AREA_FLAT]

        hits: list[dict[str, Any]] = []
        for flat in flats:
            rooms = flat.get("rooms", [])
            if room_name:
                rooms = [r for r in rooms if str(r.get("roomName") or "").strip().lower() == room_name.strip().lower()]
            elif common_area_name:
                rooms = [r for r in rooms if str(r.get("roomName") or "").strip().lower() == common_area_name.strip().lower()]
            for room in rooms:
                for activity in room.get("activities", []):
                    if activity.get("activityId") in id_set:
                        hits.append({
                            "flatName": flat.get("flatName"),
                            "roomName": room.get("roomName"),
                            "activity": activity,
                        })

        if not hits:
            resolution_status = "not_configured"
        elif all(h["activity"].get("status") == "not_assessed" for h in hits):
            resolution_status = "configured_no_evidence"
        else:
            resolution_status = "found"

        return {"activityIds": ids, "hits": hits, "resolutionStatus": resolution_status}

    async def get_common_area_category_status(
        self,
        org_id: str,
        floor_id: str,
        activity_ids: list[str] | str,
        *,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Answers "what is the status of <category> across the Common
        Areas" (e.g. painting, tiling, MEP) — aggregates the requested
        activity category across EVERY common-area unit configured on this
        floor, distinguishing units that were captured/assessed from units
        that were never captured, per the spec's required breakdown:
        - which common-area units exist/were captured
        - each relevant activity's own completion/status per unit
        - units with no evidence for this category
        - units not yet captured at all (capturesCount == 0)
        - an overall rollup across only the units that DO have real hits
        (mean of assessed completion%, never blending in unassessed 0s)."""
        ids = [activity_ids] if isinstance(activity_ids, str) else list(activity_ids)
        id_set = set(ids)
        snapshot = snapshot if snapshot is not None else await self.get_floor_context(org_id, floor_id)
        result: dict[str, Any] = {
            "activityIds": ids, "units": [], "uncapturedUnits": [],
            "overallCompletionPct": None, "resolutionStatus": "not_configured",
        }
        if not snapshot:
            return result

        common_flat = _find_flat(snapshot, _COMMON_AREA_FLAT)
        if not common_flat:
            return result

        units: list[dict[str, Any]] = []
        uncaptured_units: list[str] = []
        assessed_pcts: list[float] = []
        any_unit_at_all = False

        for room in common_flat.get("rooms", []):
            any_unit_at_all = True
            unit_name = room.get("roomName")
            captures_count = int(room.get("capturesCount") or 0)
            if captures_count == 0:
                uncaptured_units.append(unit_name)
                continue
            matching = [a for a in room.get("activities", []) if a.get("activityId") in id_set]
            if not matching:
                continue
            for activity in matching:
                units.append({
                    "commonAreaName": unit_name,
                    "activityName": activity.get("activityName"),
                    "activityId": activity.get("activityId"),
                    "completionPct": activity.get("completionPct"),
                    "status": activity.get("status"),
                    "confidencePct": activity.get("confidencePct"),
                    "evidence": activity.get("evidence") or "",
                    "capturesCount": captures_count,
                })
                if activity.get("status") in _ASSESSED_STATUSES:
                    assessed_pcts.append(float(activity.get("completionPct") or 0.0))

        result["units"] = units
        result["uncapturedUnits"] = uncaptured_units
        result["overallCompletionPct"] = round(sum(assessed_pcts) / len(assessed_pcts), 1) if assessed_pcts else None

        if not any_unit_at_all:
            result["resolutionStatus"] = "not_configured"
        elif units and assessed_pcts:
            result["resolutionStatus"] = "found"
        elif units:
            result["resolutionStatus"] = "configured_no_evidence"
        else:
            result["resolutionStatus"] = "configured_no_evidence"
        return result

    async def get_location_activities(
        self,
        org_id: str,
        floor_id: str,
        *,
        flat_name: Optional[str] = None,
        room_name: Optional[str] = None,
        common_area_name: Optional[str] = None,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Answers "what activities are pending/configured/scored at this
        location" (e.g. "what OTHER activities are pending in the Lift
        Lobby") — returns EVERY activity at exactly one location, any
        status, not filtered by activity name or by one status value. This
        is the missing "everything here" retrieval: activity_status finds
        one named activity anywhere, activity_list finds one status
        anywhere, common_area_status returns one unit's own room dict — none
        of them answer "list every activity configured for this one room/
        common-area unit" on their own."""
        snapshot = snapshot if snapshot is not None else await self.get_floor_context(org_id, floor_id)
        result: dict[str, Any] = {
            "flatName": flat_name, "roomName": room_name or common_area_name,
            "activities": [], "capturesCount": 0, "resolutionStatus": "not_configured",
        }
        if not snapshot:
            return result

        target_flat_name = flat_name if flat_name else (_COMMON_AREA_FLAT if common_area_name else None)
        target_room_name = room_name or common_area_name
        if not target_flat_name or not target_room_name:
            return result

        flat = _find_flat(snapshot, target_flat_name)
        if not flat:
            return result
        room = _find_room(flat, target_room_name)
        if not room:
            return result

        result["flatName"] = flat.get("flatName")
        result["roomName"] = room.get("roomName")
        result["capturesCount"] = room.get("capturesCount", 0)
        result["activities"] = [
            {
                "activityName": a.get("activityName"),
                "activityId": a.get("activityId"),
                "completionPct": a.get("completionPct"),
                "status": a.get("status"),
                "confidencePct": a.get("confidencePct"),
                "evidence": a.get("evidence") or "",
            }
            for a in room.get("activities", [])
        ]
        result["resolutionStatus"] = _room_resolution_status(room)
        return result

    async def get_latest_snapshots_for_floors(
        self, org_id: str, floor_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        """The batched `$group`-by-floorId aggregation `get_project_context`
        already used inline — factored out so a project-wide search (e.g.
        `find_activity_across_project`) can fetch every floor's latest FULL
        snapshot (including flatProgress) in one round trip instead of N
        separate `get_floor_context` calls."""
        if not floor_ids:
            return {}
        pipeline = [
            {"$match": {"orgId": org_id, "floorId": {"$in": floor_ids}}},
            {"$sort": {"snapshotDate": -1}},
            {"$group": {"_id": "$floorId", "doc": {"$first": "$$ROOT"}}},
        ]
        latest_by_floor: dict[str, dict[str, Any]] = {}
        async for row in self._db[_SNAPSHOT_COLLECTION].aggregate(pipeline):
            latest_by_floor[str(row["_id"])] = row["doc"]
        return latest_by_floor

    async def find_activity_across_project(
        self, org_id: str, project_context: dict[str, Any], activity_ids: list[str] | str,
    ) -> dict[str, Any]:
        """Project-wide activity search — for a question like "what is the
        current status of tiling" that names no floor/flat/room. Searches
        EVERY analyzed floor's latest snapshot in one batched query (never
        N+1), so an activity's real status is never missed just because the
        question didn't scope down to a specific floor first. A category
        keyword ("tiling", "MEP") legitimately resolves to several real
        activity ids upstream — searches for all of them at once. Reuses
        the exact per-room hit-matching logic from `get_activity_context`,
        just fanned out across floors instead of narrowed within one."""
        ids = [activity_ids] if isinstance(activity_ids, str) else list(activity_ids)
        id_set = set(ids)
        floor_entries = [
            {"floorId": f["floorId"], "floorName": f["floorName"], "towerName": t["towerName"]}
            for t in project_context.get("towers", [])
            for f in t.get("floors", [])
        ]
        floor_ids = [f["floorId"] for f in floor_entries]
        snapshots = await self.get_latest_snapshots_for_floors(org_id, floor_ids)

        hits: list[dict[str, Any]] = []
        for entry in floor_entries:
            snapshot = snapshots.get(entry["floorId"])
            if not snapshot:
                continue
            for flat in snapshot.get("flatProgress", []):
                for room in flat.get("rooms", []):
                    for activity in room.get("activities", []):
                        if activity.get("activityId") in id_set:
                            hits.append({
                                "towerName": entry["towerName"],
                                "floorId": entry["floorId"],
                                "floorName": entry["floorName"],
                                "flatName": flat.get("flatName"),
                                "roomName": room.get("roomName"),
                                "activity": activity,
                            })

        floors_analyzed = sum(1 for e in floor_entries if snapshots.get(e["floorId"]))
        if not floor_entries:
            resolution_status = "not_configured"
        elif not hits and floors_analyzed == 0:
            resolution_status = "configured_no_evidence"  # nothing analyzed yet anywhere
        elif not hits:
            resolution_status = "not_configured"  # analyzed floors exist but never scored this activity
        elif all(h["activity"].get("status") == "not_assessed" for h in hits):
            resolution_status = "configured_no_evidence"
        else:
            resolution_status = "found"

        return {
            "activityIds": ids,
            "hits": hits,
            "floorsSearched": len(floor_entries),
            "floorsAnalyzed": floors_analyzed,
            "resolutionStatus": resolution_status,
        }

    async def get_common_area_category_status_across_project(
        self, org_id: str, project_context: dict[str, Any], activity_ids: list[str] | str,
    ) -> dict[str, Any]:
        """Project-wide counterpart to `get_common_area_category_status` —
        for "what is the status of painting in the Common Areas" with no
        floor named. Aggregates the requested activity category across
        every common-area unit on every analyzed floor, per-floor, so the
        answer can still say which floor's Lift Lobby/Corridor is behind
        rather than blending every floor into one number."""
        ids = [activity_ids] if isinstance(activity_ids, str) else list(activity_ids)
        floor_entries = [
            {"floorId": f["floorId"], "floorName": f["floorName"], "towerName": t["towerName"]}
            for t in project_context.get("towers", [])
            for f in t.get("floors", [])
        ]
        floor_ids = [f["floorId"] for f in floor_entries]
        snapshots = await self.get_latest_snapshots_for_floors(org_id, floor_ids)

        by_floor: list[dict[str, Any]] = []
        all_assessed_pcts: list[float] = []
        for entry in floor_entries:
            snapshot = snapshots.get(entry["floorId"])
            if not snapshot:
                continue
            floor_result = await self.get_common_area_category_status(
                org_id, entry["floorId"], ids, snapshot=snapshot,
            )
            if floor_result["resolutionStatus"] == "not_configured" and not floor_result["units"]:
                continue
            by_floor.append({
                "floorId": entry["floorId"], "floorName": entry["floorName"],
                "towerName": entry["towerName"], **floor_result,
            })
            all_assessed_pcts.extend(
                float(u["completionPct"]) for u in floor_result["units"]
                if u.get("status") in _ASSESSED_STATUSES and u.get("completionPct") is not None
            )

        floors_analyzed = sum(1 for e in floor_entries if snapshots.get(e["floorId"]))
        if not floor_entries:
            resolution_status = "not_configured"
        elif not by_floor and floors_analyzed == 0:
            resolution_status = "configured_no_evidence"
        elif not by_floor:
            resolution_status = "not_configured"
        elif all_assessed_pcts:
            resolution_status = "found"
        else:
            resolution_status = "configured_no_evidence"

        return {
            "activityIds": ids,
            "byFloor": by_floor,
            "overallCompletionPct": round(sum(all_assessed_pcts) / len(all_assessed_pcts), 1) if all_assessed_pcts else None,
            "floorsSearched": len(floor_entries),
            "floorsAnalyzed": floors_analyzed,
            "resolutionStatus": resolution_status,
        }

    # ── Capture coverage (configured vs captured vs assessed) ────────────

    async def compute_capture_coverage(self, org_id: str, floor_id: str) -> dict[str, Any]:
        """Implements the three-way distinction the spec requires: a room
        with no capture is 'not configured/captured', never '0% complete',
        and an activity marked not_assessed/not_observable is excluded from
        the assessed count entirely (see module docstring)."""
        snapshot = await self.get_floor_context(org_id, floor_id)
        if not snapshot:
            return {
                "roomsConfigured": 0, "roomsCaptured": 0,
                "activitiesConfigured": 0, "activitiesAssessed": 0,
                "activitiesNotAssessed": 0, "activitiesNotObservable": 0,
                "coveragePct": None,
                "analyzed": False,
            }

        flats = snapshot.get("flatProgress", [])
        rooms_configured = sum(int(f.get("roomsRequired") or 0) for f in flats)
        rooms_captured = sum(int(f.get("roomsPhotographed") or 0) for f in flats)

        activities_configured = 0
        activities_assessed = 0
        activities_not_assessed = 0
        activities_not_observable = 0
        for flat in flats:
            for room in flat.get("rooms", []):
                for activity in room.get("activities", []):
                    activities_configured += 1
                    status = activity.get("status")
                    if status == "not_assessed":
                        activities_not_assessed += 1
                    elif status == "not_observable":
                        activities_not_observable += 1
                    elif status in _ASSESSED_STATUSES:
                        activities_assessed += 1

        coverage_pct = (snapshot.get("summaryCards") or {}).get("coveragePct")
        if coverage_pct is None and rooms_configured:
            coverage_pct = round(100.0 * rooms_captured / rooms_configured, 1)

        return {
            "roomsConfigured": rooms_configured,
            "roomsCaptured": rooms_captured,
            "activitiesConfigured": activities_configured,
            "activitiesAssessed": activities_assessed,
            "activitiesNotAssessed": activities_not_assessed,
            "activitiesNotObservable": activities_not_observable,
            "coveragePct": coverage_pct,
            "analyzed": True,
        }

    # ── Quality notes (existing free-text data only, no new schema) ───────

    async def get_quality_notes(
        self, org_id: str, user_id: str, role: str, project_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Reads the EXISTING legacy before/after Progress Analysis reports
        for their free-text `quality_observations` — no new severity/location
        structure is invented (the app doesn't have one). Note this only
        surfaces *saved* reports (AIProgressService.list_reports filters on
        saved=True), so an empty result means "no saved quality reports",
        not "no quality issues have ever been observed"."""
        from app.services.ai_progress_service import AIProgressService

        service = AIProgressService(self._db)
        reports, _total = await service.list_reports(
            org_id, user_id=user_id, role=role, project_id=project_id, limit=limit
        )
        notes: list[dict[str, Any]] = []
        for report in reports:
            observations = report.get("quality_observations") or report.get("qualityObservations") or []
            if not observations:
                continue
            notes.append({
                "pinName": report.get("pin_name") or report.get("pinName"),
                "floor": report.get("floor"),
                "qualityObservations": observations,
                "savedAt": report.get("saved_at") or report.get("savedAt"),
            })
        return notes


# ── Shared lookup helpers ──────────────────────────────────────────────────
# Module-level so both DrishtiContextService methods and any caller holding
# an already-fetched snapshot (e.g. drishti_service.py's rooms_in_scope
# helper) can reuse the exact same matching logic without a db round trip.

def _find_flat(snapshot: dict[str, Any], flat_name: str) -> Optional[dict[str, Any]]:
    target = flat_name.strip().lower()
    for flat in snapshot.get("flatProgress", []):
        if str(flat.get("flatName") or "").strip().lower() == target:
            return flat
    if target in ("common area", "common areas", "common"):
        for flat in snapshot.get("flatProgress", []):
            if str(flat.get("flatName") or "") == _COMMON_AREA_FLAT:
                return flat
    return None


def _find_room(flat: dict[str, Any], room_name: str) -> Optional[dict[str, Any]]:
    target = room_name.strip().lower()
    for room in flat.get("rooms", []):
        if str(room.get("roomName") or "").strip().lower() == target:
            return room
    return None


def _room_resolution_status(room: dict[str, Any]) -> str:
    """'configured_no_evidence' when the room exists in the roster but has
    no usable capture yet (capturesCount == 0 and every activity is still
    not_assessed) — 'found' otherwise. Never conflates a real 0%-progress
    room (which HAS evidence, just shows no work yet) with an unphotographed
    one."""
    captures_count = int(room.get("capturesCount") or 0)
    activities = room.get("activities", [])
    all_not_assessed = bool(activities) and all(a.get("status") == "not_assessed" for a in activities)
    if captures_count == 0 and (all_not_assessed or not activities):
        return "configured_no_evidence"
    return "found"
