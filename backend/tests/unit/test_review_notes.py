import pytest

from app.core.exceptions import ValidationException
from app.services.review_notes import MAX_SHAPES, clean_shapes, clean_text


def _rect(**kw):
    return {"kind": "rect", "color": "#ef4444", "points": [[10, 5], [20, 5], [20, 15], [10, 15]], **kw}


def test_comment_needs_words():
    with pytest.raises(ValidationException):
        clean_text("   ", required=True)
    assert clean_text("  Windows not yet installed ", required=True) == "Windows not yet installed"


def test_text_may_be_empty_when_a_drawing_exists():
    assert clean_text("", required=False) == ""


def test_text_length_limit():
    with pytest.raises(ValidationException):
        clean_text("x" * 1001, required=True)


def test_no_shapes_means_no_annotation():
    assert clean_shapes(None) is None
    assert clean_shapes({"space": "sphere", "shapes": []}) is None


def test_shapes_are_cleaned():
    out = clean_shapes({"space": "sphere", "focus": [190, 120], "shapes": [_rect(color="#123456")]})
    assert out["shapes"][0]["color"] == "#ef4444"  # unknown colours fall back to the default
    assert out["focus"] == [-170.0, 90.0]  # yaw wraps, pitch is clamped


def test_flat_points_stay_inside_the_photo():
    out = clean_shapes({"space": "flat", "shapes": [{"kind": "arrow", "points": [[-1, 0.5], [2, 0.5]]}]})
    assert out["shapes"][0]["points"] == [[0.0, 0.5], [1.0, 0.5]]


@pytest.mark.parametrize("bad", [
    {"space": "moon", "shapes": [_rect()]},
    {"space": "sphere", "shapes": [{"kind": "star", "points": [[0, 0], [1, 1]]}]},
    {"space": "sphere", "shapes": [{"kind": "rect", "points": [[0, 0]]}]},
    {"space": "sphere", "shapes": [{"kind": "rect", "points": [["a", 0], [1, 1]]}]},
    {"space": "sphere", "shapes": [{"kind": "rect", "points": [[float("nan"), 0], [1, 1]]}]},
    "text",
])
def test_bad_annotations_are_rejected(bad):
    with pytest.raises(ValidationException):
        clean_shapes(bad)


def test_too_many_shapes_rejected():
    with pytest.raises(ValidationException):
        clean_shapes({"space": "sphere", "shapes": [_rect()] * (MAX_SHAPES + 1)})
