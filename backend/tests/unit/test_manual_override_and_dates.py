"""Manager overrides stay separate from the AI estimate and survive re-analysis; dates are unambiguous UTC."""
import asyncio
from datetime import datetime, timezone

from mongomock_motor import AsyncMongoMockClient

from app.services.construction_progress_service import (
    _serialize_snapshot,
    finishing_summaries,
    iso_utc,
    iso_utc_walk,
    recompute_flat_finishing_pcts,
)
from app.services.review_correction_applier import ReviewCorrectionApplier

ORG, FLOOR = "org1", "floor1"


def snapshot(ai_pct, sid="s1", when=datetime(2026, 11, 12, 6, 23)):
    return {
        "_id": sid, "orgId": ORG, "floorId": FLOOR, "snapshotDate": when,
        "flatProgress": [{
            "flatName": "Flat 01", "roomsRequired": 1,
            "rooms": [{
                "roomName": "Living", "capturesCount": 1, "pinNumbers": [1],
                "activities": [{
                    "activityId": "flat.putty_1st_coat_25", "activityName": "1st Coat Putty",
                    "completionPct": ai_pct, "confidencePct": 80.0, "status": "in_progress",
                    "assessmentStatus": "in_progress", "detectionType": "direct",
                    "reviewRequired": True, "reviewReason": "unclear", "evidenceCaptureIds": ["c1"],
                }],
            }],
        }],
    }


def correction(pct, note="walked the flat"):
    return [{"activityId": "flat.putty_1st_coat_25", "correctPercentage": pct, "verdict": "wrong", "note": note}]


def apply(db, snap_id, pct, by="Asha", note="walked the flat"):
    return asyncio.run(ReviewCorrectionApplier(db).apply_activity_corrections(
        org_id=ORG, floor_id=FLOOR, flat_name="Flat 01", room_name="Living", snapshot_id=snap_id,
        corrections=correction(pct, note), reviewed_by=by, reviewed_at=datetime(2026, 11, 12, 7, 0),
    ))


def live_act(db):
    snap = asyncio.run(db["construction_progress_snapshots"].find_one({"_id": "s1"}))
    return snap["flatProgress"][0]["rooms"][0]["activities"][0]


def test_override_keeps_the_ai_value_and_records_who_when_and_why():
    db = AsyncMongoMockClient()["t1"]
    asyncio.run(db["construction_progress_snapshots"].insert_one(snapshot(20.0)))
    assert apply(db, "s1", 100.0)["updatedCount"] == 1
    a = live_act(db)
    assert a["aiCompletionPct"] == 20.0                      # the AI estimate is still there
    assert a["completionPct"] == 100.0                       # the effective value is the manager's
    assert a["detectionType"] == "manual" and a["assessmentStatus"] == "completed"
    assert a["override"]["by"] == "Asha" and a["override"]["reason"] == "walked the flat"
    assert a["override"]["at"] == datetime(2026, 11, 12, 7, 0)
    assert a["reviewRequired"] is False
    assert a["aiDisagrees"] is True


def test_a_second_override_does_not_lose_the_original_ai_reading():
    db = AsyncMongoMockClient()["t2"]
    asyncio.run(db["construction_progress_snapshots"].insert_one(snapshot(20.0)))
    apply(db, "s1", 60.0)
    apply(db, "s1", 100.0, by="Ravi")
    a = live_act(db)
    assert a["aiCompletionPct"] == 20.0 and a["override"]["by"] == "Ravi"


def test_manual_verification_counts_in_the_flat_numbers():
    db = AsyncMongoMockClient()["t3"]
    asyncio.run(db["construction_progress_snapshots"].insert_one(snapshot(20.0)))
    apply(db, "s1", 100.0)
    snap = asyncio.run(db["construction_progress_snapshots"].find_one({"_id": "s1"}))
    flats = snap["flatProgress"]
    recompute_flat_finishing_pcts(flats)
    room = flats[0]["rooms"][0]
    assert room["estimatePct"] == 100.0 and room["observedActivities"] == 1


def test_dates_are_serialised_as_unambiguous_utc():
    naive = datetime(2026, 11, 12, 6, 23, 38, 704000)          # what MongoDB returns
    assert iso_utc(naive) == "2026-11-12T06:23:38.704000Z"
    aware = datetime(2026, 11, 12, 11, 53, tzinfo=timezone.utc)
    assert iso_utc(aware).endswith("Z")
    assert iso_utc("already a string") == "already a string"
    assert iso_utc_walk({"a": [naive, {"b": naive}]})["a"][1]["b"].endswith("Z")


def test_snapshot_payload_carries_utc_dates_and_the_new_summaries():
    doc = {
        "_id": "x", "snapshotDate": datetime(2026, 11, 12, 6, 23),
        "summaryCards": {"lastInspection": datetime(2026, 11, 10, 10, 12, 25), "analysedAt": datetime(2026, 11, 12, 6, 23)},
        "flatFinishing": {"progressPct": 10.0},
    }
    out = _serialize_snapshot(doc)
    assert out["snapshotDate"].endswith("Z")
    assert out["summaryCards"]["lastInspection"] == "2026-11-10T10:12:25Z"
    assert out["flatFinishing"] == {"progressPct": 10.0} and out["commonFinishing"] == {}


def test_finishing_summaries_split_flats_from_common_and_blend_the_headline():
    flats = [
        {"flatName": "Flat 01", "completionPct": 100.0, "coveragePct": 100.0, "scopeStatus": "completed"},
        {"flatName": "Flat 02", "completionPct": 0.0, "coveragePct": 0.0, "scopeStatus": "no_photos"},
        {"flatName": "Common Area", "completionPct": 60.0, "coveragePct": 90.0, "scopeStatus": "in_progress"},
    ]
    flat_s, common_s, overall = finishing_summaries(flats)
    assert flat_s["total"] == 2 and flat_s["completed"] == 1 and flat_s["progressPct"] == 50.0
    assert common_s["total"] == 1 and common_s["progressPct"] == 60.0
    assert overall == round((50.0 * 2 + 60.0) / 3, 1)


def test_older_snapshots_with_legacy_activity_ids_keep_working():
    flats = [{"flatName": "Flat 01", "roomsRequired": 1, "rooms": [{
        "roomName": "A", "capturesCount": 1, "pinNumbers": [1],
        "activities": [{"activityId": "flat.final_coat_paint_37", "completionPct": 50.0, "status": "in_progress"}],
    }]}]
    recompute_flat_finishing_pcts(flats)
    assert flats[0]["completionPct"] == 50.0            # observed-only denominator, no crash, no fake "applicable" set
