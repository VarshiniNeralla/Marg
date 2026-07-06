from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ProgressAnalysisRequest(BaseModel):
    before_image: str = Field(..., alias="beforeImage", min_length=10, max_length=2048)
    after_image: str = Field(..., alias="afterImage", min_length=10, max_length=2048)
    before_date: str = Field(..., alias="beforeDate", max_length=200)
    after_date: str = Field(..., alias="afterDate", max_length=200)
    before_timeline_id: str = Field(..., alias="beforeTimelineId", min_length=1, max_length=64)
    after_timeline_id: str = Field(..., alias="afterTimelineId", min_length=1, max_length=64)
    project_name: str = Field(..., alias="projectName", max_length=200)
    tower: str = Field(..., alias="tower", max_length=200)
    floor: str = Field(..., alias="floor", max_length=200)
    pin_name: str = Field(..., alias="pinName", max_length=200)
    capture_type: str = Field(default="360", alias="captureType", max_length=32)
    project_id: str = Field(default="", alias="projectId", max_length=64)
    floor_plan_image: str = Field(default="", alias="floorPlanImage", max_length=2048)
    pin_x: Optional[float] = Field(default=None, alias="pinX", ge=0, le=100)
    pin_y: Optional[float] = Field(default=None, alias="pinY", ge=0, le=100)
    force_refresh: bool = Field(default=False, alias="forceRefresh")

    model_config = {"populate_by_name": True}

    @field_validator(
        "before_date",
        "after_date",
        "project_name",
        "tower",
        "floor",
        "pin_name",
        "capture_type",
        mode="before",
    )
    @classmethod
    def strip_text_fields(cls, v: str) -> str:
        return (v or "").strip()


class OverallProgress(BaseModel):
    percentage: int = 0
    description: str = ""


class ChangeDetected(BaseModel):
    category: str = ""
    change: str = ""
    importance: Literal["High", "Medium", "Low"] = "Medium"


class ProgressAnalysisReport(BaseModel):
    summary: str = ""
    overall_progress: OverallProgress = Field(default_factory=OverallProgress, alias="overallProgress")
    changes_detected: list[ChangeDetected] = Field(default_factory=list, alias="changesDetected")
    completed_work: list[str] = Field(default_factory=list, alias="completedWork")
    newly_added: list[str] = Field(default_factory=list, alias="newlyAdded")
    removed_items: list[str] = Field(default_factory=list, alias="removedItems")
    pending_work: list[str] = Field(default_factory=list, alias="pendingWork")
    quality_observations: list[str] = Field(default_factory=list, alias="qualityObservations")
    risks: list[str] = Field(default_factory=list)
    recommended_next_steps: list[str] = Field(default_factory=list, alias="recommendedNextSteps")
    confidence: int = 0

    model_config = {"populate_by_name": True}


class ProgressAnalysisStartResponse(BaseModel):
    status: Literal["pending", "processing", "completed", "failed"]
    job_id: Optional[str] = Field(default=None, alias="jobId")
    report_id: Optional[str] = Field(default=None, alias="reportId")
    saved: bool = False
    cached: bool = False
    analysis: Optional[ProgressAnalysisReport] = None

    model_config = {"populate_by_name": True}


class ProgressAnalysisJobResponse(BaseModel):
    status: Literal["pending", "processing", "completed", "failed"]
    job_id: str = Field(..., alias="jobId")
    report_id: Optional[str] = Field(default=None, alias="reportId")
    saved: bool = False
    cached: bool = False
    analysis: Optional[ProgressAnalysisReport] = None
    error: Optional[str] = None

    model_config = {"populate_by_name": True}


class ProgressReportSummary(BaseModel):
    report_id: str = Field(..., alias="reportId")
    before_timeline_id: str = Field(..., alias="beforeTimelineId")
    after_timeline_id: str = Field(..., alias="afterTimelineId")
    project_id: str = Field(default="", alias="projectId")
    project_name: str = Field(default="", alias="projectName")
    tower: str = ""
    floor: str = ""
    pin_name: str = Field(default="", alias="pinName")
    before_date: str = Field(default="", alias="beforeDate")
    after_date: str = Field(default="", alias="afterDate")
    capture_type: str = Field(default="360", alias="captureType")
    summary: str = ""
    overall_progress_percentage: int = Field(default=0, alias="overallProgressPercentage")
    confidence: int = 0
    created_at: Optional[datetime] = Field(default=None, alias="createdAt")
    saved_at: Optional[datetime] = Field(default=None, alias="savedAt")
    before_image_url: str = Field(default="", alias="beforeImageUrl")
    after_image_url: str = Field(default="", alias="afterImageUrl")
    floor_plan_image_url: str = Field(default="", alias="floorPlanImageUrl")
    pin_x: Optional[float] = Field(default=None, alias="pinX")
    pin_y: Optional[float] = Field(default=None, alias="pinY")
    saved: bool = False

    model_config = {"populate_by_name": True}


class ProgressReportDetail(ProgressReportSummary):
    analysis: ProgressAnalysisReport
    model: Optional[str] = None
    latency_ms: Optional[float] = Field(default=None, alias="latencyMs")
    total_tokens: Optional[int] = Field(default=None, alias="totalTokens")
    requested_by: Optional[str] = Field(default=None, alias="requestedBy")

    model_config = {"populate_by_name": True}


class SaveProgressReportResponse(BaseModel):
    report_id: str = Field(..., alias="reportId")
    saved: bool = True
    summary: ProgressReportSummary

    model_config = {"populate_by_name": True}
