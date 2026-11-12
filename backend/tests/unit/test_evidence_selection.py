"""Evidence must be the captures that visibly support the finding - never an unrelated or contradicting photo."""
from datetime import datetime, timedelta

from app.services.construction_progress_providers.evidence_selection import (
    MAX_EVIDENCE,
    Observation,
    resolve_observations,
)


def obs(cid, pct, conf=90.0, days_ago=0, **kw):
    return Observation(
        capture_id=cid, pct=pct, conf=conf, evidence=f"saw {pct}",
        captured_at=datetime(2026, 11, 10) - timedelta(days=days_ago), **kw,
    )


def test_unable_to_determine_stays_unknown_and_has_no_evidence_images():
    r = resolve_observations([obs("c1", None, 60.0), obs("c2", None, 60.0)])
    assert r["pct"] is None and r["status"] == "unable_to_determine"
    assert r["evidence_ids"] == []
    assert r["review_required"] is True


def test_low_confidence_readings_cannot_set_a_value():
    r = resolve_observations([obs("c1", 90.0, conf=10.0), obs("c2", None, 60.0)])
    assert r["pct"] is None


def test_value_is_the_lowest_reliable_reading_and_evidence_is_supporting_captures_only():
    r = resolve_observations([obs("low", 40.0, 60.0), obs("high", 80.0, 90.0), obs("blur", 100.0, 30.0)])
    assert r["pct"] == 40.0
    assert "blur" not in r["evidence_ids"]               # unreliable photo is never evidence
    assert r["evidence_ids"][0] == "high"                # clearest first (higher confidence)
    assert set(r["evidence_ids"]) == {"high", "low"}


def test_zero_percent_has_no_evidence_images():
    r = resolve_observations([obs("c1", 0.0), obs("c2", 0.0)])
    assert r["pct"] == 0.0
    assert r["evidence_ids"] == []
    assert r["status"] == "not_started"


def test_duplicates_removed_and_capped():
    many = [obs(f"c{i}", 50.0 + i, 90.0 - i) for i in range(6)] + [obs("c0", 51.0, 70.0)]
    r = resolve_observations(many)
    assert len(r["evidence_ids"]) == MAX_EVIDENCE
    assert len(set(r["evidence_ids"])) == len(r["evidence_ids"])


def test_newer_incomplete_capture_beats_an_older_complete_one():
    r = resolve_observations([obs("old", 100.0, days_ago=30), obs("new", 40.0, days_ago=0)])
    assert r["pct"] == 40.0
    assert r["evidence_ids"] == ["new"]
    assert "old" in r["historical_capture_ids"]


def test_older_capture_is_still_used_when_it_is_the_only_reliable_one():
    r = resolve_observations([obs("old", 70.0, days_ago=30), obs("new", None, 60.0, days_ago=0)])
    assert r["pct"] == 70.0 and r["evidence_ids"] == ["old"]


def test_conflicting_current_captures_are_flagged_for_review():
    r = resolve_observations([obs("a", 10.0), obs("b", 90.0)])
    assert r["pct"] == 10.0
    assert r["review_required"] is True and "disagree" in r["review_reason"]


def test_agreeing_captures_are_not_flagged():
    r = resolve_observations([obs("a", 60.0), obs("b", 70.0)])
    assert r["review_required"] is False


def test_indicators_and_views_come_from_the_supporting_capture():
    r = resolve_observations([
        obs("a", 60.0, indicators_found=("grey plaster",), views=("walls_north",), explanation="Wall plaster on two walls."),
    ])
    assert r["indicators_found"] == ["grey plaster"]
    assert r["views"] == ["walls_north"]
    assert r["explanation"].startswith("Wall plaster")
    assert r["detection"] == "direct"
