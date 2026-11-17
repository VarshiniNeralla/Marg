"""Validation for manager review notes (a comment on a tour photo, optionally with drawn shapes).

Kept free of any database or web code so the rules are unit-tested on their own.
"""
from __future__ import annotations

import math
from typing import Any

from app.core.exceptions import ValidationException

MAX_TEXT = 1000
MAX_SHAPES = 12
MAX_POINTS = 240
SHAPE_KINDS = {"rect", "ellipse", "arrow", "pen"}
SPACES = {"sphere", "flat"}
# A small fixed palette keeps annotations readable and consistent for everyone.
COLORS = {"#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"}
DEFAULT_COLOR = "#ef4444"


def clean_text(value: Any, *, required: bool) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValidationException("Write a comment first")
    if len(text) > MAX_TEXT:
        raise ValidationException(f"Comments can be at most {MAX_TEXT} characters")
    return text


def _pair(raw: Any, space: str) -> list[float]:
    try:
        a, b = float(raw[0]), float(raw[1])
    except (TypeError, ValueError, IndexError, KeyError):
        raise ValidationException("An annotation point is not valid")
    if not (math.isfinite(a) and math.isfinite(b)):
        raise ValidationException("An annotation point is not valid")
    if space == "flat":
        a, b = min(max(a, 0.0), 1.0), min(max(b, 0.0), 1.0)
    else:
        # degrees: yaw wraps around, pitch is limited to straight down/up
        a = ((a + 180.0) % 360.0) - 180.0
        b = min(max(b, -90.0), 90.0)
    return [round(a, 4), round(b, 4)]


def clean_shapes(raw: Any) -> dict[str, Any] | None:
    """Return {space, focus, shapes} or None when there is nothing drawn."""
    if raw in (None, {}, []):
        return None
    if not isinstance(raw, dict):
        raise ValidationException("The annotation is not valid")
    space = raw.get("space")
    if space not in SPACES:
        raise ValidationException("The annotation is not valid")
    shapes_in = raw.get("shapes") or []
    if not isinstance(shapes_in, list):
        raise ValidationException("The annotation is not valid")
    if not shapes_in:
        return None
    if len(shapes_in) > MAX_SHAPES:
        raise ValidationException(f"An annotation can hold at most {MAX_SHAPES} shapes")

    shapes: list[dict[str, Any]] = []
    for item in shapes_in:
        if not isinstance(item, dict) or item.get("kind") not in SHAPE_KINDS:
            raise ValidationException("The annotation is not valid")
        pts = item.get("points")
        if not isinstance(pts, list) or len(pts) < 2 or len(pts) > MAX_POINTS:
            raise ValidationException("The annotation is not valid")
        color = item.get("color") if item.get("color") in COLORS else DEFAULT_COLOR
        shapes.append({
            "kind": item["kind"],
            "color": color,
            "points": [_pair(p, space) for p in pts],
        })

    focus = raw.get("focus")
    out: dict[str, Any] = {"space": space, "shapes": shapes}
    if focus is not None:
        out["focus"] = _pair(focus, space)
    return out
