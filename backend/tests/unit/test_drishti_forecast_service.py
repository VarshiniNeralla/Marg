"""Unit tests for `compute_velocity_forecast` — the pure velocity-based
completion estimator. No db access; timelines are handcrafted dicts matching
`ConstructionProgressService.get_timeline`'s output shape."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.drishti_forecast_service import (
    DrishtiForecastService,
    compute_assumption_based_estimate,
    compute_velocity_forecast,
)


def _dt(days_from_epoch: int) -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=days_from_epoch)


def _point(day: int, pct: float) -> dict:
    return {"snapshotId": f"s{day}", "snapshotDate": _dt(day), "overallProgressPct": pct}


class TestInsufficientData:
    def test_zero_snapshots(self):
        result = compute_velocity_forecast([])
        assert result["status"] == "insufficient_data"

    def test_one_snapshot(self):
        result = compute_velocity_forecast([_point(0, 10.0)])
        assert result["status"] == "insufficient_data"
        assert "1 snapshot" in result["reason"]

    def test_two_snapshots_under_span_threshold(self):
        result = compute_velocity_forecast([_point(0, 10.0), _point(2, 15.0)])
        assert result["status"] == "insufficient_data"
        assert "2 day" in result["reason"]


class TestStalledOrRegressing:
    def test_flat_progress(self):
        result = compute_velocity_forecast([_point(0, 40.0), _point(10, 40.0)])
        assert result["status"] == "stalled_or_regressing"
        assert result["velocityPctPerDay"] == 0.0

    def test_regressing_progress(self):
        result = compute_velocity_forecast([_point(0, 60.0), _point(10, 50.0)])
        assert result["status"] == "stalled_or_regressing"
        assert result["velocityPctPerDay"] < 0


class TestNormalProjection:
    def test_linear_five_point_series(self):
        timeline = [
            _point(0, 20.0), _point(10, 30.0), _point(20, 40.0),
            _point(30, 50.0), _point(40, 60.0),
        ]
        result = compute_velocity_forecast(timeline)
        assert result["status"] == "ok"
        assert result["velocityPctPerDay"] == 1.0
        assert result["currentPct"] == 60.0
        assert result["daysToComplete"] == 40.0
        assert result["projectedCompletionDate"] == _dt(40) + timedelta(days=40)
        # n=5, span=40 -> medium bucket (4<=n<8, span>=14)
        assert result["confidence"] == "medium"

    def test_two_point_series_uses_fallback_range(self):
        timeline = [_point(0, 10.0), _point(10, 20.0)]
        result = compute_velocity_forecast(timeline)
        assert result["status"] == "ok"
        assert result["velocityPctPerDay"] == 1.0
        assert result["daysToComplete"] == 80.0
        # fallback +/-25% band
        assert result["rangeLowDate"] < result["projectedCompletionDate"] < result["rangeHighDate"]


class TestRecencyWeighting:
    def test_recent_acceleration_overrides_full_history(self):
        # Full history velocity: (70-10)/60 = 1.0 %/day.
        # Last-3 velocity: (70-40)/(60-40) = 1.5 %/day -> diverges >20% from 1.0.
        timeline = [
            _point(0, 10.0), _point(20, 25.0), _point(40, 40.0),
            _point(50, 55.0), _point(60, 70.0),
        ]
        result = compute_velocity_forecast(timeline)
        assert result["usedRecentVelocity"] is True
        assert result["velocityPctPerDay"] == 1.5

    def test_similar_recent_velocity_keeps_full_history(self):
        # Full history and recent velocity are identical (perfectly linear) ->
        # no divergence -> full-history velocity is kept.
        timeline = [
            _point(0, 0.0), _point(10, 10.0), _point(20, 20.0),
            _point(30, 30.0), _point(40, 40.0),
        ]
        result = compute_velocity_forecast(timeline)
        assert result["usedRecentVelocity"] is False
        assert result["velocityPctPerDay"] == 1.0


class TestConfidenceBucketBoundaries:
    def _series(self, n: int, span: int) -> list[dict]:
        step = span / (n - 1)
        return [_point(round(i * step), 10.0 + i) for i in range(n)]

    def test_low_below_snapshot_floor(self):
        result = compute_velocity_forecast(self._series(3, 20))
        assert result["confidence"] == "low"

    def test_low_below_span_floor(self):
        result = compute_velocity_forecast(self._series(5, 13))
        assert result["confidence"] == "low"

    def test_medium_at_exact_boundaries(self):
        result = compute_velocity_forecast(self._series(4, 14))
        assert result["confidence"] == "medium"

    def test_medium_below_high_snapshot_floor(self):
        result = compute_velocity_forecast(self._series(7, 30))
        assert result["confidence"] == "medium"

    def test_medium_below_high_span_floor(self):
        result = compute_velocity_forecast(self._series(8, 29))
        assert result["confidence"] == "medium"

    def test_high_at_exact_boundaries(self):
        result = compute_velocity_forecast(self._series(8, 30))
        assert result["confidence"] == "high"


class TestAssumptionBasedEstimate:
    """The clearly-labeled last-resort estimate used only when a real
    velocity forecast has no dated history to measure from — never a
    substitute for a measured forecast, always explicitly disclaimed."""

    def test_none_when_no_current_pct_available(self):
        assert compute_assumption_based_estimate(None) is None

    def test_produces_labeled_estimate_from_current_pct(self):
        estimate = compute_assumption_based_estimate(60.0, as_of=_dt(0))
        assert estimate["basis"] == "assumption"
        assert estimate["confidence"] == "low"
        assert estimate["currentPct"] == 60.0
        assert estimate["daysToComplete"] > 0
        assert "disclaimer" in estimate
        assert "not" in estimate["disclaimer"].lower()

    def test_range_brackets_the_point_estimate(self):
        estimate = compute_assumption_based_estimate(50.0, as_of=_dt(0))
        assert estimate["rangeLowDate"] < estimate["rangeHighDate"]

    def test_full_completion_yields_zero_days(self):
        estimate = compute_assumption_based_estimate(100.0, as_of=_dt(0))
        assert estimate["daysToComplete"] == 0.0

    def test_defaults_as_of_to_now_when_not_given(self):
        # Must not raise even without an explicit as_of reference date.
        estimate = compute_assumption_based_estimate(40.0)
        assert estimate is not None


def _fake_db_with_project(project_doc):
    """Project documents are schema-less (`workflow.py` persists whatever
    the create-project form sends verbatim) — this fakes just the one
    `db["projects"].find_one(...)` call `get_planned_dates` needs."""
    collection = MagicMock()
    collection.find_one = AsyncMock(return_value=project_doc)
    db = MagicMock()
    db.__getitem__ = MagicMock(return_value=collection)
    return db


class TestGetPlannedDates:
    """A real production bug: a project created with admin-entered
    startDate/endDate (NewProjectPage.tsx) still returned "no forecast data
    available" for "When is Project A projected to finish?" because no
    forecast code path ever looked at the project's own configured dates —
    only at snapshot-derived velocity or a generic assumption. This is the
    fetch that closes that gap."""

    @pytest.mark.asyncio
    async def test_returns_start_and_end_date_when_present(self):
        db = _fake_db_with_project({"orgId": "org1", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        service = DrishtiForecastService(db)
        result = await service.get_planned_dates("org1", "p1")
        assert result == {
            "startDate": "2026-01-01", "endDate": "2026-12-31",
            "startDateDisplay": "January 1, 2026", "endDateDisplay": "December 31, 2026",
        }

    @pytest.mark.asyncio
    async def test_none_when_project_not_found(self):
        db = _fake_db_with_project(None)
        service = DrishtiForecastService(db)
        assert await service.get_planned_dates("org1", "missing") is None

    @pytest.mark.asyncio
    async def test_none_when_end_date_missing(self):
        db = _fake_db_with_project({"orgId": "org1", "startDate": "2026-01-01"})
        service = DrishtiForecastService(db)
        assert await service.get_planned_dates("org1", "p1") is None

    @pytest.mark.asyncio
    async def test_end_date_present_without_start_date(self):
        db = _fake_db_with_project({"orgId": "org1", "endDate": "2026-12-31"})
        service = DrishtiForecastService(db)
        result = await service.get_planned_dates("org1", "p1")
        assert result == {
            "startDate": None, "endDate": "2026-12-31",
            "startDateDisplay": None, "endDateDisplay": "December 31, 2026",
        }


class TestFormatDateDisplay:
    """Regression coverage for a real production bug: the backend correctly
    stored and retrieved endDate "2028-05-12" (confirmed by directly
    querying the live database), yet Drishti's answer stated "October 15,
    2024" — the small local LLM was handed the exact correct raw ISO string
    and hallucinated a completely different date while trying to reformat
    it into prose. Doing the formatting here in Python means the LLM only
    ever has to copy a ready-made string, never parse/reformat one itself."""

    def test_formats_iso_date_to_readable_string(self):
        from app.services.drishti_forecast_service import _format_date_display
        assert _format_date_display("2028-05-12") == "May 12, 2028"
        assert _format_date_display("2026-01-01") == "January 1, 2026"

    def test_none_for_missing_or_empty(self):
        from app.services.drishti_forecast_service import _format_date_display
        assert _format_date_display(None) is None
        assert _format_date_display("") is None

    def test_none_for_unparseable_string(self):
        from app.services.drishti_forecast_service import _format_date_display
        assert _format_date_display("not a date") is None


class TestForecastProjectSurfacesPlannedDates:
    """The exact regression from the live bug report: a project with no
    floors yet (or no floor with enough velocity history) must still answer
    "when will it finish" from its own planned end date, never fall through
    to a bare "insufficient_data" with no plannedDates attached at all."""

    @pytest.mark.asyncio
    async def test_no_floors_still_surfaces_planned_dates(self):
        db = _fake_db_with_project({"orgId": "org1", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        service = DrishtiForecastService(db)
        result = await service.forecast_project("org1", "p1", [])
        assert result["status"] == "insufficient_data"
        assert result["plannedDates"]["startDate"] == "2026-01-01"
        assert result["plannedDates"]["endDate"] == "2026-12-31"
        assert result["plannedDates"]["endDateDisplay"] == "December 31, 2026"

    @pytest.mark.asyncio
    async def test_no_floors_and_no_planned_dates_omits_key(self):
        db = _fake_db_with_project(None)
        service = DrishtiForecastService(db)
        result = await service.forecast_project("org1", "p1", [])
        assert result["status"] == "insufficient_data"
        assert "plannedDates" not in result

    @pytest.mark.asyncio
    async def test_insufficient_velocity_data_still_surfaces_planned_dates(self, monkeypatch):
        db = _fake_db_with_project({"orgId": "org1", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        service = DrishtiForecastService(db)
        monkeypatch.setattr(
            service, "forecast_floor",
            AsyncMock(return_value={"status": "insufficient_data", "reason": "no history"}),
        )
        result = await service.forecast_project("org1", "p1", ["f1", "f2"])
        assert result["status"] == "insufficient_data"
        assert result["plannedDates"]["startDate"] == "2026-01-01"
        assert result["plannedDates"]["endDate"] == "2026-12-31"
        assert result["plannedDates"]["endDateDisplay"] == "December 31, 2026"

    @pytest.mark.asyncio
    async def test_ok_forecast_also_carries_planned_dates(self, monkeypatch):
        db = _fake_db_with_project({"orgId": "org1", "startDate": "2026-01-01", "endDate": "2026-12-31"})
        service = DrishtiForecastService(db)
        ok_forecast = {"status": "ok", "daysToComplete": 30.0}
        monkeypatch.setattr(service, "forecast_floor", AsyncMock(return_value=ok_forecast))
        result = await service.forecast_project("org1", "p1", ["f1"])
        assert result["status"] == "ok"
        assert result["plannedDates"]["startDate"] == "2026-01-01"
        assert result["plannedDates"]["endDate"] == "2026-12-31"
        assert result["plannedDates"]["endDateDisplay"] == "December 31, 2026"
