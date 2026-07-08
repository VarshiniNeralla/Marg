from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.dependencies import CallerContext, DB, AdminUser, ManagerOrAdminUser
from app.schemas.auth import ApiResponse
from app.schemas.progress_analysis import (
    ProgressAnalysisAuditEntry,
    ProgressAnalysisAuditSummary,
    ProgressAnalysisJobResponse,
    ProgressAnalysisReport,
    ProgressAnalysisRequest,
    ProgressAnalysisStartResponse,
    ProgressReportDetail,
    ProgressReportSummary,
    SaveProgressReportResponse,
)
from app.services.ai_progress_service import AIProgressService
from app.utils.pagination import paginated_response

router = APIRouter(prefix="/progress-analysis", tags=["Progress Analysis"])


def _to_report(data: dict | None) -> ProgressAnalysisReport | None:
    if not data:
        return None
    return ProgressAnalysisReport.model_validate(data)


@router.get(
    "/reports",
    summary="List previous construction progress reports (manager/admin)",
)
async def list_progress_reports(
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    project_id: str | None = Query(default=None, alias="projectId"),
    pin_name: str | None = Query(default=None, alias="pinName"),
    before_timeline_id: str | None = Query(default=None, alias="beforeTimelineId"),
    after_timeline_id: str | None = Query(default=None, alias="afterTimelineId"),
):
    """List cached progress analysis reports for the organization."""
    service = AIProgressService(db)
    skip = (page - 1) * limit
    items, total = await service.list_reports(
        ctx.org_id,
        user_id=ctx.user_id,
        role=ctx.role,
        project_id=project_id,
        pin_name=pin_name,
        before_timeline_id=before_timeline_id,
        after_timeline_id=after_timeline_id,
        skip=skip,
        limit=limit,
    )
    summaries = [ProgressReportSummary.model_validate(item) for item in items]
    return paginated_response(
        data=[s.model_dump(by_alias=True) for s in summaries],
        total=total,
        page=page,
        limit=limit,
    )


@router.get(
    "/audit",
    summary="List LLM token usage for progress analyses (admin)",
)
async def list_progress_analysis_audit(
    ctx: CallerContext,
    db: DB,
    _admin: AdminUser,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Return per-analysis input/output/total token counts for the admin Audit view."""
    service = AIProgressService(db)
    skip = (page - 1) * limit
    items, total, summary_raw = await service.list_token_audit(
        ctx.org_id,
        skip=skip,
        limit=limit,
    )
    entries = [ProgressAnalysisAuditEntry.model_validate(item) for item in items]
    summary = ProgressAnalysisAuditSummary.model_validate(summary_raw)
    response = paginated_response(
        data=[e.model_dump(by_alias=True) for e in entries],
        total=total,
        page=page,
        limit=limit,
    )
    response["summary"] = summary.model_dump(by_alias=True)
    return response


@router.get(
    "/reports/{report_id}",
    response_model=ApiResponse[ProgressReportDetail],
    summary="Get a single progress report (manager/admin)",
)
async def get_progress_report(
    report_id: str,
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
) -> ApiResponse[ProgressReportDetail]:
    service = AIProgressService(db)
    doc = await service.get_report(
        ctx.org_id,
        report_id,
        user_id=ctx.user_id,
        role=ctx.role,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    detail = ProgressReportDetail.model_validate(doc)
    return ApiResponse(success=True, data=detail)


@router.post(
    "/reports/{report_id}/save",
    response_model=ApiResponse[SaveProgressReportResponse],
    summary="Save a progress report to the library",
)
async def save_progress_report(
    report_id: str,
    ctx: CallerContext,
    db: DB,
) -> ApiResponse[SaveProgressReportResponse]:
    """Persist an analysis so it appears in Progress Reports."""
    service = AIProgressService(db)
    try:
        summary = await service.save_report(ctx.org_id, report_id, user_id=ctx.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    response = SaveProgressReportResponse(
        reportId=summary["reportId"],
        saved=True,
        summary=ProgressReportSummary.model_validate(summary),
    )
    return ApiResponse(success=True, data=response, message="Report saved")


@router.post(
    "",
    response_model=ApiResponse[ProgressAnalysisStartResponse],
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start AI construction progress analysis",
)
async def start_progress_analysis(
    payload: ProgressAnalysisRequest,
    ctx: CallerContext,
    db: DB,
) -> ApiResponse[ProgressAnalysisStartResponse]:
    """
    Compare two timeline captures at the same location and generate a
    construction progress report using the configured vision provider (vLLM or Groq).

    Returns immediately with a job ID for polling, or the cached analysis
    if the same timeline pair was analyzed before.
    """
    service = AIProgressService(db)

    try:
        result = await service.start_analysis(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            before_timeline_id=payload.before_timeline_id,
            after_timeline_id=payload.after_timeline_id,
            before_image=payload.before_image,
            after_image=payload.after_image,
            before_date=payload.before_date,
            after_date=payload.after_date,
            project_name=payload.project_name,
            tower=payload.tower,
            floor=payload.floor,
            pin_name=payload.pin_name,
            capture_type=payload.capture_type,
            project_id=payload.project_id,
            floor_plan_image=payload.floor_plan_image,
            floor_plan_id=payload.floor_plan_id,
            pin_x=payload.pin_x,
            pin_y=payload.pin_y,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    response = ProgressAnalysisStartResponse(
        status=result["status"],
        jobId=result.get("jobId"),
        reportId=result.get("reportId"),
        saved=bool(result.get("saved")),
        cached=result.get("cached", False),
        analysis=_to_report(result.get("analysis")),
    )

    message = "Analysis completed (cached)" if response.cached else "Analysis started"
    return ApiResponse(success=True, data=response, message=message)


@router.get(
    "/{job_id}",
    response_model=ApiResponse[ProgressAnalysisJobResponse],
    summary="Poll progress analysis job status",
)
async def get_progress_analysis_job(
    job_id: str,
    ctx: CallerContext,
    db: DB,
) -> ApiResponse[ProgressAnalysisJobResponse]:
    """Poll an in-progress analysis job until it completes or fails."""
    service = AIProgressService(db)
    job = await service.get_job_enriched(ctx.org_id, job_id)

    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis job not found")

    response = ProgressAnalysisJobResponse(
        status=job["status"],
        jobId=job["_id"],
        reportId=job.get("reportId"),
        saved=bool(job.get("saved")),
        cached=False,
        analysis=_to_report(job.get("analysis")),
        error=job.get("error"),
    )
    return ApiResponse(success=True, data=response)
