"""Unit tests for Tour Compare → Analyze normalization (not floor Construction Progress)."""

from __future__ import annotations

from app.services.ai_progress_service import _normalize_analysis
from app.services.vision_providers.compare_progress_prompt import (
    COMPARE_ANALYSIS_PROMPT_VERSION,
    COMPARE_PROGRESS_SYSTEM_PROMPT,
    build_compare_user_context,
)
from app.services.vision_providers.groq_provider import _SYSTEM_PROMPT as GROQ_SYSTEM
from app.services.vision_providers.vllm_provider import _SYSTEM_PROMPT as VLLM_SYSTEM


def test_shared_prompt_is_identical_for_providers():
    assert GROQ_SYSTEM is COMPARE_PROGRESS_SYSTEM_PROMPT or GROQ_SYSTEM == COMPARE_PROGRESS_SYSTEM_PROMPT
    assert VLLM_SYSTEM is COMPARE_PROGRESS_SYSTEM_PROMPT or VLLM_SYSTEM == COMPARE_PROGRESS_SYSTEM_PROMPT
    assert "VISIBLE CONSTRUCTION PROGRESS BETWEEN BEFORE AND AFTER" in COMPARE_PROGRESS_SYSTEM_PROMPT
    assert "Flat Finishing" in COMPARE_PROGRESS_SYSTEM_PROMPT  # explicitly forbidden wording
    assert COMPARE_ANALYSIS_PROMPT_VERSION.startswith("compare-")


def test_user_context_is_factual_only():
    text = build_compare_user_context(
        {
            "project_name": "Project A",
            "tower": "1",
            "floor": "Floor 2",
            "pin_name": "Flat 02 · Toilet-2",
            "capture_type": "360",
            "before_date": "1 Aug 2026",
            "after_date": "12 Aug 2026",
        }
    )
    assert "Toilet-2" in text
    assert "Image 1 is the BEFORE" in text
    assert "do not invent" in text.lower()


def test_normalize_no_meaningful_change():
    out = _normalize_analysis(
        {
            "summary": "No meaningful construction change detected.",
            "comparison": {
                "sameLocation": True,
                "viewConsistency": "good",
                "visibility": "good",
                "comparisonConfidence": 88,
            },
            "progress": {"percentage": 5, "description": "No meaningful construction progress."},
            "changes": [],
            "completedWork": [],
            "newlyAdded": [],
            "removedItems": [],
            "pendingWork": ["Unable to determine remaining work from the available views."],
            "qualityObservations": [],
            "risks": [],
            "recommendedNextSteps": [],
            "confidence": 80,
        }
    )
    assert out["progress"]["percentage"] == 5
    assert out["overallProgress"]["percentage"] == 5
    assert out["changes"] == []
    assert out["changesDetected"] == []
    assert out["comparison"]["viewConsistency"] == "good"
    assert out["risks"] == []


def test_normalize_painting_progress_structured():
    out = _normalize_analysis(
        {
            "summary": "Wall finishing progressed from plastered to painted.",
            "progress": {"percentage": 42, "description": "Moderate visible paint progress."},
            "changes": [
                {
                    "category": "Painting",
                    "area": "Walls",
                    "changeType": "completed",
                    "beforeState": "Wall surface appears unfinished/plastered.",
                    "afterState": "Wall surface shows finished paint.",
                    "impact": "High",
                    "confidence": 96,
                }
            ],
            "completedWork": ["Visible wall paint finished in the compared view."],
            "newlyAdded": [],
            "removedItems": [],
            "pendingWork": [],
            "qualityObservations": [],
            "risks": [],
            "recommendedNextSteps": ["Inspect remaining walls outside this view."],
            "confidence": 90,
        }
    )
    assert out["progress"]["percentage"] == 42
    assert len(out["changes"]) == 1
    assert out["changes"][0]["changeType"] == "completed"
    assert out["changes"][0]["confidence"] == 96
    assert out["changesDetected"][0]["importance"] == "High"
    assert "plastered" in out["changesDetected"][0]["change"].lower()


def test_normalize_partial_and_electrical():
    out = _normalize_analysis(
        {
            "progress": {"percentage": 28, "description": "Minor to moderate visible changes."},
            "changes": [
                {
                    "category": "Painting",
                    "area": "Ceiling",
                    "changeType": "partially_completed",
                    "beforeState": "Bare concrete ceiling.",
                    "afterState": "Partial primer visible on ceiling.",
                    "impact": "Medium",
                    "confidence": 70,
                },
                {
                    "category": "Electrical",
                    "area": "Wall switch box",
                    "changeType": "installed",
                    "beforeState": "Open conduit stub.",
                    "afterState": "Switch box installed.",
                    "impact": "High",
                    "confidence": 92,
                },
            ],
            "confidence": 75,
        }
    )
    types = {c["changeType"] for c in out["changes"]}
    assert "partially_completed" in types
    assert "installed" in types
    assert len(out["changesDetected"]) == 2


def test_normalize_debris_removal_and_quality():
    out = _normalize_analysis(
        {
            "progress": {"percentage": 18, "description": "Minor visible site cleanup."},
            "changes": [
                {
                    "category": "Materials / Debris",
                    "area": "Floor",
                    "changeType": "removed",
                    "beforeState": "Construction debris on floor.",
                    "afterState": "Floor largely clear of debris.",
                    "impact": "Medium",
                    "confidence": 85,
                }
            ],
            "removedItems": ["Construction debris cleared from floor."],
            "qualityObservations": ["Uneven paint patch on far wall."],
            "risks": [],
            "confidence": 70,
        }
    )
    assert out["removedItems"]
    assert out["qualityObservations"]
    assert out["risks"] == []


def test_normalize_poor_comparison():
    out = _normalize_analysis(
        {
            "summary": "Progress cannot be reliably determined from the available views.",
            "comparison": {
                "sameLocation": False,
                "viewConsistency": "poor",
                "visibility": "poor",
                "comparisonConfidence": 20,
            },
            "progress": {"percentage": 0, "description": "Comparison unreliable due to viewpoint differences."},
            "changes": [],
            "confidence": 25,
        }
    )
    assert out["comparison"]["sameLocation"] is False
    assert out["comparison"]["viewConsistency"] == "poor"
    assert out["progress"]["percentage"] == 0


def test_normalize_malformed_and_clamping():
    out = _normalize_analysis(
        {
            "progress": {"percentage": 150, "description": "x"},
            "confidence": -5,
            "comparison": {"viewConsistency": "excellent", "visibility": "ok", "comparisonConfidence": 999},
            "changes": "not-a-list",
            "changesDetected": [
                {"category": "Painting", "change": "Paint progressed", "importance": "Urgent"},
            ],
            "completedWork": [{"observation": "Walls painted"}],
            "risks": [None, "", {"risk": "Open edge without barricade"}],
        }
    )
    assert out["progress"]["percentage"] == 100
    assert out["confidence"] == 0
    assert out["comparison"]["viewConsistency"] == "fair"
    assert out["comparison"]["comparisonConfidence"] == 100
    assert out["changes"][0]["impact"] == "Medium"  # invalid importance → Medium
    assert out["completedWork"] == ["Walls painted"]
    assert out["risks"] == ["Open edge without barricade"]


def test_normalize_legacy_overall_progress_still_works():
    out = _normalize_analysis(
        {
            "summary": "Legacy report",
            "overallProgress": {"percentage": 55, "description": "Significant progress"},
            "changesDetected": [
                {"category": "Flooring", "change": "Tiles installed", "importance": "High"},
            ],
            "confidence": 80,
        }
    )
    assert out["progress"]["percentage"] == 55
    assert out["overallProgress"]["percentage"] == 55
    assert out["changes"][0]["category"] == "Flooring"
    assert out["changesDetected"][0]["change"]


def test_normalize_common_area_and_toilet_context_strings_survive():
    out = _normalize_analysis(
        {
            "summary": "Lift lobby tiling progressed; toilet fixtures installed.",
            "progress": {"percentage": 48, "description": "Moderate progress in lobby and toilet views."},
            "changes": [
                {
                    "category": "Tiling",
                    "area": "Lift lobby floor",
                    "changeType": "partially_completed",
                    "beforeState": "Bare screed.",
                    "afterState": "Tile installation underway.",
                    "impact": "High",
                    "confidence": 80,
                },
                {
                    "category": "Sanitary / CP Fixtures",
                    "area": "Toilet wash basin",
                    "changeType": "installed",
                    "beforeState": "No basin.",
                    "afterState": "Basin installed.",
                    "impact": "High",
                    "confidence": 90,
                },
            ],
            "confidence": 82,
        }
    )
    cats = {c["category"] for c in out["changes"]}
    assert "Tiling" in cats
    assert "Sanitary / CP Fixtures" in cats


def test_normalize_none_and_empty_raw():
    assert _normalize_analysis(None)["progress"]["percentage"] == 0
    assert _normalize_analysis({})["changes"] == []
