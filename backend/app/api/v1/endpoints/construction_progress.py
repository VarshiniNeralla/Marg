from fastapi import APIRouter, HTTPException, Query, status

from app.core.dependencies import CallerContext, DB, ManagerOrAdminUser
from app.services.construction_progress_providers import activities_as_dicts
from app.services.construction_progress_service import ConstructionProgressService
from app.utils.pagination import success_response

router = APIRouter(prefix="/construction-progress", tags=["Construction Progress"])


@router.get("/activities", summary="List predefined finishing activities")
async def list_activities(_manager_or_admin: ManagerOrAdminUser):
    """Static checklist definitions (name/section/sequence) — single source
    of truth shared with the mock (and later real) scoring engine."""
    return success_response(data=activities_as_dicts())


@router.get("/floors", summary="List floors with progress summary")
async def list_floors(ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    summaries = await service.list_floor_summaries(ctx.org_id)
    return success_response(data=summaries)


@router.get("/floors/{floor_id}", summary="Get latest progress snapshot for a floor")
async def get_floor_detail(floor_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    snapshot = await service.get_latest_snapshot(ctx.org_id, floor_id)
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This floor has not been analyzed yet. Run analyze to generate its first report.",
        )
    return success_response(data=snapshot)


@router.post(
    "/floors/{floor_id}/analyze",
    status_code=status.HTTP_201_CREATED,
    summary="Generate a new progress snapshot for a floor",
)
async def analyze_floor(floor_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    try:
        snapshot = await service.analyze_floor(ctx.org_id, floor_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return success_response(data=snapshot, message="Progress snapshot generated")


@router.get("/floors/{floor_id}/timeline", summary="Progress trend over time for a floor")
async def get_floor_timeline(floor_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    timeline = await service.get_timeline(ctx.org_id, floor_id)
    return success_response(data=timeline)


@router.get("/floors/{floor_id}/heatmap", summary="Room-level heatmap for a floor's latest snapshot")
async def get_floor_heatmap(floor_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    heatmap = await service.get_heatmap(ctx.org_id, floor_id)
    return success_response(data=heatmap)


@router.delete("/floors/{floor_id}", summary="Delete all progress reports for a floor")
async def delete_floor_reports(floor_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    service = ConstructionProgressService(db)
    deleted_count = await service.delete_floor_reports(ctx.org_id, floor_id)
    if deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No reports found for this floor.")
    return success_response(data={"deletedCount": deleted_count}, message="Progress reports deleted")


@router.get("/floors/{floor_id}/compare", summary="Compare two snapshots for a floor")
async def compare_floor_snapshots(
    floor_id: str,
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
    from_snapshot_id: str = Query(..., alias="from"),
    to_snapshot_id: str = Query(..., alias="to"),
):
    service = ConstructionProgressService(db)
    try:
        comparison = await service.compare(ctx.org_id, floor_id, from_snapshot_id, to_snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return success_response(data=comparison)
