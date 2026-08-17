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


def test_answer_prompt_requires_naming_actual_captured_rooms():
    lowered = DRISHTI_ANSWER_PROMPT.lower()
    assert "capturedrooms" in lowered
    assert "capturegaps" in lowered
    assert "does not list the specific rooms" in lowered


def test_classifier_prompt_routes_positive_coverage_phrasing_to_capture_gap():
    lowered = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "which rooms/flats have been captured/photographed" in lowered
    assert "phrased positively" in lowered


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


def test_answer_prompt_bans_assistant_style_followup_phrasing():
    assert "followUpQuestions" in DRISHTI_ANSWER_PROMPT
    assert "Would you like to" in DRISHTI_ANSWER_PROMPT
    assert "direct question a" in DRISHTI_ANSWER_PROMPT.lower()


def test_answer_json_shape_includes_common_area_and_activity_scope_fields():
    assert "commonAreaName" in DRISHTI_ANSWER_PROMPT
    assert "activityName" in DRISHTI_ANSWER_PROMPT


def test_classifier_prompt_allows_activity_status_without_floor_scope():
    assert "does NOT require a" in DRISHTI_CLASSIFIER_PROMPT
    assert "activity_status" in DRISHTI_CLASSIFIER_PROMPT


def test_answer_prompt_forbids_dismissing_activity_questions_as_unavailable():
    lower = DRISHTI_ANSWER_PROMPT.lower()
    assert "activity questions" in lower
    assert "never say the data is unavailable" in lower


def test_answer_prompt_allows_labeled_assumption_based_estimate():
    assert "assumptionBasedEstimate" in DRISHTI_ANSWER_PROMPT
    assert "not a measured forecast" in DRISHTI_ANSWER_PROMPT
    assert "disclaimer" in DRISHTI_ANSWER_PROMPT.lower()


def test_answer_prompt_never_labels_assumption_estimate_as_measured_forecast():
    assert 'never call it a "projected completion date"' in DRISHTI_ANSWER_PROMPT.lower()


def test_classifier_prompt_declares_activity_list_intent_and_statuses():
    assert "activity_list" in DRISHTI_CLASSIFIER_PROMPT
    assert "activityListStatuses" in DRISHTI_CLASSIFIER_PROMPT
    for status in ("in_progress", "completed", "not_assessed", "not_observable", "no_evidence"):
        assert status in DRISHTI_CLASSIFIER_PROMPT


def test_classifier_prompt_infers_status_from_conversation_history_on_followup():
    lower = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "what are those n activities" in lower or "what are those" in lower
    assert "reread the assistant" in lower or "prior status" in lower


def test_answer_prompt_forbids_saying_activity_list_not_specified():
    assert "activityList.items" in DRISHTI_ANSWER_PROMPT
    assert "are not listed in the current payload" in DRISHTI_ANSWER_PROMPT


def test_answer_prompt_specifies_supported_markdown_subset():
    assert "**bold**" in DRISHTI_ANSWER_PROMPT
    assert '"## "' in DRISHTI_ANSWER_PROMPT
    assert '"- "' in DRISHTI_ANSWER_PROMPT
    assert "no links, tables, code blocks" in DRISHTI_ANSWER_PROMPT


def test_classifier_prompt_declares_location_activities_and_common_area_activity_status():
    assert "location_activities" in DRISHTI_CLASSIFIER_PROMPT
    assert "common_area_activity_status" in DRISHTI_CLASSIFIER_PROMPT


def test_classifier_prompt_distinguishes_location_activities_from_activity_status():
    lower = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "what other activities are pending in the lift lobby" in lower
    assert "do not carry over" in lower or "not carry over" in lower


def test_classifier_prompt_common_area_activity_status_means_all_units():
    lower = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "every common-area unit" in lower or "all common areas" in lower
    assert "leave \"commonareaname\" null" in lower or 'leave "commonareaname" null' in DRISHTI_CLASSIFIER_PROMPT.lower()


def test_answer_prompt_covers_location_activities_rendering():
    assert "locationActivities" in DRISHTI_ANSWER_PROMPT
    assert "not just the one activity discussed earlier" in DRISHTI_ANSWER_PROMPT


def test_answer_prompt_covers_common_area_activity_aggregation():
    assert "commonAreaActivity" in DRISHTI_ANSWER_PROMPT
    assert "uncapturedUnits" in DRISHTI_ANSWER_PROMPT
    lower = DRISHTI_ANSWER_PROMPT.lower()
    assert "never treat \"common areas\" as if it were one single location" in lower


def test_classifier_prompt_defines_activity_list_default_scope():
    lower = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "whole project" in lower
    assert "in the flats" in lower


def test_classifier_prompt_states_followup_scope_override_not_addition():
    lower = DRISHTI_CLASSIFIER_PROMPT.lower()
    assert "replaces" in lower or "overrides" in lower
    assert "does not mean" in lower or "it does not mean" in lower
