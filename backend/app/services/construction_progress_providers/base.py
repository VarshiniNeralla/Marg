"""
Abstract interface for AI construction-progress assessment providers.

Sibling to `app.services.vision_providers.base.VisionProvider` — deliberately
NOT the same ABC, since `VisionProvider`'s methods are shaped around pairwise
image comparison (before/after) or single-crop extraction, whereas assessing
a whole floor's progress against a checklist of activities is a different
shape of call (many images, many activities, one floor). The service layer
(`construction_progress_service.py`) depends only on this interface, so a
real vision-model-backed provider (see vllm_provider.py) can replace another
one later without any change to the API endpoints, Mongo schema, or frontend.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.services.construction_progress_providers.activities import ActivityDef

ActivityStatus = Literal[
    "not_started", "in_progress", "mostly_complete", "completed", "unable_to_determine"
]


@dataclass(frozen=True)
class CaptureRef:
    """One capture available as evidence for a floor, with just enough context
    for a provider to reason about which activity it's plausible evidence for."""

    capture_id: str
    room_name: str
    flat_name: str
    captured_at: datetime | None
    image_url: str


@dataclass(frozen=True)
class ActivityAssessment:
    activity: ActivityDef
    status: ActivityStatus
    completion_pct: float
    confidence_pct: float
    evidence_capture_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FloorProgressResult:
    overall_progress_pct: float
    overall_confidence_pct: float
    activities: list[ActivityAssessment]
    executive_summary: str
    model: str


class ConstructionProgressProvider(ABC):
    """Assesses a floor's finishing-activity checklist from its uploaded captures."""

    @abstractmethod
    async def assess_floor_progress(
        self,
        *,
        floor_id: str,
        activities: list[ActivityDef],
        captures: list[CaptureRef],
        as_of: datetime,
    ) -> FloorProgressResult:
        """
        Assess every activity in `activities` against the evidence available in
        `captures`, as of `as_of` (so re-running "today" vs. a past date can
        differ, and re-running the SAME date is expected to be deterministic).
        """
