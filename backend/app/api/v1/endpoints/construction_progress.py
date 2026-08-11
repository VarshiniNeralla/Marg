from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.dependencies import CallerContext, DB, ManagerOrAdminUser
from app.services.construction_progress_providers import activities_as_dicts
from app.services.construction_progress_review_service import ConstructionProgressReviewService
from app.services.construction_progress_service import ConstructionProgressService
from app.utils.pagination import success_response

router = APIRouter(prefix="/construction-progress", tags=["Construction Progress"])


class ActivityCorrectionIn(BaseModel):
    activityId: str
    verdict: str  # "correct" | "wrong"
    correctPercentage: float | None = None
    note: str | None = None


class PinRoomVerdictIn(BaseModel):
    pinNumber: int
    roomCorrect: str  # "yes" | "no"
    actualRoom: str | None = None


class ProgressReviewIn(BaseModel):
    snapshotId: str
    floorId: str
    flatName: str
    roomName: str
    pinNumbers: list[int] = Field(default_factory=list)
    roomCorrect: str  # "yes" | "no" — rollup when pinRoomVerdicts present
    actualRoom: str | None = None
    pinRoomVerdicts: list[PinRoomVerdictIn] = Field(default_factory=list)
    progressVerdict: str  # "correct" | "mostly_correct" | "wrong"
    activityCorrections: list[ActivityCorrectionIn] = Field(default_factory=list)
    note: str | None = None


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
        snapshot = await service.analyze_floor(ctx.org_id, floor_id, analyzed_by=ctx.user_id)
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


@router.post(
    "/reviews",
    status_code=status.HTTP_201_CREATED,
    summary="Submit a human accuracy review for one room in a snapshot",
)
async def create_progress_review(
    body: ProgressReviewIn,
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
):
    if body.roomCorrect not in ("yes", "no"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="roomCorrect must be yes|no")
    if body.progressVerdict not in ("correct", "mostly_correct", "wrong"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="progressVerdict must be correct|mostly_correct|wrong",
        )
    if body.pinRoomVerdicts:
        for verdict in body.pinRoomVerdicts:
            if verdict.roomCorrect not in ("yes", "no"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="pinRoomVerdicts.roomCorrect must be yes|no",
                )
            if verdict.roomCorrect == "no" and not (verdict.actualRoom or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"actualRoom is required when Pin {verdict.pinNumber} roomCorrect is no",
                )
    elif body.roomCorrect == "no" and not (body.actualRoom or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="actualRoom is required when roomCorrect is no",
        )
    for corr in body.activityCorrections:
        if corr.verdict not in ("correct", "wrong"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="activityCorrections.verdict must be correct|wrong",
            )
        if corr.correctPercentage is not None and not (0 <= corr.correctPercentage <= 100):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="activityCorrections.correctPercentage must be between 0 and 100",
            )
    service = ConstructionProgressReviewService(db)
    try:
        review = await service.create_review(
            org_id=ctx.org_id,
            reviewed_by=ctx.user_id,
            payload=body.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return success_response(data=review, message="Review recorded")


@router.get("/reviews", summary="List progress reviews")
async def list_progress_reviews(
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
    floor_id: str | None = Query(None, alias="floorId"),
    snapshot_id: str | None = Query(None, alias="snapshotId"),
):
    service = ConstructionProgressReviewService(db)
    reviews = await service.list_reviews(org_id=ctx.org_id, floor_id=floor_id, snapshot_id=snapshot_id)
    return success_response(data=reviews)


@router.get("/reviews/summary", summary="Accuracy summary grouped by prompt/rig version")
async def summarize_progress_reviews(
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
    floor_id: str | None = Query(None, alias="floorId"),
):
    service = ConstructionProgressReviewService(db)
    summary = await service.summary(org_id=ctx.org_id, floor_id=floor_id)
    return success_response(data=summary)
