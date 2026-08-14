"""Static assertions that Drishti's system prompt still contains its key
status-taxonomy guardrails. Cheap regression guard against a future prompt
edit accidentally dropping the "not_assessed != 0%" / "not_observable !=
incomplete" instructions that keep Drishti from misrepresenting the
underlying construction-progress data."""
from app.services.drishti_prompts import DRISHTI_ANSWER_PROMPT, DRISHTI_CLASSIFIER_PROMPT


def test_answer_prompt_never_equates_not_assessed_with_zero_percent():
    assert "not_assessed" in DRISHTI_ANSWER_PROMPT
    assert "0% complete" in DRISHTI_ANSWER_PROMPT
    assert "no photo coverage yet" in DRISHTI_ANSWER_PROMPT


def test_answer_prompt_never_equates_not_observable_with_incomplete():
    assert "not_observable" in DRISHTI_ANSWER_PROMPT
    assert "cannot be visually verified" in DRISHTI_ANSWER_PROMPT


def test_answer_prompt_distinguishes_coverage_from_progress():
    assert "coverage" in DRISHTI_ANSWER_PROMPT.lower()
    assert "different metric" in DRISHTI_ANSWER_PROMPT.lower()


def test_answer_prompt_states_painting_implies_putty_not_reverse():
    assert "putty" in DRISHTI_ANSWER_PROMPT.lower()
    assert "does not imply paint" in DRISHTI_ANSWER_PROMPT.lower()


def test_classifier_prompt_declares_fixed_intent_enum():
    for intent in (
        "project_overview", "tower_status", "floor_status", "flat_status",
        "room_status", "common_area_status", "activity_status",
        "activity_ranking", "flat_ranking", "common_area_ranking",
        "unfinished_work", "capture_gap", "management_summary",
        "forecast", "comparison", "quality_query", "general",
    ):
        assert intent in DRISHTI_CLASSIFIER_PROMPT


def test_classifier_prompt_distinguishes_common_area_from_flat_room():
    assert "commonAreaName" in DRISHTI_CLASSIFIER_PROMPT
    assert "NEVER flats or rooms" in DRISHTI_CLASSIFIER_PROMPT


def test_classifier_prompt_declares_ranking_hint_fields():
    assert "rankingTarget" in DRISHTI_CLASSIFIER_PROMPT
    assert "rankingDirection" in DRISHTI_CLASSIFIER_PROMPT


def test_answer_prompt_states_resolution_status_phrasing_rules():
    assert "not_configured" in DRISHTI_ANSWER_PROMPT
    assert "configured_no_evidence" in DRISHTI_ANSWER_PROMPT
    assert "not set up/configured" in DRISHTI_ANSWER_PROMPT


def test_answer_prompt_states_ranking_is_precomputed():
    lower = DRISHTI_ANSWER_PROMPT.lower()
    assert "already computed" in lower
    assert "never re-derive" in lower or "never re-derive, re-sort" in lower


def test_answer_prompt_covers_top_concerns_ordering():
    assert "topConcerns" in DRISHTI_ANSWER_PROMPT
    assert "severity-ranked" in DRISHTI_ANSWER_PROMPT.lower()


def test_answer_prompt_distinguishes_common_area_from_flat_in_rankings():
    assert "never call it" in DRISHTI_ANSWER_PROMPT.lower()
    assert "fold its numbers into a flat-ranking" in DRISHTI_ANSWER_PROMPT.lower()


def test_answer_prompt_separates_construction_risk_from_data_visibility_risk():
    lower = DRISHTI_ANSWER_PROMPT.lower()
    assert "construction risk" in lower
    assert "visibility risk" in lower


def test_answer_json_shape_includes_common_area_and_activity_scope_fields():
    assert "commonAreaName" in DRISHTI_ANSWER_PROMPT
    assert "activityName" in DRISHTI_ANSWER_PROMPT
