"""
Activity scope for construction-progress analysis.

A floor's scope is the list of CORE activity ids the AI is asked about. Default (no stored
document) is every current core activity, so nothing changes until someone edits it.

* Stored in ``construction_progress_scope``: {orgId, floorId, activityIds, updatedAt, updatedBy}.
* Stamped on every snapshot as ``activityScope`` so old snapshots re-read consistently
  (a snapshot without ``activityScope`` means "every core activity").
* Changing the scope never re-runs the AI. The latest snapshot of each affected floor is flagged
  ``scopeChangedSinceAnalysis`` and, when the new scope only NARROWS the analysed one, its
  ``activityScope`` is narrowed too so every total is recomputed from the stored assessments.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import BadRequestException
from app.services.construction_progress_providers.activities import (
    CORE_ACTIVITIES,
    CORE_IDS,
    ActivityDef,
    scope_filtered_core,  # noqa: F401 - re-exported: the one helper callers use to turn ids into activities
)

COLLECTION_SCOPE = "construction_progress_scope"
_SNAPSHOTS = "construction_progress_snapshots"

APPLY_TO_VALUES = ("floor", "tower", "project")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> Any:
    from app.services.construction_progress_service import iso_utc

    return iso_utc(value)


def all_core_ids() -> list[str]:
    """Every current core activity id, in catalogue order."""
    return [a.activity_id for a in CORE_ACTIVITIES]


def _describe(a: ActivityDef) -> str:
    explicit = str(getattr(a, "description", "") or "").strip()
    if explicit:
        return explicit
    text = " ".join(str(a.visual_criteria or "").split())
    if len(text) > 200:
        text = text[:197].rstrip() + "..."
    return text


def core_catalog() -> list[dict[str, Any]]:
    """The selectable activities: CORE only (legacy activities have no rules, so they are not selectable)."""
    return [
        {
            "activityId": a.activity_id,
            "name": a.name,
            "section": a.section,
            "description": _describe(a),
            "applicableRooms": sorted(a.applicable_rooms),
            "core": True,
        }
        for a in CORE_ACTIVITIES
    ]


def validate_activity_ids(activity_ids: Any) -> list[str]:
    """Return a de-duplicated list in catalogue order, or raise a 400 for unknown / empty selections."""
    if not isinstance(activity_ids, (list, tuple, set, frozenset)):
        raise BadRequestException("activityIds must be a list of activity ids")
    requested = [str(i) for i in activity_ids]
    unknown = sorted({i for i in requested if i not in CORE_IDS})
    if unknown:
        raise BadRequestException(f"Unknown or non-selectable activity ids: {', '.join(unknown)}")
    wanted = set(requested)
    if not wanted:
        raise BadRequestException("Select at least one activity")
    return [i for i in all_core_ids() if i in wanted]


def sanitize_stored_ids(activity_ids: Any) -> list[str] | None:
    """A stored list intersected with today's core ids (ids dropped from core vanish); None if nothing is left."""
    if not isinstance(activity_ids, (list, tuple)):
        return None
    wanted = {str(i) for i in activity_ids}
    kept = [i for i in all_core_ids() if i in wanted]
    return kept or None


class ConstructionProgressScopeService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    # ── Reads ─────────────────────────────────────────────────────────────

    async def get_scope_ids(self, org_id: str, floor_id: str) -> list[str] | None:
        """The floor's stored selection, or None when it is on the default (every core activity)."""
        doc = await self._db[COLLECTION_SCOPE].find_one({"orgId": org_id, "floorId": floor_id})
        return sanitize_stored_ids((doc or {}).get("activityIds"))

    async def get_effective_ids(self, org_id: str, floor_id: str) -> list[str]:
        return await self.get_scope_ids(org_id, floor_id) or all_core_ids()

    async def get_scopes_for_floors(self, org_id: str, floor_ids: list[str]) -> dict[str, list[str] | None]:
        """floor_id -> stored selection (None = default) for many floors in one query."""
        out: dict[str, list[str] | None] = {fid: None for fid in floor_ids}
        if not floor_ids:
            return out
        async for doc in self._db[COLLECTION_SCOPE].find({"orgId": org_id, "floorId": {"$in": list(floor_ids)}}):
            out[str(doc.get("floorId"))] = sanitize_stored_ids(doc.get("activityIds"))
        return out

    async def floor_location(self, org_id: str, floor_id: str) -> dict[str, str]:
        """{towerId, projectId} of a floor ("" when it cannot be resolved). Lets the UI start a tower or
        project analysis right after saving the activity list, even on a floor with no snapshot yet."""
        try:
            floor = await self._db["floors"].find_one({"_id": floor_id, "orgId": org_id}) \
                or await self._db["floors"].find_one({"id": floor_id, "orgId": org_id})
            tower_id = str((floor or {}).get("towerId") or "")
            if not tower_id:
                return {"towerId": "", "projectId": ""}
            tower = await self._db["towers"].find_one({"_id": tower_id, "orgId": org_id}) \
                or await self._db["towers"].find_one({"id": tower_id, "orgId": org_id})
            return {"towerId": tower_id, "projectId": str((tower or {}).get("projectId") or "")}
        except Exception as exc:  # a lookup problem must never break the activity list
            logger.warning("[cp-scope] could not resolve floor location floor={}: {!r}", floor_id, exc)
            return {"towerId": "", "projectId": ""}

    async def get_scope_view(self, org_id: str, floor_id: str) -> dict[str, Any]:
        doc = await self._db[COLLECTION_SCOPE].find_one({"orgId": org_id, "floorId": floor_id}) or {}
        stored = sanitize_stored_ids(doc.get("activityIds"))
        ids = stored or all_core_ids()
        location = await self.floor_location(org_id, floor_id)
        return {
            "floorId": floor_id,
            "towerId": location["towerId"],
            "projectId": location["projectId"],
            "activityIds": ids,
            "isDefault": set(ids) == set(all_core_ids()),
            "updatedAt": _iso(doc.get("updatedAt")) if stored else None,
            "updatedBy": doc.get("updatedBy") if stored else None,
            "catalog": core_catalog(),
        }

    # ── Writes ────────────────────────────────────────────────────────────

    async def set_scope(
        self,
        org_id: str,
        floor_id: str,
        activity_ids: Any,
        *,
        updated_by: str | None,
        apply_to: str = "floor",
    ) -> dict[str, Any]:
        if apply_to not in APPLY_TO_VALUES:
            raise BadRequestException("applyTo must be floor, tower or project")
        ids = validate_activity_ids(activity_ids)
        floor_ids = await self._target_floor_ids(org_id, floor_id, apply_to)
        now = _utcnow()
        for fid in floor_ids:
            await self._db[COLLECTION_SCOPE].update_one(
                {"orgId": org_id, "floorId": fid},
                {"$set": {"activityIds": ids, "updatedAt": now, "updatedBy": updated_by}},
                upsert=True,
            )
            await self._flag_latest_snapshot(org_id, fid, ids)
        logger.info(
            "[cp-scope] scope set org={} floor={} apply_to={} floors={} size={}",
            org_id, floor_id, apply_to, len(floor_ids), len(ids),
        )
        return await self.get_scope_view(org_id, floor_id)

    async def _target_floor_ids(self, org_id: str, floor_id: str, apply_to: str) -> list[str]:
        if apply_to == "floor":
            return [floor_id]
        floor = await self._db["floors"].find_one({"_id": floor_id, "orgId": org_id}) \
            or await self._db["floors"].find_one({"id": floor_id, "orgId": org_id})
        if not floor:
            return [floor_id]
        tower_id = str(floor.get("towerId") or "")
        if apply_to == "tower":
            tower_ids = [tower_id] if tower_id else []
        else:
            tower = await self._db["towers"].find_one({"_id": tower_id, "orgId": org_id}) \
                or await self._db["towers"].find_one({"id": tower_id, "orgId": org_id})
            project_id = (tower or {}).get("projectId")
            if not project_id:
                tower_ids = [tower_id] if tower_id else []
            else:
                tower_ids = [
                    str(t.get("id") or t.get("_id"))
                    async for t in self._db["towers"].find({"orgId": org_id, "projectId": project_id})
                ]
        floors = await self._db["floors"].find(
            {"orgId": org_id, "towerId": {"$in": tower_ids}}
        ).to_list(length=5000) if tower_ids else []
        ids = [str(f.get("id") or f.get("_id")) for f in floors]
        if floor_id not in ids:
            ids.append(floor_id)
        return ids

    async def _flag_latest_snapshot(self, org_id: str, floor_id: str, new_ids: list[str]) -> None:
        """Mark the floor's newest snapshot as 'scope changed' (no AI run).

        The analysed scope is remembered once in ``analysedActivityScope``. When the new scope is a
        subset of it the snapshot's effective ``activityScope`` is narrowed so totals follow the choice
        immediately; when it adds activities the stored scope stays until the floor is re-analysed
        (nothing was assessed for the new ones).
        """
        try:
            latest = await self._db[_SNAPSHOTS].find_one(
                {"orgId": org_id, "floorId": floor_id}, sort=[("snapshotDate", -1)],
            )
            if not latest:
                return
            effective = latest.get("activityScope")
            effective_set = set(effective) if isinstance(effective, list) else set(CORE_IDS)
            analysed = latest.get("analysedActivityScope")
            analysed_set = set(analysed) if isinstance(analysed, list) else effective_set
            update: dict[str, Any] = {
                "scopeChangedSinceAnalysis": set(new_ids) != analysed_set,
                "updatedAt": _utcnow(),
            }
            if not isinstance(analysed, list):
                update["analysedActivityScope"] = sorted(analysed_set)
            if set(new_ids) <= analysed_set:
                update["activityScope"] = list(new_ids)
            await self._db[_SNAPSHOTS].update_one({"_id": latest["_id"]}, {"$set": update})
        except Exception as exc:  # a flag problem must never fail the scope save
            logger.warning("[cp-scope] could not flag snapshot floor={}: {!r}", floor_id, exc)
