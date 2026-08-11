"""Hybrid ConstructionProgressProvider — local Gemma first, Claude escalation (T11).

Escalate a surface group when:
  - local returned zero assessments
  - confidence == low
  - activity is in a confusable_with family
  - precedence found a contradiction (logged upstream)

Until Claude group-call integration is complete inside the vLLM assess path,
this hybrid wrapper runs the local provider and records that hybrid mode is
active on the result model string. Escalation hooks live in
anthropic_provider.escalate_surface_group_to_claude for the next wiring pass.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from loguru import logger

from app.core.config import Settings, get_settings
from app.services.construction_progress_providers.activities import ActivityDef
from app.services.construction_progress_providers.base import (
    CaptureRef,
    ConstructionProgressProvider,
    FloorProgressResult,
)
from app.services.construction_progress_providers.vllm_provider import (
    VllmConstructionProgressProvider,
)


class HybridConstructionProgressProvider(ConstructionProgressProvider):
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: Any | None = None,
        org_id: str | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._local = VllmConstructionProgressProvider(db=db, org_id=org_id)
        self._db = db

    async def assess_floor_progress(
        self,
        *,
        floor_id: str,
        activities: list[ActivityDef],
        captures: list[CaptureRef],
        as_of: datetime,
        flat_units: list[str] | None = None,
        common_area_units: list[str] | None = None,
        flat_room_rosters: dict[str, list[str]] | None = None,
        context: dict[str, str] | None = None,
    ) -> FloorProgressResult:
        logger.info(
            "Hybrid provider: local-first assess floor_id={} (claude escalate ready={})",
            floor_id,
            bool((self._settings.ANTHROPIC_API_KEY or "").strip()),
        )
        result = await self._local.assess_floor_progress(
            floor_id=floor_id,
            activities=activities,
            captures=captures,
            as_of=as_of,
            flat_units=flat_units,
            common_area_units=common_area_units,
            flat_room_rosters=flat_room_rosters,
            context=context,
        )
        # Tag provenance so snapshots / reviews can distinguish hybrid runs.
        tagged_model = f"hybrid:{result.model}"
        return FloorProgressResult(
            overall_progress_pct=result.overall_progress_pct,
            overall_confidence_pct=result.overall_confidence_pct,
            activities=result.activities,
            executive_summary=result.executive_summary,
            model=tagged_model,
            per_capture_completion=result.per_capture_completion,
            flat_progress=result.flat_progress,
        )
