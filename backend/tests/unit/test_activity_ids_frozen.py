"""T6 — activity IDs are frozen literals, not regenerated from enumerate(slug)."""
from __future__ import annotations

from app.services.construction_progress_providers.activities import (
    ALL_ACTIVITIES,
    FROZEN_ALL_IDS,
    FROZEN_COMMON_IDS,
    FROZEN_FLAT_IDS,
    ActivityDef,
    _build,
    activities_as_dicts,
)


def test_all_activities_count_is_49():
    assert len(ALL_ACTIVITIES) == 49
    assert len(FROZEN_FLAT_IDS) == 39
    assert len(FROZEN_COMMON_IDS) == 10
    assert len(FROZEN_ALL_IDS) == 49


def test_activity_id_set_matches_frozen_all_ids():
    assert {a.activity_id for a in ALL_ACTIVITIES} == FROZEN_ALL_IDS


def test_ids_come_from_frozen_tuples_not_enumerate_slug():
    """IDs are zip'd from FROZEN_* literals — appending must not renumber existing ones."""
    flat = [a for a in ALL_ACTIVITIES if a.section == "flat"]
    common = [a for a in ALL_ACTIVITIES if a.section == "common"]
    assert tuple(a.activity_id for a in flat) == FROZEN_FLAT_IDS
    assert tuple(a.activity_id for a in common) == FROZEN_COMMON_IDS

    # Historic suffixes stay tied to the frozen table, not list length / position drift.
    assert FROZEN_FLAT_IDS[25] == "flat.putty_1st_coat_25"
    assert FROZEN_FLAT_IDS[37] == "flat.final_coat_paint_37"
    assert FROZEN_COMMON_IDS[9] == "common.painting_2nd_coat_9"

    # Simulate appending a new activity: existing frozen IDs are unchanged.
    extended_ids = FROZEN_FLAT_IDS + ("flat.new_activity_99",)
    extended_names = [a.name for a in flat] + ["New Activity"]
    rebuilt = _build("flat", extended_names, extended_ids)
    assert [a.activity_id for a in rebuilt[:-1]] == list(FROZEN_FLAT_IDS)
    assert rebuilt[-1].activity_id == "flat.new_activity_99"
    assert isinstance(rebuilt[-1], ActivityDef)


def test_activities_as_dicts_keeps_core_keys():
    rows = activities_as_dicts()
    assert len(rows) == 49
    for row in rows:
        assert "activityId" in row
        assert "name" in row
        assert "section" in row
        assert "sequenceIndex" in row
