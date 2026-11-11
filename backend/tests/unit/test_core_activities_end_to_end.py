"""assess_floor_progress with a stubbed vision call: only the 14 core activities are reported."""
import asyncio
from datetime import datetime, timezone

from app.services.construction_progress_providers import CORE_ACTIVITIES
from app.services.construction_progress_providers.base import CaptureRef
from app.services.construction_progress_providers.vllm_provider import VllmConstructionProgressProvider


def _cap(cid, room):
    return CaptureRef(capture_id=cid, pin_id=cid, room_name=room, flat_name="Flat 1",
                      captured_at=None, image_url="x")


def _e(pct, conf=60.0):
    return {"completion_pct": pct, "confidence_pct": conf, "evidence": f"{pct}"}


def _run(per_capture):
    provider = VllmConstructionProgressProvider()
    asked: dict[str, list[str]] = {}

    async def fake(capture, activities, **_):
        asked[capture.capture_id] = [a.activity_id for a in activities]
        return per_capture[capture.capture_id]

    provider._assess_capture = fake  # type: ignore[method-assign]
    result = asyncio.run(provider.assess_floor_progress(
        floor_id="f", activities=CORE_ACTIVITIES,
        captures=[_cap("living", "Living Room"), _cap("toilet", "Toilet")],
        as_of=datetime.now(timezone.utc),
        flat_room_rosters={"Flat 1": ["Living Room", "Toilet"]},
    ))
    return result, asked


def test_reports_only_core_activities_and_asks_the_model_about_components():
    result, asked = _run({
        "living": {"flat.ceiling_punning_2": _e(100.0), "flat.wall_punning_4": _e(60.0),
                   "flat.vitrified_flooring_16": _e(100.0)},
        "toilet": {"flat.toilet_utility_balcony_flooring_14": _e(100.0)},
    })
    reported = {a.activity.activity_id for a in result.activities}
    assert reported == {a.activity_id for a in CORE_ACTIVITIES}
    # The model is asked ceiling + wall punning, never the merged id, never legacy-only items.
    assert "flat.core_punning" not in asked["living"]
    assert {"flat.ceiling_punning_2", "flat.wall_punning_4"} <= set(asked["living"])
    assert "flat.deep_cleaning_38" not in asked["living"]
    # Room scoping: no vitrified flooring in the toilet, no toilet flooring in the living room.
    assert "flat.vitrified_flooring_16" not in asked["toilet"]
    assert "flat.toilet_utility_balcony_flooring_14" not in asked["living"]


def test_merged_punning_is_the_mean_and_tiles_credit_the_screed():
    result, _ = _run({
        "living": {"flat.ceiling_punning_2": _e(100.0), "flat.wall_punning_4": _e(60.0),
                   "flat.vitrified_flooring_16": _e(100.0)},
        "toilet": {"flat.toilet_utility_balcony_flooring_14": _e(100.0)},
    })
    by_id = {a.activity.activity_id: a for a in result.activities}
    # Floor % averages over the roster (the toilet was not scored for punning => 0), as it always has.
    assert by_id["flat.core_punning"].completion_pct == 40.0
    living = next(r for fp in result.flat_progress for r in fp.rooms if r.room_name == "Living Room")
    assert next(a for a in living.activities if a.activity_id == "flat.core_punning").completion_pct == 80.0
    # Living room: vitrified laid => screed credited there; toilet: tiles => screed + waterproofing.
    assert by_id["flat.floor_screed_1"].completion_pct == 100.0
    assert by_id["flat.waterproofing_8"].completion_pct == 100.0
    # Room breakdown carries only core activity names.
    names = {a.activity_name for fp in result.flat_progress for r in fp.rooms for a in r.activities}
    assert names <= {a.name for a in CORE_ACTIVITIES}
    assert "Punning Works" in names
