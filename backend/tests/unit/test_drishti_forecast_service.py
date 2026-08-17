"""Unit tests for `compute_velocity_forecast` — the pure velocity-based
completion estimator. No db access; timelines are handcrafted dicts matching
`ConstructionProgressService.get_timeline`'s output shape."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.drishti_forecast_service import compute_assumption_based_estimate, compute_velocity_forecast


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
