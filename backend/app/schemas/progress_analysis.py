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
    floor_plan_id: str = Field(default="", alias="floorPlanId", max_length=64)
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
    """Visible progress change between BEFORE and AFTER (not room/flat completion)."""

    percentage: int = 0
    description: str = ""


class ComparisonMeta(BaseModel):
    same_location: bool = Field(default=True, alias="sameLocation")
    view_consistency: Literal["good", "fair", "poor"] = Field(
        default="fair", alias="viewConsistency"
    )
    visibility: Literal["good", "fair", "poor"] = "fair"
    comparison_confidence: int = Field(default=0, alias="comparisonConfidence")

    model_config = {"populate_by_name": True}


class ChangeDetected(BaseModel):
    """Legacy flat change row — kept for older saved reports / UI fallbacks."""

    category: str = ""
    change: str = ""
    importance: Literal["High", "Medium", "Low"] = "Medium"


class StructuredChange(BaseModel):
    category: str = ""
    area: str = ""
    change_type: str = Field(default="", alias="changeType")
    before_state: str = Field(default="", alias="beforeState")
    after_state: str = Field(default="", alias="afterState")
    impact: Literal["High", "Medium", "Low"] = "Medium"
    confidence: int = 0

    model_config = {"populate_by_name": True}


class ProgressAnalysisReport(BaseModel):
    summary: str = ""
    comparison: Optional[ComparisonMeta] = None
    # Preferred field for visible between-visit progress.
    progress: Optional[OverallProgress] = None
    # Legacy alias — always populated by normalizer for backward compatibility.
    overall_progress: OverallProgress = Field(default_factory=OverallProgress, alias="overallProgress")
    changes: list[StructuredChange] = Field(default_factory=list)
    # Legacy list derived from `changes` (or older model output).
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
    prompt_version: Optional[str] = Field(default=None, alias="promptVersion")

    model_config = {"populate_by_name": True}


class ProgressReportDetail(ProgressReportSummary):
    analysis: ProgressAnalysisReport
    model: Optional[str] = None
    latency_ms: Optional[float] = Field(default=None, alias="latencyMs")
    prompt_tokens: Optional[int] = Field(default=None, alias="promptTokens")
    completion_tokens: Optional[int] = Field(default=None, alias="completionTokens")
    total_tokens: Optional[int] = Field(default=None, alias="totalTokens")
    requested_by: Optional[str] = Field(default=None, alias="requestedBy")

    model_config = {"populate_by_name": True}


class ProgressAnalysisAuditEntry(BaseModel):
    report_id: str = Field(..., alias="reportId")
    project_id: str = Field(default="", alias="projectId")
    project_name: str = Field(default="", alias="projectName")
    tower: str = ""
    floor: str = ""
    pin_name: str = Field(default="", alias="pinName")
    model: Optional[str] = None
    prompt_tokens: int = Field(default=0, alias="promptTokens")
    completion_tokens: int = Field(default=0, alias="completionTokens")
    total_tokens: int = Field(default=0, alias="totalTokens")
    requested_by: Optional[str] = Field(default=None, alias="requestedBy")
    requested_by_name: Optional[str] = Field(default=None, alias="requestedByName")
    created_at: Optional[datetime] = Field(default=None, alias="createdAt")
    latency_ms: Optional[float] = Field(default=None, alias="latencyMs")

    model_config = {"populate_by_name": True}


class ProgressAnalysisAuditSummary(BaseModel):
    analysis_count: int = Field(default=0, alias="analysisCount")
    prompt_tokens: int = Field(default=0, alias="promptTokens")
    completion_tokens: int = Field(default=0, alias="completionTokens")
    total_tokens: int = Field(default=0, alias="totalTokens")

    model_config = {"populate_by_name": True}


class SaveProgressReportResponse(BaseModel):
    report_id: str = Field(..., alias="reportId")
    saved: bool = True
    summary: ProgressReportSummary

    model_config = {"populate_by_name": True}
