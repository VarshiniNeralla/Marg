"""Unit tests for predefined labeled capture points."""
from __future__ import annotations

import pytest

from app.services.predefined_pins_service import (
    apply_nearest_label,
    assert_same_tower,
    find_nearest_labeled_pin,
    pick_location_from_pin,
    pin_distance_pct,
)


def test_pin_distance_pct():
    assert pin_distance_pct(0, 0, 3, 4) == 5.0


def test_find_nearest_labeled_pin():
    pins = [
        {"_id": "a", "x": 10, "y": 10, "flatName": "Flat 01", "roomName": "Kitchen"},
        {"_id": "b", "x": 50, "y": 50, "flatName": "Flat 02", "roomName": "Living / Dining"},
        {"_id": "c", "x": 80, "y": 80},  # unlabeled — ignored
    ]
    nearest = find_nearest_labeled_pin(pins, x=48, y=52)
    assert nearest is not None
    assert nearest["_id"] == "b"
    assert nearest["roomName"] == "Living / Dining"


def test_find_nearest_excludes_self():
    pins = [
        {"id": "self", "x": 10, "y": 10, "flatName": "Flat 01", "roomName": "Kitchen"},
        {"id": "other", "x": 90, "y": 90, "flatName": "Flat 02", "roomName": "Bedroom"},
    ]
    nearest = find_nearest_labeled_pin(pins, x=10, y=10, exclude_pin_id="self")
    assert nearest is not None
    assert nearest["id"] == "other"


def test_apply_nearest_label_stamps_inheritance():
    labeled = [
        {"_id": "src", "x": 20, "y": 20, "flatName": "Flat 03", "roomName": "Toilet"},
    ]
    free = {"id": "fp1", "x": 22, "y": 21, "source": "freeplace"}
    out = apply_nearest_label(free, labeled)
    assert out["flatName"] == "Flat 03"
    assert out["roomName"] == "Toilet"
    assert out["inheritedFromPinId"] == "src"
    assert out["source"] == "freeplace"
    assert out["isPredefined"] is False


def test_apply_nearest_label_keeps_existing_labels():
    labeled = [
        {"_id": "src", "x": 20, "y": 20, "flatName": "Flat 03", "roomName": "Toilet"},
    ]
    pin = {"id": "p", "x": 22, "y": 21, "flatName": "Flat 01", "roomName": "Kitchen"}
    out = apply_nearest_label(pin, labeled)
    assert out["flatName"] == "Flat 01"
    assert out["roomName"] == "Kitchen"
    assert "inheritedFromPinId" not in out


def test_pick_location_prefers_corrections_over_pin_labels():
    pin = {
        "flatName": "Flat 01",
        "roomName": "Kitchen",
        "correctedFlatName": "Flat 02",
        "correctedRoomName": "Living / Dining",
    }
    assert pick_location_from_pin(pin) == ("Flat 02", "Living / Dining")


def test_pick_location_uses_pin_labels_before_ai_fallback():
    pin = {"flatName": "Flat 01", "roomName": "Kitchen"}
    assert pick_location_from_pin(pin) == ("Flat 01", "Kitchen")


def test_pick_location_none_means_ai_fallback():
    assert pick_location_from_pin({"x": 10, "y": 10}) is None
    assert pick_location_from_pin(None) is None
    assert pick_location_from_pin({"flatName": "Flat 01"}) is None  # room missing


def test_assert_same_tower_ok():
    assert_same_tower("tower-1", "tower-1")


def test_assert_same_tower_rejects_mismatch():
    with pytest.raises(ValueError, match="same tower"):
        assert_same_tower("tower-1", "tower-2")


def test_assert_same_tower_rejects_empty():
    with pytest.raises(ValueError, match="same tower"):
        assert_same_tower("", "tower-1")
