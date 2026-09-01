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
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_service import ConstructionProgressService

_MIN_SNAPSHOTS = 2
_MIN_SPAN_DAYS = 3
_RECENCY_WINDOW = 3
_RECENCY_DIVERGENCE_THRESHOLD = 0.20
_FALLBACK_RANGE_PCT = 0.25

# Assumption-based estimate — used ONLY when the real velocity forecast
# comes back "insufficient_data" (no dated history to measure from). This
# is a clearly-labeled generic-assumption fallback, never a substitute for
# a measured forecast: a typical finishing-stage floor in this dataset
# progresses at roughly this rate once work is actively underway. The
# range brackets it +/-50% since there is, by definition, no real velocity
# signal to narrow it further.
_ASSUMED_PCT_PER_DAY = 1.0
_ASSUMED_RANGE_PCT = 0.5


def _oid_or_str(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else value


def _format_date_display(raw: Optional[str]) -> Optional[str]:
    """Pre-renders a stored "YYYY-MM-DD" date string into an unambiguous
    human-readable form (e.g. "May 12, 2028") in Python, rather than
    handing the LLM a raw ISO string and trusting it to read/reformat that
    string correctly in prose. Confirmed live: a small local classifier
    model handed the exact correct "endDate": "2028-05-12" and, asked to
    state it in an answer, hallucinated "October 15, 2024" instead — the
    payload was right, but reformatting an ISO date into prose is exactly
    the kind of small transformation this model has repeatedly proven
    unreliable at (see the activity/common-area/floor/flat resolution
    fixes earlier in this codebase's history for the same lesson). Doing
    the formatting here means the LLM only ever has to copy a ready-made
    string, never parse or recompute one. Returns None unchanged (never a
    formatted "None") if the stored value is missing or unparseable."""
    if not raw:
        return None
    try:
        parsed = datetime.strptime(raw[:10], "%Y-%m-%d")
    except ValueError:
        return None
    return parsed.strftime("%B %d, %Y").replace(" 0", " ")


class DrishtiForecastService:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        self._progress_service = ConstructionProgressService(db)

    async def get_planned_dates(self, org_id: str, project_id: str) -> Optional[dict[str, Any]]:
        """The project document is schema-less (`workflow.py` persists
        whatever the create-project form sends verbatim), so admin-entered
        `startDate`/`endDate` strings live there, not in any snapshot/progress
        collection the rest of this service reads from. A forecast must
        surface this planned end date even when there is no velocity history
        yet to measure against — that is the ONE case this module previously
        had no path to answer from at all, always falling through to
        insufficient_data/assumption-based guessing instead of the project's
        own stated plan."""
        doc = await self._db["projects"].find_one(
            {"orgId": org_id, "$or": [{"_id": _oid_or_str(project_id)}, {"id": project_id}]}
        )
        if not doc:
            return None
        end_date = doc.get("endDate") or None
        start_date = doc.get("startDate") or None
        if not end_date:
            return None
        return {
            "startDate": start_date,
            "endDate": end_date,
            # Pre-formatted, human-readable copies — the answer prompt tells
            # the model to quote these verbatim rather than reformat the raw
            # ISO strings above itself (see _format_date_display's docstring
            # for the real hallucination this closes).
            "startDateDisplay": _format_date_display(start_date),
            "endDateDisplay": _format_date_display(end_date),
        }

    async def forecast_floor(self, org_id: str, floor_id: str) -> dict[str, Any]:
        timeline = await self._progress_service.get_timeline(org_id, floor_id)
        forecast = compute_velocity_forecast(timeline)
        if forecast.get("status") == "insufficient_data":
            current_pct = timeline[-1].get("overallProgressPct") if timeline else None
            if current_pct is None:
                snapshot = await self._progress_service.get_latest_snapshot(org_id, floor_id)
                current_pct = snapshot.get("overallProgressPct") if snapshot else None
            estimate = compute_assumption_based_estimate(current_pct, as_of=timeline[-1]["snapshotDate"] if timeline else None)
            if estimate is not None:
                forecast["assumptionBasedEstimate"] = estimate
        return forecast

    async def forecast_project(self, org_id: str, project_id: str, floor_ids: list[str]) -> dict[str, Any]:
        """Rolls up every floor's own forecast to a project-level estimate.
        Reports both the critical-path floor (max projected date — a project
        isn't done until its slowest floor is) and a softer mean-of-floors
        estimate, so an answer can name the actual bottleneck rather than
        blend it away into one misleading number."""
        planned_dates = await self.get_planned_dates(org_id, project_id)

        if not floor_ids:
            result: dict[str, Any] = {"status": "insufficient_data", "reason": "This project has no floors yet."}
            if planned_dates:
                result["plannedDates"] = planned_dates
            return result

        forecasts = await asyncio.gather(
            *(self.forecast_floor(org_id, fid) for fid in floor_ids)
        )
        ok_forecasts = [
            (fid, f) for fid, f in zip(floor_ids, forecasts)
            if f.get("status") == "ok" and f.get("daysToComplete") is not None
        ]
        if not ok_forecasts:
            assumption_days = [
                f["assumptionBasedEstimate"]["daysToComplete"]
                for f in forecasts
                if f.get("assumptionBasedEstimate")
            ]
            result: dict[str, Any] = {
                "status": "insufficient_data",
                "reason": "No floor in this project has enough dated history yet for a forecast.",
            }
            if assumption_days:
                result["assumptionBasedEstimate"] = {
                    "basis": "assumption",
                    "daysToComplete": round(max(assumption_days), 1),
                    "floorsEstimated": len(assumption_days),
                    "floorsTotal": len(floor_ids),
                    "confidence": "low",
                    "disclaimer": (
                        "No historical progress data exists across this project's floors, so this "
                        "estimate uses the slowest floor's generic assumption-based estimate as the "
                        "project critical path. It is NOT based on this project's own measured "
                        "velocity and should not be treated as a committed schedule."
                    ),
                }
            if planned_dates:
                result["plannedDates"] = planned_dates
            return result

        critical_floor_id, critical_forecast = max(ok_forecasts, key=lambda pair: pair[1]["daysToComplete"])
        mean_days = sum(f["daysToComplete"] for _fid, f in ok_forecasts) / len(ok_forecasts)

        result = {
            "status": "ok",
            "criticalPathFloorId": critical_floor_id,
            "criticalPathForecast": critical_forecast,
            "meanDaysToComplete": round(mean_days, 1),
            "floorsWithForecast": len(ok_forecasts),
            "floorsTotal": len(floor_ids),
        }
        if planned_dates:
            result["plannedDates"] = planned_dates
        return result


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


def compute_assumption_based_estimate(
    current_pct: Optional[float], *, as_of: Optional[datetime] = None,
) -> Optional[dict[str, Any]]:
    """Pure function — a clearly-labeled, LAST-RESORT completion estimate
    for when `compute_velocity_forecast` has no dated history to measure a
    real velocity from. Never used when a real forecast succeeded, and
    never used for `stalled_or_regressing` (that IS a real, measured
    signal — a generic assumption should not paper over it).

    Returns None when there isn't even a current completion percentage to
    reason from (e.g. the floor has never been analyzed at all) — in that
    case the answer must say so explicitly rather than guessing a number
    out of nothing.
    """
    if current_pct is None:
        return None
    as_of = as_of or datetime.now(timezone.utc)
    remaining_pct = max(0.0, 100.0 - current_pct)
    days = remaining_pct / _ASSUMED_PCT_PER_DAY
    low_days = days * (1 - _ASSUMED_RANGE_PCT)
    high_days = days * (1 + _ASSUMED_RANGE_PCT)
    return {
        "basis": "assumption",
        "currentPct": current_pct,
        "assumedPctPerDay": _ASSUMED_PCT_PER_DAY,
        "daysToComplete": round(days, 1),
        "rangeLowDate": as_of + timedelta(days=low_days),
        "rangeHighDate": as_of + timedelta(days=high_days),
        "confidence": "low",
        "disclaimer": (
            "No historical progress data exists for this scope, so this estimate assumes a "
            f"generic finishing pace of {_ASSUMED_PCT_PER_DAY}% per working day from the "
            "current completion percentage. It is NOT based on this project's own measured "
            "velocity and should not be treated as a committed schedule."
        ),
    }


def _velocity(first: dict[str, Any], last: dict[str, Any]) -> float:
    span_days = (last["snapshotDate"] - first["snapshotDate"]).days
    if span_days <= 0:
        return 0.0
    return (last.get("overallProgressPct", 0.0) - first.get("overallProgressPct", 0.0)) / span_days
