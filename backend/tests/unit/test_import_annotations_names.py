"""Import annotations onto a floor that already has unnamed points: names are copied, nothing is doubled, photos stay put."""
from __future__ import annotations

import pytest
from mongomock_motor import AsyncMongoMockClient

from app.services.predefined_pins_service import PredefinedPinsService

ORG = "o1"
LAYOUT = [
    ("Flat 01", "Kitchen", 20.0, 20.0), ("Flat 01", "Master Bedroom", 50.0, 20.0),
    ("Flat 02", "Kitchen", 80.0, 20.0), ("Flat 02", "Hall", 20.0, 60.0), ("Flat 03", "Toilet", 60.0, 60.0),
]


@pytest.fixture
def db():
    return AsyncMongoMockClient()["import_names"]


async def _world(db):
    await db["floors"].insert_many([
        {"_id": "SRC", "orgId": ORG, "towerId": "T", "projectId": "P"},
        {"_id": "TGT", "orgId": ORG, "towerId": "T", "projectId": "P"},
    ])
    await db["floor_plans"].insert_many([
        {"_id": "planS", "orgId": ORG, "floorId": "SRC", "towerId": "T", "projectId": "P", "createdAt": 1},
        {"_id": "planT", "orgId": ORG, "floorId": "TGT", "towerId": "T", "projectId": "P", "createdAt": 2},
    ])
    await db["capture_pins"].insert_many([
        {"_id": f"s{i}", "id": f"s{i}", "orgId": ORG, "floorPlanId": "planS", "floorId": "SRC", "x": x, "y": y,
         "flatName": f, "roomName": r, "label": r, "sequenceNumber": i, "isPredefined": True, "captureIds": []}
        for i, (f, r, x, y) in enumerate(LAYOUT, start=1)
    ])


def _unnamed(pid, x, y, caps=()):
    return {"_id": pid, "id": pid, "orgId": ORG, "floorPlanId": "planT", "floorId": "TGT", "x": x, "y": y,
            "captureIds": list(caps), "sequenceNumber": 1, "source": "freeplace", "label": "Point"}


async def _import(db):
    return await PredefinedPinsService(db).copy_pins_from_floor(
        org_id=ORG, target_floor_id="TGT", source_floor_id="SRC",
        target_floor_plan_id="planT", source_floor_plan_id="planS",
    )


async def _target(db):
    return await db["capture_pins"].find({"floorId": "TGT"}).to_list(100)


def _name(p):
    return f"{p.get('flatName')} | {p.get('roomName')}"


@pytest.mark.asyncio
async def test_unnamed_points_without_photos_take_the_layout_names_and_are_not_doubled(db):
    await _world(db)
    # What the floor looked like: one unnamed placeholder per layout point, slightly off, no photos.
    await db["capture_pins"].insert_many([
        _unnamed(f"u{i}", x + 0.4, y - 0.3) for i, (_, _, x, y) in enumerate(LAYOUT, start=1)
    ])
    res = await _import(db)
    pins = await _target(db)
    assert len(pins) == len(LAYOUT)  # used to be 2 x 5: the unnamed ones stayed and a named copy was added
    assert sorted(_name(p) for p in pins) == sorted(f"{f} | {r}" for f, r, _, _ in LAYOUT)
    assert all((p.get("flatName") and p.get("roomName")) for p in pins)
    assert len(res["pins"]) == len(LAYOUT)  # the client gets the names back, so its own copy updates too
    assert all(p["roomName"] for p in res["pins"])


@pytest.mark.asyncio
async def test_photographed_and_photoless_unnamed_points_together(db):
    await _world(db)
    await db["capture_pins"].insert_many([
        _unnamed("photo1", 20.6, 20.2, ["c1", "c2"]),   # Flat 01 Kitchen
        _unnamed("photo2", 52.0, 21.0, ["c3"]),         # Flat 01 Master Bedroom
        _unnamed("empty1", 80.3, 19.8),                 # Flat 02 Kitchen
        _unnamed("empty2", 20.2, 60.4),                 # Flat 02 Hall
    ])
    res = await _import(db)
    pins = {p["_id"]: p for p in await _target(db)}
    assert _name(pins["photo1"]) == "Flat 01 | Kitchen" and pins["photo1"]["captureIds"] == ["c1", "c2"]
    assert _name(pins["photo2"]) == "Flat 01 | Master Bedroom" and pins["photo2"]["captureIds"] == ["c3"]
    assert _name(pins["empty1"]) == "Flat 02 | Kitchen"
    assert _name(pins["empty2"]) == "Flat 02 | Hall"
    # 4 existing points named + only the one room nobody had (Flat 03 Toilet) is created: 5, not 9.
    assert len(pins) == 5
    created = [p for p in pins.values() if p.get("source") == "copied"]
    assert [_name(p) for p in created] == ["Flat 03 | Toilet"]
    assert all(p["captureIds"] == [] for p in created)  # photos never travel with an imported point
    assert res["copiedCount"] == 5


@pytest.mark.asyncio
async def test_importing_twice_does_not_grow_the_floor(db):
    await _world(db)
    await db["capture_pins"].insert_many([_unnamed(f"u{i}", x, y) for i, (_, _, x, y) in enumerate(LAYOUT, start=1)])
    await _import(db)
    first = len(await _target(db))
    await _import(db)
    assert len(await _target(db)) == first == len(LAYOUT)


@pytest.mark.asyncio
async def test_a_point_far_from_every_layout_point_is_left_alone(db):
    await _world(db)
    await db["capture_pins"].insert_one(_unnamed("stray", 5.0, 5.0))
    await _import(db)
    stray = await db["capture_pins"].find_one({"_id": "stray"})
    assert not stray.get("flatName") and not stray.get("roomName")
    assert await db["capture_pins"].count_documents({"floorId": "TGT"}) == len(LAYOUT) + 1


@pytest.mark.asyncio
async def test_names_a_point_already_has_are_not_replaced_and_the_source_floor_is_untouched(db):
    await _world(db)
    keep = _unnamed("mine", 20.0, 20.0, ["c9"])
    keep.update({"flatName": "Flat 09", "roomName": "Study", "label": "Study"})
    await db["capture_pins"].insert_one(keep)
    await _import(db)
    mine = await db["capture_pins"].find_one({"_id": "mine"})
    assert (mine["flatName"], mine["roomName"], mine["captureIds"]) == ("Flat 09", "Study", ["c9"])
    assert await db["capture_pins"].count_documents({"floorId": "SRC"}) == len(LAYOUT)
