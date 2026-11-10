"""Pure rules that keep a point's photos safe.

Deliberately has NO database or framework imports, so every rule here can be unit tested without MongoDB.
The endpoints / services call these and then do the I/O.
"""
from __future__ import annotations

import math
import re
from typing import Any, Iterable


def capture_ids_of(pin: dict[str, Any] | None) -> list[str]:
    """Every capture id on a pin (camelCase and snake_case), de-duplicated, original order kept."""
    out: list[str] = []
    for key in ("captureIds", "capture_ids"):
        for cid in (pin or {}).get(key) or []:
            if isinstance(cid, str) and cid and cid not in out:
                out.append(cid)
    return out


def merge_pin_on_create(existing: dict[str, Any] | None, incoming: dict[str, Any]) -> dict[str, Any]:
    """What to store when a 'create point' request arrives and the id MAY already exist.

    The create endpoint used to replace the whole record. A replayed or late create (offline queue retry, a stale
    snapshot back-fill) then wiped the capture list of a point that had since gained photos, and reverted edits.

    Rules for an id that already exists:
      * the stored record wins for every field it already has (a replay can never revert an edit or a label);
      * fields the stored record lacks are filled in from the request;
      * the capture list is the UNION of both: it can grow, never shrink.
    A brand-new id is stored exactly as sent.
    """
    if not existing:
        return dict(incoming)
    merged: dict[str, Any] = {**incoming, **existing}
    ids = capture_ids_of(existing)
    for cid in capture_ids_of(incoming):
        if cid not in ids:
            ids.append(cid)
    merged["captureIds"] = ids
    if "capture_ids" in merged or "capture_ids" in incoming:
        merged["capture_ids"] = list(ids)
    return merged


def floor_id_prefix_regex(floor_id: str) -> str:
    """Regex matching room ids that belong to exactly this floor.

    Room ids look like '<floorId>-flat-a-r123'. A bare '^<floorId>' also matches a DIFFERENT floor whose id merely
    starts with the same characters (floor 't1-f1-f2' vs 't1-f1-f22'), so the orphan-repair job could attach another
    floor's photos here. Requiring the '-' separator (or the end of the id) closes that.
    """
    return f"^{re.escape(floor_id)}(-|$)"


def pin_distance_pct(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(float(ax) - float(bx), float(ay) - float(by))


def is_covered_by_captured_pin(
    src_x: float,
    src_y: float,
    captured_pins: Iterable[dict[str, Any]],
    *,
    max_distance_pct: float = 1.5,
) -> bool:
    """True when a point that already has photos sits (almost) exactly where an imported layout point would go.

    'Import annotations' keeps points that have photos and then creates the source floor's points. When the kept
    point has no flat/room label it cannot be matched by name, so the import used to add a second, empty point on
    top of it. Skipping the import point when a captured point is already there removes that duplicate.
    """
    for pin in captured_pins:
        try:
            if pin_distance_pct(src_x, src_y, float(pin["x"]), float(pin["y"])) <= max_distance_pct:
                return True
        except (KeyError, TypeError, ValueError):
            continue
    return False
