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
            query["$or"] = [
                {"_id": {"$in": accessible_project_ids}},
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

        latest_by_floor: dict[str, dict[str, Any]] = {}
        if floor_ids:
            pipeline = [
                {"$match": {"orgId": org_id, "floorId": {"$in": floor_ids}}},
                {"$sort": {"snapshotDate": -1}},
                {"$group": {"_id": "$floorId", "doc": {"$first": "$$ROOT"}}},
            ]
            async for row in self._db[_SNAPSHOT_COLLECTION].aggregate(pipeline):
                latest_by_floor[str(row["_id"])] = row["doc"]

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
        target = flat_name.strip().lower()
        for flat in snapshot.get("flatProgress", []):
            if str(flat.get("flatName") or "").strip().lower() == target:
                return flat
        if target in ("common area", "common areas", "common"):
            for flat in snapshot.get("flatProgress", []):
                if str(flat.get("flatName") or "") == _COMMON_AREA_FLAT:
                    return flat
        return None

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
