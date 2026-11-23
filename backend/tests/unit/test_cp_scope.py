"""Activity scope: default, validation, apply-to-tower/project, scoped denominators, analyze reads the scope."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from mongomock_motor import AsyncMongoMockClient

from app.core.exceptions import BadRequestException
from app.services import construction_progress_service as cps
from app.services.construction_progress_providers.activities import (
    CORE_ACTIVITIES,
    CORE_IDS,
    ActivityDef,
)
from app.services.construction_progress_providers.base import (
    ActivityAssessment,
    FlatProgress,
    FloorProgressResult,
    RoomActivityAssessment,
    RoomProgress,
)
from app.services.construction_progress_scope_service import (
    COLLECTION_SCOPE,
    ConstructionProgressScopeService,
    all_core_ids,
    core_catalog,
    validate_activity_ids,
)

ORG = "org-1"
SCREED = "flat.floor_screed_1"
PAINT = "flat.paint_40"
GYPSUM = "flat.gypsum_41"


@pytest.fixture
def db():
    return AsyncMongoMockClient()["cp_scope_test"]


async def _seed_project(db):
    await db["projects"].insert_one({"_id": "p1", "orgId": ORG, "name": "Project One"})
    await db["towers"].insert_many([
        {"_id": "t1", "orgId": ORG, "projectId": "p1", "name": "Tower A"},
        {"_id": "t2", "orgId": ORG, "projectId": "p1", "name": "Tower B"},
        {"_id": "t9", "orgId": ORG, "projectId": "other", "name": "Elsewhere"},
    ])
    await db["floors"].insert_many([
        {"_id": "f1", "orgId": ORG, "towerId": "t1", "label": "Floor 1"},
        {"_id": "f2", "orgId": ORG, "towerId": "t1", "label": "Floor 2"},
        {"_id": "f3", "orgId": ORG, "towerId": "t2", "label": "Floor 1"},
        {"_id": "f9", "orgId": ORG, "towerId": "t9", "label": "Floor 1"},
    ])


# ── catalog / validation ─────────────────────────────────────────────────────

def test_catalog_is_core_only_with_the_documented_shape():
    cat = core_catalog()
    assert [c["activityId"] for c in cat] == all_core_ids()
    assert {c["activityId"] for c in cat} == set(CORE_IDS)
    for c in cat:
        assert set(c) == {"activityId", "name", "section", "description", "applicableRooms", "core"}
        assert c["core"] is True and c["section"] in ("flat", "common")
    assert {c["section"] for c in cat} == {"flat", "common"}


def test_validation_rejects_unknown_empty_and_non_list_and_dedupes_in_catalogue_order():
    with pytest.raises(BadRequestException):
        validate_activity_ids(["flat.putty_1st_coat_25"])  # legacy id: not selectable
    with pytest.raises(BadRequestException):
        validate_activity_ids(["nope"])
    with pytest.raises(BadRequestException):
        validate_activity_ids([])
    with pytest.raises(BadRequestException):
        validate_activity_ids("flat.floor_screed_1")
    assert validate_activity_ids([PAINT, SCREED, PAINT]) == [SCREED, PAINT]


# ── scope storage ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_default_scope_is_every_core_activity(db):
    svc = ConstructionProgressScopeService(db)
    view = await svc.get_scope_view(ORG, "f1")
    assert view["floorId"] == "f1"
    assert view["activityIds"] == all_core_ids()
    assert view["isDefault"] is True
    assert view["updatedAt"] is None and view["updatedBy"] is None
    assert len(view["catalog"]) == len(CORE_ACTIVITIES)
    assert await svc.get_scope_ids(ORG, "f1") is None
    assert await svc.get_effective_ids(ORG, "f1") == all_core_ids()


@pytest.mark.asyncio
async def test_set_scope_floor_only_persists_and_reads_back(db):
    await _seed_project(db)
    svc = ConstructionProgressScopeService(db)
    view = await svc.set_scope(ORG, "f1", [PAINT, SCREED], updated_by="u1")
    assert view["activityIds"] == [SCREED, PAINT]
    assert view["isDefault"] is False
    assert view["updatedBy"] == "u1" and view["updatedAt"]
    assert await svc.get_scope_ids(ORG, "f1") == [SCREED, PAINT]
    # other floors untouched, other orgs untouched
    assert await svc.get_scope_ids(ORG, "f2") is None
    assert await svc.get_scope_ids("org-2", "f1") is None
    assert await db[COLLECTION_SCOPE].count_documents({}) == 1


@pytest.mark.asyncio
async def test_selecting_everything_is_reported_as_default(db):
    svc = ConstructionProgressScopeService(db)
    view = await svc.set_scope(ORG, "f1", all_core_ids(), updated_by="u1")
    assert view["isDefault"] is True


@pytest.mark.asyncio
async def test_invalid_selection_changes_nothing(db):
    svc = ConstructionProgressScopeService(db)
    with pytest.raises(BadRequestException):
        await svc.set_scope(ORG, "f1", ["bogus"], updated_by="u1")
    with pytest.raises(BadRequestException):
        await svc.set_scope(ORG, "f1", [SCREED], updated_by="u1", apply_to="galaxy")
    assert await db[COLLECTION_SCOPE].count_documents({}) == 0


@pytest.mark.asyncio
async def test_apply_to_tower_updates_every_floor_of_that_tower_only(db):
    await _seed_project(db)
    svc = ConstructionProgressScopeService(db)
    await svc.set_scope(ORG, "f1", [SCREED], updated_by="u1", apply_to="tower")
    scopes = await svc.get_scopes_for_floors(ORG, ["f1", "f2", "f3", "f9"])
    assert scopes == {"f1": [SCREED], "f2": [SCREED], "f3": None, "f9": None}


@pytest.mark.asyncio
async def test_apply_to_project_updates_every_floor_of_the_project_only(db):
    await _seed_project(db)
    svc = ConstructionProgressScopeService(db)
    await svc.set_scope(ORG, "f1", [SCREED, GYPSUM], updated_by="u1", apply_to="project")
    scopes = await svc.get_scopes_for_floors(ORG, ["f1", "f2", "f3", "f9"])
    assert scopes == {"f1": [SCREED, GYPSUM], "f2": [SCREED, GYPSUM], "f3": [SCREED, GYPSUM], "f9": None}


@pytest.mark.asyncio
async def test_stored_ids_that_left_the_core_list_are_ignored(db):
    await db[COLLECTION_SCOPE].insert_one(
        {"orgId": ORG, "floorId": "f1", "activityIds": ["flat.putty_1st_coat_25", SCREED]}
    )
    assert await ConstructionProgressScopeService(db).get_scope_ids(ORG, "f1") == [SCREED]
    await db[COLLECTION_SCOPE].update_one({"floorId": "f1"}, {"$set": {"activityIds": ["flat.putty_1st_coat_25"]}})
    assert await ConstructionProgressScopeService(db).get_scope_ids(ORG, "f1") is None


# ── snapshot flag ────────────────────────────────────────────────────────────

async def _snapshot(db, floor_id="f1", **extra):
    doc = {
        "orgId": ORG, "floorId": floor_id, "snapshotDate": datetime(2026, 11, 1, tzinfo=timezone.utc),
        "overallProgressPct": 10.0, "flatProgress": [],
    }
    doc.update(extra)
    res = await db["construction_progress_snapshots"].insert_one(doc)
    return res.inserted_id


@pytest.mark.asyncio
async def test_scope_change_flags_latest_snapshot_and_narrowing_restamps_scope(db):
    await _seed_project(db)
    sid = await _snapshot(db)
    svc = ConstructionProgressScopeService(db)
    await svc.set_scope(ORG, "f1", [SCREED, PAINT], updated_by="u1")
    snap = await db["construction_progress_snapshots"].find_one({"_id": sid})
    assert snap["scopeChangedSinceAnalysis"] is True
    assert snap["activityScope"] == [SCREED, PAINT]  # narrowing: totals follow immediately
    assert set(snap["analysedActivityScope"]) == set(CORE_IDS)

    # Going back to exactly the analysed scope clears the flag.
    await svc.set_scope(ORG, "f1", all_core_ids(), updated_by="u1")
    snap = await db["construction_progress_snapshots"].find_one({"_id": sid})
    assert snap["scopeChangedSinceAnalysis"] is False
    assert set(snap["activityScope"]) == set(CORE_IDS)


@pytest.mark.asyncio
async def test_widening_keeps_the_analysed_scope_until_reanalysis(db):
    await _seed_project(db)
    sid = await _snapshot(db, activityScope=[SCREED], analysedActivityScope=[SCREED])
    await ConstructionProgressScopeService(db).set_scope(ORG, "f1", [SCREED, PAINT], updated_by="u1")
    snap = await db["construction_progress_snapshots"].find_one({"_id": sid})
    assert snap["scopeChangedSinceAnalysis"] is True
    assert snap["activityScope"] == [SCREED]


# ── scoped denominators ──────────────────────────────────────────────────────

def _act(aid, pct, **extra):
    return {"activityId": aid, "activityName": aid, "completionPct": pct, "confidencePct": 80,
            "assessmentStatus": "completed" if pct >= 100 else "in_progress", **extra}


def _flat(room_acts, room="Living"):
    return [{
        "flatName": "Flat 01", "roomsRequired": 1,
        "rooms": [{"roomName": room, "capturesCount": 1, "pinNumbers": [1], "activities": room_acts}],
    }]


def test_core_applicable_ids_follow_the_scope_and_room_rules():
    assert cps._core_applicable_ids("Flat 01", "Living") == cps._core_applicable_ids("Flat 01", "Living", None)
    assert cps._core_applicable_ids("Flat 01", "Living", [SCREED, PAINT]) == [SCREED, PAINT]
    # waterproofing is not a living-room activity even when selected
    assert cps._core_applicable_ids("Flat 01", "Living", ["flat.waterproofing_8", SCREED]) == [SCREED]
    assert cps._core_applicable_ids("Flat 01", "Living", []) == []


def test_scoping_changes_the_percentage_as_expected():
    acts = [_act(SCREED, 100.0), _act(PAINT, 50.0)]
    full = _flat([dict(a) for a in acts])
    cps.recompute_flat_finishing_pcts(full)
    n_all = len(cps._core_applicable_ids("Flat 01", "Living"))
    assert full[0]["rooms"][0]["progressPct"] == round(150.0 / n_all, 1)

    scoped = _flat([dict(a) for a in acts])
    cps.recompute_flat_finishing_pcts(scoped, [SCREED, PAINT])
    assert scoped[0]["rooms"][0]["progressPct"] == 75.0
    assert scoped[0]["rooms"][0]["applicableActivities"] == 2
    assert scoped[0]["rooms"][0]["coveragePct"] == 100.0


def test_unselected_activity_is_ignored_even_when_it_was_assessed():
    flat = _flat([_act(SCREED, 100.0), _act(PAINT, 0.0), _act(GYPSUM, 100.0)])
    cps.recompute_flat_finishing_pcts(flat, [SCREED])
    room = flat[0]["rooms"][0]
    assert room["applicableActivities"] == 1
    assert room["observedActivities"] == 1
    assert room["progressPct"] == 100.0
    assert room["scopeStatus"] == "completed"
    assert flat[0]["scopeStatus"] == "completed"


def test_snapshot_without_activity_scope_means_all_core_ids():
    doc = {"flatProgress": _flat([_act(SCREED, 100.0)]), "heatmapPins": []}
    presented = cps.present_snapshot_doc(doc)
    n_all = len(cps._core_applicable_ids("Flat 01", "Living"))
    assert presented["flatProgress"][0]["rooms"][0]["applicableActivities"] == n_all


def test_present_snapshot_doc_uses_the_stamped_scope_and_does_not_mutate_input():
    doc = {"flatProgress": _flat([_act(SCREED, 100.0), _act(PAINT, 50.0)]), "heatmapPins": [],
           "activityScope": [SCREED, PAINT]}
    presented = cps.present_snapshot_doc(doc)
    assert presented["flatProgress"][0]["rooms"][0]["progressPct"] == 75.0
    assert "progressPct" not in doc["flatProgress"][0]["rooms"][0]


def test_older_snapshots_with_legacy_activities_keep_observed_only_denominators():
    legacy = "flat.putty_1st_coat_25"
    assert legacy not in CORE_IDS
    flat = _flat([_act(legacy, 100.0), _act(SCREED, 50.0)])
    cps.recompute_flat_finishing_pcts(flat, [SCREED, PAINT])
    room = flat[0]["rooms"][0]
    assert room["applicableActivities"] == 2  # observed only: scope does not change old snapshots
    assert room["progressPct"] == 75.0


# ── analyze_floor reads the scope ────────────────────────────────────────────

class _RecordingProvider:
    """Fake provider: records the activities it is asked about and (rudely) answers for an unselected one."""

    def __init__(self, answer_ids):
        self.asked: list[str] = []
        self.answer_ids = answer_ids

    async def assess_floor_progress(self, *, floor_id, activities, captures, as_of, **kw):
        self.asked = [a.activity_id for a in activities]
        by_id = {a.activity_id: a for a in CORE_ACTIVITIES}
        rooms_acts = [
            RoomActivityAssessment(
                activity_id=i, activity_name=by_id[i].name, completion_pct=100.0, confidence_pct=90.0,
                assessment_status="completed", status="completed",
            )
            for i in self.answer_ids
        ]
        return FloorProgressResult(
            overall_progress_pct=0.0, overall_confidence_pct=0.0,
            activities=[
                ActivityAssessment(
                    activity=by_id[i], status="completed", completion_pct=100.0, confidence_pct=90.0,
                    assessment_status="completed",
                )
                for i in self.answer_ids
            ],
            executive_summary="", model="fake",
            flat_progress=[FlatProgress(
                flat_name="Flat 01", completion_pct=0.0, rooms_complete=0, rooms_total=1,
                rooms=[RoomProgress(room_name="Living", is_complete=False, activities=rooms_acts)],
                rooms_required=1,
            )],
        )


async def _analyze(db, provider):
    await _seed_project(db)
    return await cps.ConstructionProgressService(db, provider=provider).analyze_floor(ORG, "f1")


@pytest.mark.asyncio
async def test_analyze_asks_only_for_the_selected_activities_and_stamps_the_scope(db):
    await _seed_project(db)
    await ConstructionProgressScopeService(db).set_scope(ORG, "f1", [SCREED, PAINT], updated_by="u1")
    provider = _RecordingProvider([SCREED, PAINT, GYPSUM])  # the model also answers for an unselected one
    snap = await cps.ConstructionProgressService(db, provider=provider).analyze_floor(ORG, "f1")

    assert provider.asked == [SCREED, PAINT]
    assert snap["activityScope"] == [SCREED, PAINT]
    assert snap["scopeChangedSinceAnalysis"] is False
    room_ids = [a["activityId"] for a in snap["flatProgress"][0]["rooms"][0]["activities"]]
    assert room_ids == [SCREED, PAINT]  # the unselected answer was dropped server-side
    assert {a["activityId"] for a in snap["activities"]} == {SCREED, PAINT}
    room = snap["flatProgress"][0]["rooms"][0]
    assert room["applicableActivities"] == 2 and room["progressPct"] == 100.0
    stored = await db["construction_progress_snapshots"].find_one({})
    assert stored["activityScope"] == [SCREED, PAINT]
    assert stored["analysedActivityScope"] == [SCREED, PAINT]


@pytest.mark.asyncio
async def test_analyze_default_scope_asks_every_core_activity(db):
    provider = _RecordingProvider([SCREED])
    snap = await _analyze(db, provider)
    assert provider.asked == all_core_ids()
    assert snap["activityScope"] == all_core_ids()


@pytest.mark.asyncio
async def test_analyze_drops_a_room_inapplicable_answer(db):
    provider = _RecordingProvider([SCREED, "flat.waterproofing_8"])  # not a living-room activity
    snap = await _analyze(db, provider)
    ids = [a["activityId"] for a in snap["flatProgress"][0]["rooms"][0]["activities"]]
    assert ids == [SCREED]


@pytest.mark.asyncio
async def test_list_summaries_uses_the_snapshot_scope(db):
    await _seed_project(db)
    await db["captures"].insert_one({"_id": "c1", "orgId": ORG, "roomId": "r1"})
    await db["capture_pins"].insert_one({"_id": "pin1", "orgId": ORG, "floorId": "f1", "roomId": "r1", "captureIds": ["c1"]})
    await db["construction_progress_snapshots"].insert_one({
        "orgId": ORG, "floorId": "f1", "snapshotDate": datetime(2026, 11, 1, tzinfo=timezone.utc),
        "overallProgressPct": 1.0, "activityScope": [SCREED, PAINT],
        "flatProgress": _flat([_act(SCREED, 100.0), _act(PAINT, 50.0)]),
    })
    rows = await cps.ConstructionProgressService(db, provider=object()).list_floor_summaries(ORG)
    assert [r["floorId"] for r in rows] == ["f1"]
    assert rows[0]["overallProgressPct"] == 75.0  # flats-only floor: equals the scoped room number
