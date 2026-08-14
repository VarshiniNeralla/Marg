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
        "forecast", "comparison", "quality_query", "general",
    ):
        assert intent in DRISHTI_CLASSIFIER_PROMPT
