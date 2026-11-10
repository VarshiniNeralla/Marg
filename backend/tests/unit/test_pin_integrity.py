"""Rules that keep a point's photos safe (see app/services/pin_integrity.py). No database needed."""
import re

from app.services.pin_integrity import (
    capture_ids_of,
    floor_id_prefix_regex,
    is_covered_by_captured_pin,
    merge_pin_on_create,
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
