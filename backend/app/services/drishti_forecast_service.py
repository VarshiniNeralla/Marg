"""
Velocity-based completion forecasting for Drishti.

No forecasting/velocity logic exists anywhere else in the codebase — this is
net-new, and deliberately simple: a two/three-point linear estimate with a
pragmatic uncertainty band, not a statistically rigorous model. It is built
entirely from `ConstructionProgressService.get_timeline`'s existing
`overallProgressPct` time series; it never invents a data point.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_service import ConstructionProgressService

_MIN_SNAPSHOTS = 2
_MIN_SPAN_DAYS = 3
_RECENCY_WINDOW = 3
_RECENCY_DIVERGENCE_THRESHOLD = 0.20
_FALLBACK_RANGE_PCT = 0.25


class DrishtiForecastService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        self._progress_service = ConstructionProgressService(db)

    async def forecast_floor(self, org_id: str, floor_id: str) -> dict[str, Any]:
        timeline = await self._progress_service.get_timeline(org_id, floor_id)
        return compute_velocity_forecast(timeline)

    async def forecast_project(self, org_id: str, project_id: str, floor_ids: list[str]) -> dict[str, Any]:
        """Rolls up every floor's own forecast to a project-level estimate.
        Reports both the critical-path floor (max projected date — a project
        isn't done until its slowest floor is) and a softer mean-of-floors
        estimate, so an answer can name the actual bottleneck rather than
        blend it away into one misleading number."""
        if not floor_ids:
            return {"status": "insufficient_data", "reason": "This project has no floors yet."}

        forecasts = await asyncio.gather(
            *(self.forecast_floor(org_id, fid) for fid in floor_ids)
        )
        ok_forecasts = [
            (fid, f) for fid, f in zip(floor_ids, forecasts)
            if f.get("status") == "ok" and f.get("daysToComplete") is not None
        ]
        if not ok_forecasts:
            return {
                "status": "insufficient_data",
                "reason": "No floor in this project has enough dated history yet for a forecast.",
            }

        critical_floor_id, critical_forecast = max(ok_forecasts, key=lambda pair: pair[1]["daysToComplete"])
        mean_days = sum(f["daysToComplete"] for _fid, f in ok_forecasts) / len(ok_forecasts)

        return {
            "status": "ok",
            "criticalPathFloorId": critical_floor_id,
            "criticalPathForecast": critical_forecast,
            "meanDaysToComplete": round(mean_days, 1),
            "floorsWithForecast": len(ok_forecasts),
            "floorsTotal": len(floor_ids),
        }


def _confidence_bucket(snapshot_count: int, span_days: int) -> str:
    if snapshot_count >= 8 and span_days >= 30:
        return "high"
    if snapshot_count >= 4 and span_days >= 14:
        return "medium"
    return "low"


def compute_velocity_forecast(timeline: list[dict[str, Any]]) -> dict[str, Any]:
    """Pure function — no db access — so it's directly unit-testable.

    `timeline` is the ascending `[{snapshotId, snapshotDate, overallProgressPct}]`
    list `ConstructionProgressService.get_timeline` already returns.
    """
    n = len(timeline)
    if n < _MIN_SNAPSHOTS:
        return {
            "status": "insufficient_data",
            "reason": (
                f"Only {n} snapshot exists — a forecast needs at least "
                f"{_MIN_SNAPSHOTS} dated snapshots spanning {_MIN_SPAN_DAYS}+ days."
                if n == 1 else
                f"No snapshots exist yet — a forecast needs at least "
                f"{_MIN_SNAPSHOTS} dated snapshots spanning {_MIN_SPAN_DAYS}+ days."
            ),
        }

    first, last = timeline[0], timeline[-1]
    first_date, last_date = first.get("snapshotDate"), last.get("snapshotDate")
    if not first_date or not last_date:
        return {"status": "insufficient_data", "reason": "Snapshots are missing dates."}

    span_days = (last_date - first_date).days
    if span_days < _MIN_SPAN_DAYS:
        return {
            "status": "insufficient_data",
            "reason": (
                f"Snapshots span only {span_days} day(s) — need at least "
                f"{_MIN_SPAN_DAYS} days of history for a reliable trend."
            ),
        }

    full_velocity = _velocity(first, last)
    recent_velocity: Optional[float] = None
    if n >= 4:
        recent = timeline[-_RECENCY_WINDOW:]
        recent_span = (recent[-1]["snapshotDate"] - recent[0]["snapshotDate"]).days
        if recent_span > 0:
            recent_velocity = _velocity(recent[0], recent[-1])

    velocity = full_velocity
    used_recent = False
    if recent_velocity is not None and full_velocity != 0:
        divergence = abs(recent_velocity - full_velocity) / abs(full_velocity)
        if divergence > _RECENCY_DIVERGENCE_THRESHOLD:
            velocity = recent_velocity
            used_recent = True

    current_pct = last.get("overallProgressPct", 0.0)
    if velocity <= 0:
        return {
            "status": "stalled_or_regressing",
            "velocityPctPerDay": round(velocity, 3),
            "currentPct": current_pct,
        }

    days_to_complete = (100.0 - current_pct) / velocity
    projected_date = last_date + timedelta(days=days_to_complete)

    if recent_velocity is not None and full_velocity > 0:
        low_days = (100.0 - current_pct) / max(full_velocity, recent_velocity)
        high_days = (100.0 - current_pct) / max(min(full_velocity, recent_velocity), 1e-6)
    else:
        low_days = days_to_complete * (1 - _FALLBACK_RANGE_PCT)
        high_days = days_to_complete * (1 + _FALLBACK_RANGE_PCT)

    return {
        "status": "ok",
        "snapshotCount": n,
        "spanDays": span_days,
        "velocityPctPerDay": round(velocity, 3),
        "usedRecentVelocity": used_recent,
        "currentPct": current_pct,
        "daysToComplete": round(days_to_complete, 1),
        "projectedCompletionDate": projected_date,
        "rangeLowDate": last_date + timedelta(days=low_days),
        "rangeHighDate": last_date + timedelta(days=high_days),
        "confidence": _confidence_bucket(n, span_days),
    }


def _velocity(first: dict[str, Any], last: dict[str, Any]) -> float:
    span_days = (last["snapshotDate"] - first["snapshotDate"]).days
    if span_days <= 0:
        return 0.0
    return (last.get("overallProgressPct", 0.0) - first.get("overallProgressPct", 0.0)) / span_days
