"""Rules that keep a point's photos safe (see app/services/pin_integrity.py). No database needed."""
import re

from app.services.pin_integrity import (
    capture_ids_of,
    floor_id_prefix_regex,
    is_covered_by_captured_pin,
    merge_pin_on_create,
    names_to_fill_from_layout,
)


def test_new_id_is_stored_exactly_as_sent():
    incoming = {"id": "p1", "x": 10, "y": 20, "captureIds": []}
    assert merge_pin_on_create(None, incoming) == incoming


def test_replayed_create_with_empty_capture_list_never_wipes_photos():
    existing = {"id": "p1", "x": 10, "y": 20, "captureIds": ["c1", "c2"], "flatName": "Flat 01"}
    replay = {"id": "p1", "x": 10, "y": 20, "captureIds": []}
    merged = merge_pin_on_create(existing, replay)
    assert merged["captureIds"] == ["c1", "c2"]
    assert merged["flatName"] == "Flat 01"


def test_replayed_create_never_reverts_a_later_edit():
    existing = {"id": "p1", "x": 55.5, "y": 44.4, "roomName": "Kitchen", "captureIds": ["c1"]}
    stale_create = {"id": "p1", "x": 10, "y": 20, "roomName": "Pin 3", "captureIds": []}
    merged = merge_pin_on_create(existing, stale_create)
    assert (merged["x"], merged["y"], merged["roomName"]) == (55.5, 44.4, "Kitchen")


def test_capture_list_is_a_union_and_keeps_order():
    existing = {"id": "p1", "captureIds": ["c1", "c2"]}
    incoming = {"id": "p1", "captureIds": ["c2", "c3"]}
    assert merge_pin_on_create(existing, incoming)["captureIds"] == ["c1", "c2", "c3"]


def test_missing_fields_are_filled_in_from_the_request():
    existing = {"id": "p1", "captureIds": ["c1"]}
    incoming = {"id": "p1", "x": 1, "y": 2, "floorId": "f1"}
    merged = merge_pin_on_create(existing, incoming)
    assert (merged["x"], merged["y"], merged["floorId"]) == (1, 2, "f1")


def test_snake_case_capture_list_is_counted_too():
    assert capture_ids_of({"captureIds": ["a"], "capture_ids": ["a", "b"]}) == ["a", "b"]
    merged = merge_pin_on_create({"id": "p", "capture_ids": ["a", "b"]}, {"id": "p", "captureIds": []})
    assert merged["captureIds"] == ["a", "b"]
    assert merged["capture_ids"] == ["a", "b"]


def test_floor_prefix_does_not_match_a_longer_floor_id():
    rx = re.compile(floor_id_prefix_regex("t1-f1-f2"))
    assert rx.match("t1-f1-f2-flat-a-r10")      # this floor's room
    assert rx.match("t1-f1-f2")                  # the bare id
    assert not rx.match("t1-f1-f22-flat-a-r10")  # a DIFFERENT floor that only shares the leading characters
    assert not rx.match("t1-f1-f3-flat-a-r1")


def test_floor_prefix_escapes_regex_characters():
    rx = re.compile(floor_id_prefix_regex("a.b"))
    assert rx.match("a.b-flat-r1")
    assert not rx.match("axb-flat-r1")


def test_import_point_is_skipped_when_a_captured_point_is_already_there():
    captured = [{"x": 40.0, "y": 60.0}]
    assert is_covered_by_captured_pin(40.5, 60.4, captured) is True
    assert is_covered_by_captured_pin(48.0, 60.0, captured) is False
    assert is_covered_by_captured_pin(40.0, 60.0, []) is False


def test_bad_coordinates_never_crash_the_check():
    assert is_covered_by_captured_pin(1, 1, [{"x": None, "y": 2}, {"y": 3}, {"x": "n/a", "y": 1}]) is False


def _layout():
    return [
        {"x": 50.0, "y": 40.0, "flatName": "Flat 01", "roomName": "Kitchen", "label": "Kitchen"},
        {"x": 80.0, "y": 40.0, "flatName": "Flat 02", "roomName": "Master Bedroom", "label": "Master Bedroom"},
    ]


def test_unnamed_photographed_point_takes_the_names_of_the_layout_point_it_sits_on():
    pin = {"x": 50.4, "y": 40.3, "captureIds": ["c1", "c2"]}
    assert names_to_fill_from_layout(pin, _layout()) == {
        "flatName": "Flat 01", "roomName": "Kitchen", "label": "Kitchen",
    }


def test_names_a_point_already_has_are_never_replaced():
    pin = {"x": 50.0, "y": 40.0, "flatName": "Flat 09", "roomName": "", "label": "Mine", "captureIds": ["c1"]}
    assert names_to_fill_from_layout(pin, _layout()) == {"roomName": "Kitchen"}


def test_fully_named_point_and_far_away_point_get_nothing():
    named = {"x": 50.0, "y": 40.0, "flatName": "A", "roomName": "B", "label": "C"}
    assert names_to_fill_from_layout(named, _layout()) == {}
    assert names_to_fill_from_layout({"x": 10.0, "y": 10.0}, _layout()) == {}


def test_filling_names_does_not_depend_on_or_return_photos():
    out = names_to_fill_from_layout({"x": 80.0, "y": 40.0, "captureIds": ["c1"]}, _layout())
    assert "captureIds" not in out and out["roomName"] == "Master Bedroom"


def test_a_point_tapped_by_hand_a_few_percent_off_still_gets_its_room():
    # 5% to the right of "Flat 01 Kitchen"; the next different room is 25% away.
    out = names_to_fill_from_layout({"x": 55.0, "y": 40.0, "captureIds": ["c1"]}, _layout())
    assert out["flatName"] == "Flat 01" and out["roomName"] == "Kitchen"


def test_a_point_roughly_between_two_rooms_is_left_for_a_person_to_name():
    layout = [
        {"x": 40.0, "y": 40.0, "flatName": "Flat 01", "roomName": "Kitchen", "label": "Kitchen"},
        {"x": 50.0, "y": 40.0, "flatName": "Flat 01", "roomName": "Hall", "label": "Hall"},
    ]
    # 4.5 from Kitchen and 5.5 from Hall: too close to call, so no guess.
    assert names_to_fill_from_layout({"x": 44.5, "y": 40.0, "captureIds": ["c1"]}, layout) == {}


def test_a_point_sitting_on_a_layout_point_is_trusted_even_with_a_neighbour_close_by():
    layout = [
        {"x": 40.0, "y": 40.0, "flatName": "Flat 01", "roomName": "Kitchen", "label": "Kitchen"},
        {"x": 43.0, "y": 40.0, "flatName": "Flat 01", "roomName": "Hall", "label": "Hall"},
    ]
    assert names_to_fill_from_layout({"x": 40.4, "y": 40.0}, layout)["roomName"] == "Kitchen"


def test_nothing_is_filled_beyond_the_distance_limit():
    assert names_to_fill_from_layout({"x": 59.0, "y": 40.0}, _layout()) == {}  # 9 away from the nearest room


def test_two_points_in_the_same_room_both_get_that_room():
    a = names_to_fill_from_layout({"x": 50.5, "y": 40.0}, _layout())
    b = names_to_fill_from_layout({"x": 52.0, "y": 41.0}, _layout())
    assert a["roomName"] == b["roomName"] == "Kitchen"
