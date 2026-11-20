"""Review flow end to end: Accept / Mark completed / In progress / Correct, kept across a re-analysis, with the AI's side
recorded so the reviews measure and improve the AI."""
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.services.review_correction_applier import ReviewCorrectionApplier
from tests.conftest import ORG_ID, _make_user_doc, auth_headers, make_access_token

FLOOR = "floor-5"
SCREED = "flat.screed_works"
PUNNING = "flat.ceiling_punning_2"


def _snapshot(snap_id: str, when: datetime, screed_pct: float, punning_pct: float) -> dict:
    def act(aid: str, name: str, pct: float) -> dict:
        return {
            "activityId": aid, "activityName": name, "completionPct": pct, "confidencePct": 90.0,
            "evidenceCaptureIds": ["c1", "c2"], "rationale": f"The photos show {name} at about {pct:.0f}%.",
            "status": "completed" if pct >= 100 else "in_progress", "assessmentStatus": "completed" if pct >= 100 else "in_progress",
            "detectionType": "direct", "reviewRequired": True, "reviewReason": "low confidence",
        }

    return {
        "_id": snap_id, "id": snap_id, "orgId": ORG_ID, "floorId": FLOOR, "snapshotDate": when, "createdAt": when,
        "model": "test-model", "promptVersion": "v4-evidence-engine", "rigVersion": 1, "heatmapPins": [],
        "flatProgress": [{"flatName": "Flat 07", "completionPct": 0.0, "roomsComplete": 0, "roomsTotal": 1,
                          "rooms": [{"roomName": "Puja", "isComplete": False, "pinNumbers": [], "capturesCount": 2,
                                     "activities": [act(SCREED, "Screed Works", screed_pct), act(PUNNING, "Punning Works", punning_pct)]}]}],
    }


def _payload(snap_id: str, aid: str, mode: str, pct=None, reason="Looks right to me", code=None) -> dict:
    """Exactly what ActivityReviewDialog / buildReviewPayload send."""
    base = {"snapshotId": snap_id, "floorId": FLOOR, "flatName": "Flat 07", "roomName": "Puja", "roomCorrect": "yes"}
    if mode == "accept":
        return {**base, "progressVerdict": "correct", "activityCorrections": [{"activityId": aid, "verdict": "correct", "note": reason}]}
    corr = {"activityId": aid, "verdict": "wrong", "correctPercentage": pct, "note": reason}
    if code:
        corr["reasonCode"] = code
    return {**base, "progressVerdict": "wrong", "activityCorrections": [corr]}


async def _admin(mock_db):
    uid = str(ObjectId())
    await mock_db.users.insert_one(_make_user_doc(uid, ORG_ID, role="admin", email="rev_admin@test.com", name="Rev Admin"))
    return uid, auth_headers(make_access_token(uid, ORG_ID, role="admin"))


async def _activity(mock_db, snap_id: str, aid: str) -> dict:
    snap = await mock_db.construction_progress_snapshots.find_one({"_id": snap_id})
    return next(a for a in snap["flatProgress"][0]["rooms"][0]["activities"] if a["activityId"] == aid)


T0 = datetime(2026, 11, 19, 10, 0, tzinfo=timezone.utc)


class TestAcceptAndCorrect:
    @pytest.mark.asyncio
    async def test_accept_is_applied_and_shown_as_verified(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        resp = await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", SCREED, "accept"), headers=h)
        assert resp.status_code == 201
        a = await _activity(mock_db, "snap1", SCREED)
        # accepting used to be saved but ignored: it must now verify the value and clear the "needs review" flag
        assert a["detectionType"] == "manual" and a["reviewRequired"] is False
        assert a["completionPct"] == 100.0 and a["override"]["accepted"] is True and a["override"]["verdict"] == "correct"
        assert a["aiCompletionPct"] == 100.0
        other = await _activity(mock_db, "snap1", PUNNING)
        assert other["detectionType"] == "direct" and other["reviewRequired"] is True        # untouched

    @pytest.mark.asyncio
    async def test_correction_changes_the_value_and_keeps_the_ai_reading(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        resp = await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20, reason="Only the first coat", code="ai_misread"), headers=h)
        assert resp.status_code == 201
        a = await _activity(mock_db, "snap1", PUNNING)
        assert a["completionPct"] == 20.0 and a["aiCompletionPct"] == 46.0 and a["detectionType"] == "manual"
        assert a["override"]["accepted"] is False and a["override"]["reasonCode"] == "ai_misread"


class TestWhatTheReviewRecords:
    @pytest.mark.asyncio
    async def test_each_review_stores_what_the_ai_said_and_the_photos_it_used(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", SCREED, "accept"), headers=h)
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20, reason="Only the first coat", code="not_enough_photos"), headers=h)
        accept, wrong = [r["activityCorrections"][0] for r in await mock_db.construction_progress_reviews.find({}).sort("createdAt", 1).to_list(10)]
        assert accept["aiPct"] == 100.0 and accept["acceptedPct"] == 100.0 and accept["humanPct"] == 100.0 and accept["errorPts"] == 0.0
        assert accept["evidenceCaptureIds"] == ["c1", "c2"] and "Screed Works" in accept["aiRationale"] and accept["aiConfidencePct"] == 90.0
        assert wrong["aiPct"] == 46.0 and wrong["humanPct"] == 20.0 and wrong["errorPts"] == -26.0   # the AI over-estimated by 26 points
        assert wrong["reasonCode"] == "not_enough_photos" and wrong["note"] == "Only the first coat"
        review = await mock_db.construction_progress_reviews.find_one({})
        assert review["model"] == "test-model" and review["promptVersion"] == "v4-evidence-engine" and review["reviewedBy"]

    @pytest.mark.asyncio
    async def test_a_second_review_measures_against_the_original_ai_value_not_the_first_correction(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20), headers=h)
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=30), headers=h)
        second = (await mock_db.construction_progress_reviews.find({}).sort("createdAt", 1).to_list(10))[-1]["activityCorrections"][0]
        assert second["aiPct"] == 46.0 and second["errorPts"] == -16.0

    @pytest.mark.asyncio
    async def test_unknown_reason_tag_is_rejected_and_nothing_is_saved(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        resp = await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20, code="NOT VALID!"), headers=h)
        assert resp.status_code == 422
        assert await mock_db.construction_progress_reviews.count_documents({}) == 0


class TestKeptAcrossReanalysis:
    @pytest.mark.asyncio
    async def test_both_kinds_of_decision_survive_a_new_analysis(self, client, mock_db):
        _, h = await _admin(mock_db)
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", SCREED, "accept"), headers=h)
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20), headers=h)
        # a later analysis produces fresh AI values for the same room, with no human marks on them
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap2", T0 + timedelta(days=1), 60.0, 90.0))
        result = await ReviewCorrectionApplier(mock_db).backfill_floor(org_id=ORG_ID, floor_id=FLOOR)
        assert result["reviewsProcessed"] == 2 and result["activityPctUpdates"] == 2
        screed = await _activity(mock_db, "snap2", SCREED)
        punning = await _activity(mock_db, "snap2", PUNNING)
        # accepted: the value the reviewer saw (100) stays verified even though the new AI reading is 60
        assert screed["completionPct"] == 100.0 and screed["detectionType"] == "manual" and screed["aiCompletionPct"] == 60.0
        assert punning["completionPct"] == 20.0 and punning["detectionType"] == "manual" and punning["aiCompletionPct"] == 90.0
        assert screed["reviewRequired"] is False and punning["reviewRequired"] is False


class TestSummaryAndExport:
    async def _two_reviews(self, client, mock_db, h):
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", SCREED, "accept"), headers=h)
        await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", PUNNING, "correct", pct=20, reason="Only the first coat", code="ai_misread"), headers=h)

    @pytest.mark.asyncio
    async def test_summary_shows_how_far_off_the_ai_is_per_activity(self, client, mock_db):
        _, h = await _admin(mock_db)
        await self._two_reviews(client, mock_db, h)
        resp = await client.get("/api/v1/construction-progress/reviews/summary", headers=h)
        assert resp.status_code == 200
        group = resp.json()["data"]["byVersion"][0]
        acc = {a["activityId"]: a for a in group["activityAccuracy"]}
        assert acc[SCREED]["meanAbsErrorPts"] == 0.0 and acc[SCREED]["accepted"] == 1
        assert acc[PUNNING]["meanAbsErrorPts"] == 26.0 and acc[PUNNING]["biasPts"] == -26.0 and acc[PUNNING]["corrected"] == 1

    @pytest.mark.asyncio
    async def test_export_gives_one_row_per_reviewed_activity_as_json_and_csv(self, client, mock_db):
        _, h = await _admin(mock_db)
        await self._two_reviews(client, mock_db, h)
        rows = (await client.get("/api/v1/construction-progress/reviews/export", headers=h)).json()["data"]
        assert len(rows) == 2
        wrong = next(r for r in rows if r["activityId"] == PUNNING)
        assert wrong["aiPct"] == 46.0 and wrong["humanPct"] == 20.0 and wrong["errorPts"] == -26.0
        assert wrong["reason"] == "Only the first coat" and wrong["reasonCode"] == "ai_misread" and wrong["evidenceCaptureIds"] == "c1;c2"
        csv = await client.get("/api/v1/construction-progress/reviews/export?format=csv", headers=h)
        assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
        lines = csv.text.strip().splitlines()
        assert lines[0].startswith("reviewedAt,reviewId,floorId") and len(lines) == 3

    @pytest.mark.asyncio
    async def test_a_field_engineer_cannot_review_or_export(self, client, mock_db):
        uid = str(ObjectId())
        await mock_db.users.insert_one(_make_user_doc(uid, ORG_ID, role="field_engineer", email="fe_rev@test.com", name="FE"))
        h = auth_headers(make_access_token(uid, ORG_ID, role="field_engineer"))
        await mock_db.construction_progress_snapshots.insert_one(_snapshot("snap1", T0, 100.0, 46.0))
        assert (await client.post("/api/v1/construction-progress/reviews", json=_payload("snap1", SCREED, "accept"), headers=h)).status_code == 403
        assert (await client.get("/api/v1/construction-progress/reviews/export", headers=h)).status_code == 403
        assert await mock_db.construction_progress_reviews.count_documents({}) == 0
