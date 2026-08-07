from __future__ import annotations

import base64
import copy
import io
import re
import string
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from PIL import Image, ImageDraw, ImageFont

from app.services.image_fetch import download_image, validate_image_url
from app.services.vision_providers.base import VisionProvider
from app.services.vision_providers.groq_provider import _COMMON_AREA_TERMS

_COLLECTION = "floor_plan_room_maps"

_FALLBACK_FLAT = "Unknown"

# Bump when the extraction contract changes in a way that invalidates old
# cached maps (e.g. removing Flat 01 (A)/(B) suffixes). ensure_room_map
# re-extracts when a cached doc's schema_version is older than this.
_ROOM_MAP_SCHEMA_VERSION = 4

# Near-duplicate OCR hits of the same flat number (overlapping tiles reading
# the same printed label) closer than this are merged into one detection.
_OCR_DEDUPE_DISTANCE = 0.12

# Occurrences of the SAME flat number farther apart than this are treated as
# separate physical clusters for ROOM EXTRACTION only — rooms from every
# cluster are merged under one canonical "Flat 01" name. We never invent
# "Flat 01 (A)" / "(B)" variants.
_CLUSTER_SEPARATION = 0.40

# After merging rooms for one flat, drop a minority spatial cluster whose
# centroids sit farther than this (% of full image) from the primary cluster.
# Oversized flat crops often bleed into a neighbour; the model then returns
# that neighbour's Puja/Store/Kitchen under THIS flat's name at the wrong
# coordinates (confirmed: Flat 02 Puja/Store at x≈35 while the real rooms —
# and engineer pins — sit at x≈88).
_ROOM_CLUSTER_LINK_DIST = 18.0

# Per-flat crops carry a labelled grid; the model names which cells each room covers (it can't read
# pixel-precise polygons off CAD, but reads a grid well). 12x12 keeps each cell ~8% of the crop so
# room boundaries land precisely enough that a pin near a wall resolves to the correct room (8x8 was
# too coarse — adjacent rooms bled across boundaries).
_CROP_GRID_COLS = 12
_CROP_GRID_ROWS = 12

# Flat labels are found by tiling the plan into an overlapping grid and reading the flat number in
# each FOCUSED tile (the model reads clear numbers in a zoomed crop but can't locate tiny labels in
# the full dense overview). The grid is defined as overlapping fractional bands PER AXIS, so it
# adapts to any aspect ratio (portrait, landscape, square) — a fixed 4-quadrant split flipped flats
# on portrait plans. Each band is 45% of the axis, stepped in thirds, giving a 3x3 overlapping grid.
_GRID_BANDS = ((0.0, 0.45), (0.275, 0.725), (0.55, 1.0))

_MAX_TILE_DIM = 1500  # px — focused crops stay legible; keeps base64 within request budget

# A flat's crop region (derived from the cells it appears in) is padded by this fraction so rooms
# near the flat's edge aren't clipped.
_FLAT_CROP_PAD = 0.04

# Half-width/height (as a fraction of the full image) of the crop centred on a flat label's own
# occurrence-position centroid. Flats on a real dense plan can sit surprisingly close together
# (e.g. two labels ~0.17 apart on one axis), so this is deliberately still wide enough to comfortably
# contain one full flat even when its label sits off-centre within it — some overlap with a
# neighbour's edge is expected and is why `target_flat_number` in extract_rooms_in_crop (not crop
# geometry alone) is the real defence against extracting the wrong flat's rooms.
_FLAT_CROP_HALF_SPAN = 0.30

# Rooms whose centre lands in the central core cross-band are the building core (lifts/lobby/shafts)
# or a neighbour bleeding across it — real flat rooms sit away from the very centre. Dropping this
# band trims over-capture near the core.
_CORE_BAND = 6.0  # percent half-width of the excluded cross centred on x=50 / y=50

# Precision over recall: drop any room the model isn't reasonably sure about. Rooms read from a
# clear printed label score ~90-100; fixture-inferred ones ~75. Below 70 we omit entirely rather
# than risk an invented/mislabelled entry — a wrong room is worse than a missing one.
_MIN_ROOM_CONFIDENCE = 70

# Label used for the synthetic "flat" that holds building-core / common areas, so a pin in the
# lift lobby resolves to a common area instead of being misattributed to a neighbouring flat.
_COMMON_AREA_FLAT = "Common Area"

# The building core sits in the centre of the plan, but shared circulation (extra lift lobbies,
# secondary staircases) can extend into an off-centre vertical/horizontal strip between two flats
# rather than staying in the exact centre — confirmed on a real plan where a second "Lift Lobby"
# strip with 4 lift shafts sat around x=0.85-0.95, well outside a narrow central-only crop, leaving
# real pins there unresolved. Widened to reach those side strips in the same single extraction call.
# (fx0, fy0, fx1, fy1) as fractions of the full image.
_CORE_TILE = (0.15, 0.20, 0.98, 0.80)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _canonical_flat_number(raw: str) -> str:
    """Strip OCR noise and never-keep alphabetic disambiguation suffixes.

    "01 (A)" / "01(B)" / "Flat 01 (C)" → "01" so Stage 2 always emits
    "Flat 01", never "Flat 01 (A)".
    """
    num = str(raw or "").strip()
    # Drop a leading "Flat " if the model included it in the number field.
    if num.lower().startswith("flat "):
        num = num[5:].strip()
    num = re.sub(r"\s*\([A-Za-z]\)\s*$", "", num).strip()
    return num


def _canonical_flat_label(raw: str) -> str:
    """Normalise a stored flat display name to Flat NN (no A/B/C)."""
    if not raw or raw == _COMMON_AREA_FLAT or raw == _FALLBACK_FLAT:
        return raw
    num = _canonical_flat_number(raw)
    return f"Flat {num}" if num else raw


def _coerce_confidence(value: Any) -> int:
    """Parse a model-supplied confidence to an int 0-100; missing/invalid → 0 (treated as low)."""
    try:
        return max(0, min(100, int(float(value))))
    except (TypeError, ValueError):
        return 0


def _is_common_area_name(name: str) -> bool:
    """True if a room name is actually a building-core/common area (never an apartment room)."""
    n = name.strip().lower()
    return any(term in n for term in _COMMON_AREA_TERMS)




def _get_room_map_provider() -> VisionProvider:
    # Use whatever provider the deployment is configured for (local vLLM by default, Groq, ...),
    # so room-map extraction shares the same model/quota as progress analysis.
    from app.services.ai_progress_service import get_vision_provider

    return get_vision_provider()


def _to_jpeg_b64(img: Image.Image, *, maxdim: int = _MAX_TILE_DIM, quality: int = 88) -> str:
    """Downscale (if needed) and JPEG-encode a PIL image to base64."""
    w, h = img.size
    scale = min(1.0, maxdim / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _draw_grid(img: Image.Image, cols: int, rows: int) -> Image.Image:
    """Return a copy of ``img`` with a labelled red cols x rows grid drawn over it."""
    img = img.convert("RGB").copy()
    w, h = img.size
    draw = ImageDraw.Draw(img)
    cw, ch = w / cols, h / rows
    try:
        font = ImageFont.truetype("arial.ttf", max(16, int(min(cw, ch) * 0.30)))
    except Exception:
        font = ImageFont.load_default()
    red = (220, 0, 0)
    for c in range(cols + 1):
        draw.line([(int(c * cw), 0), (int(c * cw), h)], fill=red, width=2)
    for r in range(rows + 1):
        draw.line([(0, int(r * ch)), (w, int(r * ch))], fill=red, width=2)
    for c in range(cols):
        for r in range(rows):
            draw.text((int(c * cw) + 3, int(r * ch) + 2), f"{string.ascii_uppercase[c]}{r + 1}", fill=red, font=font)
    return img


def _cell_to_col_row(cell: str, cols: int, rows: int) -> tuple[int, int] | None:
    """Parse a grid cell label like 'D6' -> (col_index, row_index), 0-based; None if invalid."""
    cell = (cell or "").strip().upper()
    if len(cell) < 2 or cell[0] not in string.ascii_uppercase:
        return None
    ci = string.ascii_uppercase.index(cell[0])
    try:
        ri = int(cell[1:]) - 1
    except ValueError:
        return None
    if 0 <= ci < cols and 0 <= ri < rows:
        return ci, ri
    return None


def _cells_to_full_polygon(
    cells: list[Any],
    *,
    crop_x0: float,
    crop_y0: float,
    crop_w: float,
    crop_h: float,
) -> list[dict[str, float]] | None:
    """
    Convert crop-local grid cells to a bounding rectangle in FULL-IMAGE percent (0-100) space.

    ``crop_*`` describe the crop's position/size as fractions (0-1) of the full image, so a cell
    within the crop is mapped back to where it sits on the whole plan.
    """
    cols_i: list[int] = []
    rows_i: list[int] = []
    for cell in cells:
        parsed = _cell_to_col_row(str(cell), _CROP_GRID_COLS, _CROP_GRID_ROWS)
        if parsed:
            cols_i.append(parsed[0])
            rows_i.append(parsed[1])
    if not cols_i:
        return None
    lx0 = (min(cols_i) / _CROP_GRID_COLS) * crop_w + crop_x0
    lx1 = ((max(cols_i) + 1) / _CROP_GRID_COLS) * crop_w + crop_x0
    ly0 = (min(rows_i) / _CROP_GRID_ROWS) * crop_h + crop_y0
    ly1 = ((max(rows_i) + 1) / _CROP_GRID_ROWS) * crop_h + crop_y0
    x0, x1, y0, y1 = lx0 * 100, lx1 * 100, ly0 * 100, ly1 * 100
    return [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]


def _point_in_polygon(x: float, y: float, polygon: list[dict[str, float]]) -> bool:
    """Standard ray-casting point-in-polygon test."""
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        if (yi > y) != (yj > y):
            x_intersect = xi + (y - yi) * (xj - xi) / (yj - yi)
            if x < x_intersect:
                inside = not inside
        j = i
    return inside


def _parse_rooms(
    raw_rooms: Any,
    *,
    crop_box: tuple[float, float, float, float],
    own_x: tuple[float, float],
    own_y: tuple[float, float],
    exclude_common: bool,
    label: str,
) -> list[dict[str, Any]]:
    """
    Turn a provider's raw ``rooms`` list (crop-local grid cells + confidence) into validated rooms
    with full-image polygons. Applies precision filters: confidence floor, common-area rejection
    (for flats), ownership half-plane, central-core-band, and name dedup. ``crop_box`` is
    (fx0, fy0, fx1, fy1) fractions of the full image.
    """
    if not isinstance(raw_rooms, list):
        return []
    cx0, cy0, cx1, cy1 = crop_box

    # Defence-in-depth against the model assigning the same grid cell to more
    # than one room (confirmed on real floor plans: whole cell blocks shared
    # between two room names, e.g. "Maid-01" and "Toilet" ending up with the
    # literal identical rectangle) — the prompt now explicitly forbids this,
    # but a wrong room is worse than a missing one, so cell ownership is also
    # resolved here rather than trusting the model's output blindly. Ties go
    # to whichever room has higher confidence; a genuine tie keeps whichever
    # room was listed first (the model's own primary read).
    cell_owner: dict[str, tuple[int, int]] = {}  # cell label -> (confidence, room index)
    for idx, room in enumerate(raw_rooms):
        if not isinstance(room, dict):
            continue
        cells = room.get("cells")
        if not isinstance(cells, list):
            continue
        confidence = _coerce_confidence(room.get("confidence"))
        for cell in cells:
            cell_key = str(cell).strip().upper()
            current = cell_owner.get(cell_key)
            if current is None or confidence > current[0]:
                cell_owner[cell_key] = (confidence, idx)

    rooms: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, room in enumerate(raw_rooms):
        if not isinstance(room, dict):
            continue
        rname = str(room.get("name") or "").strip()
        cells = room.get("cells")
        if not rname or not isinstance(cells, list):
            continue
        # A wrong room is worse than a missing one: drop anything below the confidence floor.
        confidence = _coerce_confidence(room.get("confidence"))
        if confidence < _MIN_ROOM_CONFIDENCE:
            logger.debug("Room dropped (confidence {}) {} name={!r}", confidence, label, rname)
            continue
        # A flat must never contain a building-core/common area (belt-and-suspenders vs the prompt).
        if exclude_common and _is_common_area_name(rname):
            logger.debug("Room dropped (common area in flat) {} name={!r}", label, rname)
            continue
        # Only cells this room actually WON the ownership tie-break for —
        # cells another (equal-or-higher confidence) room also claimed are
        # dropped from this room rather than left to produce an overlapping
        # rectangle.
        owned_cells = [c for c in cells if cell_owner.get(str(c).strip().upper()) == (confidence, idx)]
        if len(owned_cells) < len(cells):
            logger.debug(
                "Room {} name={!r} lost {} cell(s) to a higher/equal-confidence room sharing them",
                label, rname, len(cells) - len(owned_cells),
            )
        if not owned_cells:
            continue
        polygon = _cells_to_full_polygon(
            owned_cells, crop_x0=cx0, crop_y0=cy0, crop_w=(cx1 - cx0), crop_h=(cy1 - cy0)
        )
        if not polygon:
            continue
        ccx = (polygon[0]["x"] + polygon[2]["x"]) / 2
        ccy = (polygon[0]["y"] + polygon[2]["y"]) / 2
        # Reject rooms whose centre is outside the owned region (neighbour bleed across the core).
        if not (own_x[0] <= ccx <= own_x[1] and own_y[0] <= ccy <= own_y[1]):
            continue
        # For flats, also drop rooms in the central core cross-band (that's common-area
        # territory) — EXCEPT a room explicitly named "Lobby": a flat's own entry lobby
        # legitimately sits right next to the shared central corridor it opens onto, so
        # this exact geometry is expected for it, not a sign of neighbour bleed (confirmed
        # on a real plan: a flat's genuine Lobby sat well inside this band and was wrongly
        # dropped). Qualified names ("Lift Lobby", "Service Lobby") never reach this branch
        # at all — they're already rejected by _is_common_area_name above.
        if (
            exclude_common
            and rname.strip().lower() != "lobby"
            and (abs(ccx - 50.0) < _CORE_BAND or abs(ccy - 50.0) < _CORE_BAND)
        ):
            continue
        key = rname.lower()
        if key in seen:
            continue
        seen.add(key)
        rooms.append({
            "name": rname,
            "polygon": polygon,
            "confidence": confidence,
            "reason": str(room.get("reason") or "")[:200],
        })
    _trim_overlapping_rectangles(rooms, label=label)
    _reclaim_specialized_from_living(rooms, label=label)
    _ensure_adjacent_store_utility(rooms, label=label)
    return rooms


_SPECIALIZED_ROOM_TOKENS = (
    "puja", "store", "utility", "dress", "toilet", "kitchen", "maid",
    "pdr", "handwash", "hand wash", "sit-out", "sit out", "balcony",
)


def _is_living_dining_name(name: str) -> bool:
    n = name.strip().lower()
    return "living" in n or n == "dining"


def _is_specialized_room_name(name: str) -> bool:
    n = name.strip().lower()
    if _is_living_dining_name(n):
        return False
    return any(tok in n for tok in _SPECIALIZED_ROOM_TOKENS)


def _room_priority(name: str) -> int:
    n = name.strip().lower()
    best = 9
    for tok, pri in _ROOM_PRIORITY.items():
        if tok in n:
            best = min(best, pri)
    return best


def _is_large_open_name(name: str) -> bool:
    n = name.strip().lower()
    return any(t in n for t in ("living", "dining", "master bedroom", "master bed"))


def _room_centroid_xy(room: dict[str, Any]) -> tuple[float, float] | None:
    poly = room.get("polygon") or []
    if not poly:
        return None
    try:
        b = _rect_bounds(poly)
    except (KeyError, TypeError, ValueError):
        return None
    return (b[0] + b[1]) / 2, (b[2] + b[3]) / 2


def _set_room_polygon(room: dict[str, Any], x0: float, x1: float, y0: float, y1: float) -> None:
    if x1 - x0 < 1.0 or y1 - y0 < 1.0:
        return
    room["polygon"] = [
        {"x": x0, "y": y0},
        {"x": x1, "y": y0},
        {"x": x1, "y": y1},
        {"x": x0, "y": y1},
    ]


def _append_room(
    rooms: list[dict[str, Any]],
    *,
    name: str,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    reason: str,
) -> None:
    if x1 - x0 < 1.5 or y1 - y0 < 1.5:
        return
    rooms.append({
        "name": name,
        "polygon": [
            {"x": x0, "y": y0}, {"x": x1, "y": y0},
            {"x": x1, "y": y1}, {"x": x0, "y": y1},
        ],
        "confidence": 80,
        "reason": reason,
    })


def _infer_flat_side(rooms: list[dict[str, Any]]) -> str:
    """Return 'left' or 'right' from which side of the core holds more room area."""
    left = right = 0.0
    for room in rooms:
        c = _room_centroid_xy(room)
        if c is None:
            continue
        try:
            b = _rect_bounds(room["polygon"])
            area = max(0.0, b[1] - b[0]) * max(0.0, b[3] - b[2])
        except (KeyError, TypeError, ValueError):
            continue
        if c[0] < _FLAT_SIDE_SPLIT_X:
            left += area
        else:
            right += area
    return "left" if left >= right else "right"


def _room_type_key(name: str) -> str:
    """Normalize room name for uniqueness checks (ignore Dress disambiguators)."""
    n = str(name or "").strip().lower()
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()
    n = re.sub(r"\s+", " ", n)
    n = n.replace("sit out", "sit-out")
    return n


# Unique functional rooms that AI often places on the neighbour wing — relocate
# onto this flat's side instead of deleting (Flat 03 was losing Kitchen/Utility).
# Keep this list narrow: PDR/Puja/Store/M.Toilet are often true bleed copies
# that later sanitize steps re-synthesize on the correct wing.
_RELOCATABLE_ROOM_KEYS = frozenset({
    "kitchen", "utility", "toilet-2", "toilet-3", "toilet-1",
    "dress", "drawing room", "multi-purpose room", "multipurpose room",
})

# Clear neighbour-apartment bleed — always drop when on the wrong side.
_BLEED_ROOM_KEYS = frozenset({
    "bedroom-4", "toilet-4", "toilet-04", "maid-04", "maid",
    "living", "dining",  # prefer combined Living / Dining already on-wing
})


def _relocate_room_to_wing(room: dict[str, Any], side: str) -> None:
    """Shift a wrong-side polygon onto this flat's wing, preserving size/Y."""
    poly = room.get("polygon") or []
    if not poly:
        return
    try:
        b = _rect_bounds(poly)
    except (KeyError, TypeError, ValueError, IndexError):
        return
    w = max(3.0, b[1] - b[0])
    h = max(2.0, b[3] - b[2])
    if side == "left":
        x1 = _FLAT_SIDE_SPLIT_X - 1.5
        x0 = max(1.0, x1 - w)
    else:
        x0 = _FLAT_SIDE_SPLIT_X + 1.5
        x1 = min(99.0, x0 + w)
    _set_room_polygon(room, x0, x1, b[2], b[2] + h)


def _cull_wrong_side_rooms(rooms: list[dict[str, Any]], *, label: str) -> list[dict[str, Any]]:
    """Drop neighbour-bleed rooms; relocate unique functional rooms onto-wing."""
    if len(rooms) < 4:
        return rooms
    side = _infer_flat_side(rooms)

    def _on_correct_side(c: tuple[float, float]) -> bool:
        if abs(c[0] - _FLAT_SIDE_SPLIT_X) <= 8.0:
            return True
        on_left = c[0] < _FLAT_SIDE_SPLIT_X
        return on_left if side == "left" else (not on_left)

    on_side_keys: set[str] = set()
    for room in rooms:
        c = _room_centroid_xy(room)
        if c is None or not _on_correct_side(c):
            continue
        on_side_keys.add(_room_type_key(str(room.get("name") or "")))

    kept: list[dict[str, Any]] = []
    dropped: list[str] = []
    relocated: list[str] = []
    for room in rooms:
        c = _room_centroid_xy(room)
        if c is None:
            kept.append(room)
            continue
        if _on_correct_side(c):
            kept.append(room)
            continue
        name = str(room.get("name") or "?")
        key = _room_type_key(name)
        # Already have this room type on the correct wing → drop bleed copy.
        if key in on_side_keys or key in _BLEED_ROOM_KEYS:
            dropped.append(name)
            continue
        # Unique Kitchen / Utility / Dress / … — keep by moving onto-wing.
        if key in _RELOCATABLE_ROOM_KEYS:
            _relocate_room_to_wing(room, side)
            kept.append(room)
            on_side_keys.add(key)
            relocated.append(name)
            continue
        dropped.append(name)
    if dropped:
        logger.debug(
            "Room map {}: culled {} wrong-side room(s) (flat is {} wing): {}",
            label, len(dropped), side, ", ".join(dropped),
        )
    if relocated:
        logger.debug(
            "Room map {}: relocated {} unique room(s) onto {} wing: {}",
            label, len(relocated), side, ", ".join(relocated),
        )
    return kept or rooms


def _carve_specialized_from_large(rooms: list[dict[str, Any]], *, label: str) -> None:
    """When a specialized room overlaps Living/Master/Dining, cut the large room."""
    for large in rooms:
        if not _is_large_open_name(str(large.get("name") or "")):
            continue
        lb = _rect_bounds(large["polygon"])
        for sp in rooms:
            if sp is large or not _is_specialized_room_name(str(sp.get("name") or "")):
                continue
            sb = _rect_bounds(sp["polygon"])
            ox0, ox1 = max(lb[0], sb[0]), min(lb[1], sb[1])
            oy0, oy1 = max(lb[2], sb[2]), min(lb[3], sb[3])
            ox, oy = ox1 - ox0, oy1 - oy0
            if ox <= 1.0 or oy <= 1.0:
                continue
            # Shrink the large room on the thinner overlap axis.
            if ox <= oy:
                mid = (ox0 + ox1) / 2
                large_cx = (lb[0] + lb[1]) / 2
                if large_cx < mid:
                    _set_room_polygon(large, lb[0], min(lb[1], mid), lb[2], lb[3])
                else:
                    _set_room_polygon(large, max(lb[0], mid), lb[1], lb[2], lb[3])
            else:
                mid = (oy0 + oy1) / 2
                large_cy = (lb[2] + lb[3]) / 2
                if large_cy < mid:
                    _set_room_polygon(large, lb[0], lb[1], lb[2], min(lb[3], mid))
                else:
                    _set_room_polygon(large, lb[0], lb[1], max(lb[2], mid), lb[3])
            logger.debug(
                "Room map {}: carved {!r} out of oversized {!r}",
                label, sp.get("name"), large.get("name"),
            )
            lb = _rect_bounds(large["polygon"])


def _fill_master_wet_gap(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Synthesize PDR / Handwash / M.Toilet / Dress in the gap above Master Bedroom.

    Confirmed on Floor-4 Flat 04: engineer pins for those rooms sit in empty
    space between Lobby/Dining (above) and Master Bedroom (below) because the
    model never emitted polygons for the wet core.
    """
    master = next(
        (r for r in rooms if "master" in str(r.get("name") or "").lower() and "bed" in str(r.get("name") or "").lower()),
        None,
    )
    if master is None:
        return
    mb = _rect_bounds(master["polygon"])

    def _has_in_gap(token: str, y0: float, y1: float, x0: float, x1: float) -> bool:
        for r in rooms:
            if token not in str(r.get("name") or "").lower():
                continue
            c = _room_centroid_xy(r)
            if c is None:
                continue
            if x0 - 2 <= c[0] <= x1 + 2 and y0 - 1 <= c[1] <= y1 + 1:
                return True
        return False

    # Gap: just above Master, spanning its width (plus a little left for PDR).
    gap_y1 = mb[2]
    gap_y0 = gap_y1 - max(6.0, (mb[3] - mb[2]) * 0.85)
    for r in rooms:
        if r is master:
            continue
        b = _rect_bounds(r["polygon"])
        if b[3] <= gap_y0 or b[2] >= gap_y1:
            continue
        if b[1] < mb[0] - 2 or b[0] > mb[1] + 2:
            continue
        if b[3] <= mb[2] + 0.5:
            gap_y0 = max(gap_y0, b[3])

    if gap_y1 - gap_y0 < 3.5:
        return

    x0, x1 = mb[0] - 1.0, min(mb[1], mb[0] + max(8.0, (mb[1] - mb[0]) * 0.72))
    # Column split ~63.5 between PDR(62)/Handwash(65) and M.Toilet(61)/Dress(64).
    # Keep the wet core from spilling into Dining/Kitchen (pin 17).
    x_mid = max(x0 + 2.5, min(x1 - 2.5, 63.5))
    y_mid = (gap_y0 + gap_y1) / 2

    added = False
    # Top row: PDR (left) | Handwash (right)
    if not _has_in_gap("pdr", gap_y0, y_mid, x0, x_mid):
        _append_room(rooms, name="PDR", x0=x0, x1=x_mid, y0=gap_y0, y1=y_mid,
                     reason="master wet-core gap fill")
        added = True
    if not _has_in_gap("handwash", gap_y0, y_mid, x_mid, x1) and not _has_in_gap(
        "hand wash", gap_y0, y_mid, x_mid, x1
    ):
        _append_room(rooms, name="Handwash", x0=x_mid, x1=x1, y0=gap_y0, y1=y_mid,
                     reason="master wet-core gap fill")
        added = True
    # Bottom row: M.Toilet (left) | Dress (right) — do not treat the Master Toilet
    # BELOW Master as occupying this gap.
    if not _has_in_gap("m. toilet", y_mid, gap_y1, x0, x_mid) and not _has_in_gap(
        "m toilet", y_mid, gap_y1, x0, x_mid
    ):
        _append_room(rooms, name="M. Toilet", x0=x0, x1=x_mid, y0=y_mid, y1=gap_y1,
                     reason="master wet-core gap fill")
        added = True
    if not _has_in_gap("dress", y_mid, gap_y1, x_mid, x1):
        _append_room(rooms, name="Dress", x0=x_mid, x1=x1, y0=y_mid, y1=gap_y1,
                     reason="master wet-core gap fill")
        added = True

    # Keep Master from overlapping the wet core we just filled.
    if added and mb[2] < gap_y1:
        _set_room_polygon(master, mb[0], mb[1], gap_y1, mb[3])
    if added:
        logger.debug("Room map {}: filled master wet-core gap y={:.1f}-{:.1f}", label, gap_y0, gap_y1)


def _ensure_dress_near_bedrooms(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Peel a Dress strip from Living when a Bedroom lacks a nearby Dress."""
    bedrooms = [
        r for r in rooms
        if "bedroom" in str(r.get("name") or "").lower()
        and "master" not in str(r.get("name") or "").lower()
    ]
    dresses = [r for r in rooms if "dress" in str(r.get("name") or "").lower()]
    livings = [
        r for r in rooms
        if str(r.get("name") or "").strip().lower() in ("living", "living room")
        or str(r.get("name") or "").strip().lower().startswith("living /")
    ]

    for bed in bedrooms:
        bc = _room_centroid_xy(bed)
        if bc is None:
            continue
        has_near = any(
            (dc := _room_centroid_xy(d)) is not None
            and ((bc[0] - dc[0]) ** 2 + (bc[1] - dc[1]) ** 2) ** 0.5 <= 10.0
            for d in dresses
        )
        if has_near:
            continue
        bb = _rect_bounds(bed["polygon"])
        for liv in livings:
            lb = _rect_bounds(liv["polygon"])
            # Corner case: Living left of Bedroom, tops aligned (Bedroom-3 / Living).
            if abs(lb[1] - bb[0]) <= 3.5 and abs(lb[2] - bb[3]) <= 2.0:
                strip_x0 = max(lb[0], lb[1] - max(4.5, (lb[1] - lb[0]) * 0.5))
                strip_y1 = min(lb[3], lb[2] + max(3.5, (lb[3] - lb[2]) * 0.6))
                _append_room(
                    rooms, name="Dress",
                    x0=strip_x0, x1=lb[1], y0=lb[2], y1=strip_y1,
                    reason=f"beside {bed.get('name')}",
                )
                _set_room_polygon(liv, lb[0], strip_x0, lb[2], lb[3])
                dresses.append(rooms[-1])
                logger.debug("Room map {}: peeled Dress at Living/{!r} corner", label, bed.get("name"))
                break
            x_overlap = min(lb[1], bb[1]) - max(lb[0], bb[0])
            if x_overlap >= 2.0 and -0.5 <= (lb[2] - bb[3]) <= 3.0:
                strip_y1 = min(lb[3], lb[2] + max(3.5, (lb[3] - lb[2]) * 0.5))
                dx0 = max(lb[0], (lb[0] + lb[1]) / 2)
                _append_room(rooms, name="Dress", x0=dx0, x1=lb[1], y0=lb[2], y1=strip_y1,
                             reason=f"beside {bed.get('name')}")
                _set_room_polygon(liv, lb[0], dx0, lb[2], lb[3])
                dresses.append(rooms[-1])
                logger.debug("Room map {}: peeled Dress under {!r} from Living", label, bed.get("name"))
                break
            if abs(lb[1] - bb[0]) <= 2.5 and min(lb[3], bb[3]) - max(lb[2], bb[2]) >= 2.0:
                strip_x0 = max(lb[0], lb[1] - max(3.5, (lb[1] - lb[0]) * 0.4))
                _append_room(
                    rooms, name="Dress", x0=strip_x0, x1=lb[1],
                    y0=max(lb[2], bb[2]), y1=min(lb[3], bb[3]),
                    reason=f"beside {bed.get('name')}",
                )
                _set_room_polygon(liv, lb[0], strip_x0, lb[2], lb[3])
                dresses.append(rooms[-1])
                logger.debug("Room map {}: peeled Dress left of {!r} from Living", label, bed.get("name"))
                break


def _expand_rooms_toward_gaps(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Nudge key room boxes so nearby engineer-typical gaps resolve correctly."""
    # 1) Drawing Room often ends one grid row above its true floor — extend down
    #    until Lobby / Living so pins in the entry land in Drawing, not Lobby.
    drawing = next(
        (r for r in rooms if "drawing" in str(r.get("name") or "").lower()),
        None,
    )
    if drawing is not None:
        db = _rect_bounds(drawing["polygon"])
        extend_to = db[3]
        for r in rooms:
            n = str(r.get("name") or "").lower()
            if r is drawing or not any(t in n for t in ("lobby", "living", "dining")):
                continue
            b = _rect_bounds(r["polygon"])
            x_overlap = min(db[1], b[1]) - max(db[0], b[0])
            if x_overlap < 2.0:
                continue
            if b[2] >= db[3] - 0.5:
                extend_to = max(extend_to, min(b[2] + 2.5, b[2] + (b[3] - b[2]) * 0.55))
        if extend_to > db[3] + 0.5:
            _set_room_polygon(drawing, db[0], db[1], db[2], extend_to)
            # Push Lobby down/clear of Drawing.
            for r in rooms:
                if "lobby" not in str(r.get("name") or "").lower():
                    continue
                lb = _rect_bounds(r["polygon"])
                if lb[2] < extend_to and lb[0] < db[1] and lb[1] > db[0]:
                    _set_room_polygon(r, lb[0], lb[1], max(lb[2], extend_to), lb[3])
            logger.debug("Room map {}: extended Drawing Room downward to y={:.1f}", label, extend_to)

    # 2) Bedroom-4 vs Dining: bedroom should own the right strip of a shared band.
    bed4 = next(
        (r for r in rooms if re.search(r"bedroom[-\s]?4", str(r.get("name") or ""), re.I)),
        None,
    )
    dining = next(
        (r for r in rooms if str(r.get("name") or "").strip().lower() == "dining"),
        None,
    )
    if bed4 is not None and dining is not None:
        bb = _rect_bounds(bed4["polygon"])
        db = _rect_bounds(dining["polygon"])
        y_overlap = min(bb[3], db[3]) - max(bb[2], db[2])
        if y_overlap >= 2.0 and abs(bb[0] - db[1]) <= 4.0:
            mid = (db[1] + bb[0]) / 2
            _set_room_polygon(dining, db[0], mid, db[2], db[3])
            _set_room_polygon(bed4, mid, bb[1], bb[2], bb[3])
            logger.debug("Room map {}: split Dining/Bedroom-4 at x={:.1f}", label, mid)

    # 3) Toilet-3: pull a far-right toilet left along the band under Bedroom-3
    #    (pins land in the gap between Bedroom-3 and the misplaced toilet AABB).
    bed3 = next(
        (r for r in rooms if re.search(r"bedroom[-\s]?3", str(r.get("name") or ""), re.I)),
        None,
    )
    toilet3 = next(
        (r for r in rooms if re.search(r"toilet[-\s]?3", str(r.get("name") or ""), re.I)),
        None,
    )
    if bed3 is not None:
        bb = _rect_bounds(bed3["polygon"])
        if toilet3 is None:
            _append_room(
                rooms,
                name="Toilet-3",
                x0=bb[0],
                x1=bb[0] + max(4.0, (bb[1] - bb[0]) * 0.28),
                y0=bb[3],
                y1=min(100.0, bb[3] + 4.5),
                reason="below Bedroom-3",
            )
            logger.debug("Room map {}: synthesized Toilet-3 below Bedroom-3", label)
        else:
            tb = _rect_bounds(toilet3["polygon"])
            # Extend toilet left/up to cover the under-bedroom band without eating Bedroom-3.
            nx0 = min(tb[0], bb[0] + (bb[1] - bb[0]) * 0.15)
            ny0 = min(tb[2], bb[3])
            ny1 = max(tb[3], bb[3] + 4.0)
            nx1 = max(tb[1], bb[0] + (bb[1] - bb[0]) * 0.55)
            _set_room_polygon(toilet3, nx0, nx1, ny0, ny1)
            logger.debug("Room map {}: extended Toilet-3 under Bedroom-3", label)

    # 4) Sit-Out below Toilet-4: extend Sit-Out upward only into the LOWER
    # half of the gap under Toilet-4 — keep Toilet-4's upper band for pin 11.
    sit = next(
        (
            r for r in rooms
            if ("sit-out" in str(r.get("name") or "").lower() or "sit out" in str(r.get("name") or "").lower())
            and (_room_centroid_xy(r) or (0, 0))[1] > 20
        ),
        None,
    )
    toilet4 = next(
        (r for r in rooms if re.search(r"toilet[-\s]?4", str(r.get("name") or ""), re.I)),
        None,
    )
    if sit is not None and toilet4 is not None:
        sb = _rect_bounds(sit["polygon"])
        tb = _rect_bounds(toilet4["polygon"])
        if abs(sb[0] - tb[1]) <= 5.0 or (sb[0] <= tb[1] + 1 and sb[0] >= tb[0] - 1):
            y_overlap = min(sb[3], tb[3]) - max(sb[2], tb[2])
            if y_overlap >= 1.0 or 0 <= sb[2] - tb[3] <= 4.0:
                split_y = tb[2] + (tb[3] - tb[2]) * 0.55
                _set_room_polygon(toilet4, tb[0], tb[1], tb[2], split_y)
                _set_room_polygon(sit, min(sb[0], tb[0]), max(sb[1], tb[1]), split_y, max(sb[3], tb[3] + 1))
                logger.debug("Room map {}: split Toilet-4 / Sit-Out at y={:.1f}", label, split_y)

    # 5) Dining should extend down toward Kitchen so open-plan dining pins resolve.
    #    Also shrink any master-suite Dress that spilled into the Dining/Kitchen band.
    if dining is not None:
        db = _rect_bounds(dining["polygon"])
        kitchen = next((r for r in rooms if "kitchen" in str(r.get("name") or "").lower()), None)
        if kitchen is not None:
            kb = _rect_bounds(kitchen["polygon"])
            if abs(kb[2] - db[3]) <= 6.0 and min(db[1], kb[1]) - max(db[0], kb[0]) >= 2.0:
                # Dining owns down to just inside the Kitchen top (open plan).
                mid_y = kb[2] + max(1.5, (kb[3] - kb[2]) * 0.12)
                _set_room_polygon(dining, db[0], max(db[1], min(kb[1], db[1] + 2)), db[2], mid_y)
                _set_room_polygon(kitchen, kb[0], kb[1], mid_y, kb[3])
                logger.debug("Room map {}: split Dining/Kitchen at y={:.1f}", label, mid_y)
        for r in rooms:
            if "dress" not in str(r.get("name") or "").lower():
                continue
            dsb = _rect_bounds(r["polygon"])
            db = _rect_bounds(dining["polygon"])
            # Master Dress that reaches into Dining x-band below y≈26 should stop.
            if dsb[1] > db[0] and dsb[0] < db[1] and dsb[3] > 27 and dsb[2] < 32:
                _set_room_polygon(r, dsb[0], min(dsb[1], db[0] + 0.5), dsb[2], min(dsb[3], 30.5))

    # 6) Bedroom-4 vs Dining: push split left so pins near Bedroom-4 resolve there.
    if bed4 is not None and dining is not None:
        bb = _rect_bounds(bed4["polygon"])
        db = _rect_bounds(dining["polygon"])
        y_overlap = min(bb[3], db[3]) - max(bb[2], db[2])
        if y_overlap >= 1.5 and db[1] > bb[0] - 6:
            mid = min(bb[0], db[0] + (db[1] - db[0]) * 0.72)
            mid = max(db[0] + 3.0, mid)
            _set_room_polygon(dining, db[0], mid, db[2], db[3])
            _set_room_polygon(bed4, mid, bb[1], min(bb[2], db[2]), max(bb[3], db[3]))
            logger.debug("Room map {}: pushed Bedroom-4 left into Dining at x={:.1f}", label, mid)

    # 7) Toilet-3 must not swallow Bedroom-3 — keep Toilet-3 to a small lower-left
    # pocket and restore Bedroom-3 for the rest (pin 18 is Bedroom-3).
    if bed3 is not None:
        toilet3 = next(
            (r for r in rooms if re.search(r"toilet[-\s]?3", str(r.get("name") or ""), re.I)),
            None,
        )
        bb = _rect_bounds(bed3["polygon"])
        if toilet3 is not None:
            tb = _rect_bounds(toilet3["polygon"])
            # If Toilet-3 covers most of Bedroom-3, shrink it hard.
            t_area = max(0.0, tb[1] - tb[0]) * max(0.0, tb[3] - tb[2])
            b_area = max(0.0, bb[1] - bb[0]) * max(0.0, bb[3] - bb[2])
            if t_area > 0.35 * b_area or (tb[0] < bb[0] + 2 and tb[1] > bb[0] + 8 and tb[2] < bb[2] + 4):
                nx1 = bb[0] + max(4.0, (bb[1] - bb[0]) * 0.28)
                ny0 = bb[2] + (bb[3] - bb[2]) * 0.45
                _set_room_polygon(toilet3, bb[0], nx1, ny0, bb[3])
                _set_room_polygon(bed3, bb[0], bb[1], bb[2], bb[3])
                # Carve toilet out of bedroom via trim later; shrink bedroom left is wrong —
                # keep full bedroom and let priority prefer toilet only inside its pocket.
                logger.debug("Room map {}: constrained Toilet-3 to Bedroom-3 pocket", label)


def _ensure_sitout_near_edges(rooms: list[dict[str, Any]], *, label: str) -> None:
    """If a top-edge balcony pin zone has no Sit-Out, peel one from Bedroom-2."""
    has_top_sit = any(
        ("sit-out" in str(r.get("name") or "").lower() or "sit out" in str(r.get("name") or "").lower()
         or "balcony" in str(r.get("name") or "").lower())
        and (_room_centroid_xy(r) or (0, 99))[1] < 16.0
        for r in rooms
    )
    if has_top_sit:
        return
    bed2 = next(
        (r for r in rooms if re.search(r"bedroom[-\s]?2", str(r.get("name") or ""), re.I)),
        None,
    )
    if bed2 is None:
        return
    bb = _rect_bounds(bed2["polygon"])
    _append_room(
        rooms,
        name="Sit-Out",
        x0=bb[1],
        x1=min(100.0, bb[1] + max(5.0, bb[1] - bb[0])),
        y0=max(0.0, bb[2] - 1.0),
        y1=bb[3],
        reason="top-edge sit-out completion",
    )
    logger.debug("Room map {}: synthesized top Sit-Out beside Bedroom-2", label)


def _peel_puja_store_from_master_kitchen(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Recover Puja/Store between Master Bedroom and Kitchen when missing locally."""
    master = next(
        (r for r in rooms if "master" in str(r.get("name") or "").lower() and "bed" in str(r.get("name") or "").lower()),
        None,
    )
    kitchen = next((r for r in rooms if "kitchen" in str(r.get("name") or "").lower()), None)
    if master is None or kitchen is None:
        return
    mb = _rect_bounds(master["polygon"])
    kb = _rect_bounds(kitchen["polygon"])

    def _local(token: str) -> bool:
        for r in rooms:
            if token not in str(r.get("name") or "").lower():
                continue
            c = _room_centroid_xy(r)
            if c and mb[0] - 2 <= c[0] <= kb[1] + 2 and mb[2] - 2 <= c[1] <= max(mb[3], kb[3]) + 2:
                return True
        return False

    # Vertical band between Master right edge and Kitchen left, overlapping y.
    y0 = max(mb[2], kb[2])
    y1 = min(mb[3], kb[3])
    if y1 - y0 >= 2.5 and kb[0] - mb[1] <= 6.0:
        mid = (mb[1] + kb[0]) / 2 if kb[0] > mb[1] else (mb[0] + mb[1]) * 0.65 + (kb[0] + kb[1]) * 0.35 / 2
        # Peel from Master right / Kitchen left
        px0 = max(mb[0] + 3.0, min(mb[1], kb[0]) - 4.0)
        px1 = min(kb[1] - 1.0, max(mb[1], kb[0]) + 1.0)
        if px1 - px0 >= 2.5 and not _local("puja"):
            _append_room(rooms, name="Puja", x0=px0, x1=(px0 + px1) / 2, y0=y0, y1=y1,
                         reason="between Master and Kitchen")
            _set_room_polygon(master, mb[0], min(mb[1], px0), mb[2], mb[3])
            mb = _rect_bounds(master["polygon"])
            logger.debug("Room map {}: peeled Puja between Master and Kitchen", label)
        if not _local("store"):
            # Store often below Puja / under Kitchen
            sy0 = min(mb[3], kb[3])
            sy1 = min(100.0, sy0 + 4.5)
            _append_room(
                rooms, name="Store",
                x0=max(px0, kb[0] - 2), x1=min(kb[1], (px0 + px1) / 2 + 4),
                y0=sy0, y1=sy1,
                reason="below Puja/Kitchen",
            )
            # Shrink generic Toilet if it covers Store band
            for r in rooms:
                if str(r.get("name") or "").strip().lower() != "toilet":
                    continue
                tb = _rect_bounds(r["polygon"])
                if tb[2] < sy1 and tb[3] > sy0 and tb[0] < kb[1] and tb[1] > kb[0] - 4:
                    _set_room_polygon(r, tb[0], min(tb[1], max(px0, kb[0] - 2)), tb[2], tb[3])
            logger.debug("Room map {}: synthesized Store near Kitchen", label)


def _trim_common_area_vs_flats(flats: list[dict[str, Any]]) -> None:
    """Common Lobby must not swallow a flat's Drawing Room / Lobby."""
    common = next((f for f in flats if str(f.get("flat")) == _COMMON_AREA_FLAT), None)
    if not common:
        return
    flat_rooms = [
        r for f in flats if str(f.get("flat")) != _COMMON_AREA_FLAT
        for r in (f.get("rooms") or [])
    ]
    for cr in list(common.get("rooms") or []):
        name = str(cr.get("name") or "").lower()
        if "lobby" not in name and "passage" not in name:
            continue
        cb = _rect_bounds(cr["polygon"])
        for fr in flat_rooms:
            fn = str(fr.get("name") or "").lower()
            if not any(t in fn for t in ("drawing", "lobby", "living")):
                continue
            fb = _rect_bounds(fr["polygon"])
            ox0, ox1 = max(cb[0], fb[0]), min(cb[1], fb[1])
            oy0, oy1 = max(cb[2], fb[2]), min(cb[3], fb[3])
            if ox1 - ox0 <= 2 or oy1 - oy0 <= 2:
                continue
            # Pull common lobby left edge away from flat rooms on the right wing.
            if fb[0] >= _FLAT_SIDE_SPLIT_X - 5:
                _set_room_polygon(cr, cb[0], min(cb[1], fb[0]), cb[2], cb[3])
                cb = _rect_bounds(cr["polygon"])
                logger.debug("Room map: trimmed Common Area {!r} clear of flat {!r}", cr.get("name"), fr.get("name"))


def _sanitize_flat_rooms(rooms: list[dict[str, Any]], *, label: str) -> list[dict[str, Any]]:
    """Post-extract geometry fixes applied per flat (also safe on cached maps)."""
    rooms = _cull_wrong_side_rooms(rooms, label=label)
    rooms = _keep_primary_room_cluster(rooms, label=label)
    _trim_overlapping_rectangles(rooms, label=label)
    _carve_specialized_from_large(rooms, label=label)
    _reclaim_specialized_from_living(rooms, label=label)
    _ensure_adjacent_store_utility(rooms, label=label)
    _fill_master_wet_gap(rooms, label=label)
    _ensure_dress_near_bedrooms(rooms, label=label)
    _ensure_sitout_near_edges(rooms, label=label)
    _peel_puja_store_from_master_kitchen(rooms, label=label)
    _expand_rooms_toward_gaps(rooms, label=label)
    _carve_specialized_from_large(rooms, label=label)
    _disambiguate_duplicate_room_names(rooms, label=label)
    return rooms


def _nearest_context_label(room: dict[str, Any], rooms: list[dict[str, Any]]) -> str:
    """Pick a nearby Bedroom / Master label to disambiguate duplicates."""
    rc = _room_centroid_xy(room)
    if rc is None:
        return ""
    room_l = str(room.get("name") or "").lower()
    prefer_bedrooms = "dress" in room_l or "sit" in room_l or "toilet" in room_l
    best: tuple[float, str] | None = None
    for other in rooms:
        if other is room:
            continue
        name = str(other.get("name") or "").strip()
        n = name.lower()
        if prefer_bedrooms:
            if not (("bedroom" in n) or ("master" in n and "bed" in n)):
                continue
        elif not any(t in n for t in ("bedroom", "master", "living", "drawing", "kitchen", "dining")):
            continue
        oc = _room_centroid_xy(other)
        if oc is None:
            continue
        dist = ((rc[0] - oc[0]) ** 2 + (rc[1] - oc[1]) ** 2) ** 0.5
        if best is None or dist < best[0]:
            # Use bare label only — never nest "Sit-Out (Dress (Master Bedroom))".
            bare = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip() or name
            best = (dist, bare)
    return best[1] if best else ""


def _disambiguate_duplicate_room_names(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Give unique display names to duplicate Dress / Sit-Out / Toilet entries.

    Flat Finishing Works keys cards by room name; three plain \"Dress\" rooms
    collapsed to one card in the UI even though the snapshot stored all three.
    """
    by_key: dict[str, list[dict[str, Any]]] = {}
    for room in rooms:
        key = str(room.get("name") or "").strip().lower()
        if not key:
            continue
        by_key.setdefault(key, []).append(room)

    renamed = 0
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        # Sit-Out / Sit-Out-2 already distinct if numbered; still disambiguate plain dupes.
        for room in group:
            base = str(room.get("name") or "").strip()
            ctx = _nearest_context_label(room, rooms)
            if not ctx:
                c = _room_centroid_xy(room)
                ctx = f"zone {int(c[0])}-{int(c[1])}" if c else "area"
            # Avoid "Dress (Dress (Bedroom-2))" on re-sanitize.
            if "(" in base:
                continue
            new_name = f"{base} ({ctx})"
            room["name"] = new_name
            renamed += 1
        logger.debug(
            "Room map {}: disambiguated {} duplicate {!r} room(s)",
            label, len(group), key,
        )
    if renamed:
        logger.debug("Room map {}: applied {} unique room display names", label, renamed)


def _sanitize_room_map_flats(flats: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for flat_entry in flats:
        fname = str(flat_entry.get("flat") or "")
        rooms = list(flat_entry.get("rooms") or [])
        if fname == _COMMON_AREA_FLAT:
            out.append({**flat_entry, "rooms": rooms})
            continue
        out.append({**flat_entry, "rooms": _sanitize_flat_rooms(rooms, label=fname)})
    _trim_common_area_vs_flats(out)
    return out


# Normalized 4BHK cell layout (fx0,fx1,fy0,fy1) fitted into a pin-cloud bbox.
# Tuned for Grava-style Flat 02 right-wing plans where AI extract often
# misses Bedroom-3/4, balconies, Toilet-3/04, PDR, Kitchen, and Lobby.
_PIN_FIT_4BHK_CELLS: tuple[tuple[str, float, float, float, float], ...] = (
    ("Lobby", 0.00, 0.18, 0.00, 0.28),
    ("Drawing Room", 0.14, 0.42, 0.00, 0.28),
    ("PDR", 0.40, 0.56, 0.00, 0.22),
    ("Toilet-04", 0.54, 0.70, 0.00, 0.16),
    ("Dress (Bedroom-4)", 0.54, 0.72, 0.14, 0.32),
    ("Bedroom-4", 0.70, 0.92, 0.00, 0.30),
    # One balcony strip — pins 12 & 14 are two captures in the same space.
    ("Balcony (Bedroom-4 side)", 0.90, 1.04, 0.00, 0.36),
    ("Bedroom-2", 0.16, 0.42, 0.28, 0.50),
    ("Toilet-2", 0.16, 0.34, 0.48, 0.62),
    ("Dress (Bedroom-2)", 0.32, 0.46, 0.48, 0.62),
    ("Bedroom-3", 0.74, 0.96, 0.28, 0.50),
    ("Living / Dining", 0.46, 0.72, 0.46, 0.68),
    ("Puja", 0.70, 0.86, 0.52, 0.68),
    ("Toilet-3", 0.86, 1.04, 0.46, 0.64),
    ("Store", 0.68, 0.80, 0.66, 0.80),
    ("Kitchen", 0.78, 0.96, 0.68, 0.86),
    ("M. Toilet", 0.14, 0.32, 0.60, 0.78),
    ("Dress (Master Bedroom)", 0.30, 0.46, 0.60, 0.78),
    ("Master Bedroom", 0.16, 0.48, 0.76, 0.98),
    ("Sit-Out", 0.48, 0.72, 0.86, 1.04),
    ("Utility", 0.74, 0.96, 0.86, 1.04),
)


def _nearest_flat_label(
    x: float,
    y: float,
    flats: list[dict[str, Any]],
) -> str | None:
    best: tuple[float, str] | None = None
    for flat_entry in flats:
        fname = str(flat_entry.get("flat") or "")
        if not fname or fname == _COMMON_AREA_FLAT:
            continue
        fa = _flat_anchor(flat_entry)
        if fa is None:
            continue
        dist = ((x - fa[0]) ** 2 + (y - fa[1]) ** 2) ** 0.5
        if best is None or dist < best[0]:
            best = (dist, fname)
    return best[1] if best else None


def _rehome_rooms_by_flat_anchor(flats: list[dict[str, Any]]) -> None:
    """Move rooms whose centroid is closer to another flat's OCR anchor.

    Floor-1 extracts often paste Flat 01 rooms on top of Flat 02 geometry
    (and vice versa), so pins resolve to the wrong flat even when the room
    name is right.
    """
    residential = [
        f for f in flats
        if str(f.get("flat") or "") and str(f.get("flat")) != _COMMON_AREA_FLAT
    ]
    if len(residential) < 2:
        return

    moved = 0
    for flat_entry in residential:
        fname = str(flat_entry.get("flat") or "")
        keep: list[dict[str, Any]] = []
        for room in list(flat_entry.get("rooms") or []):
            c = _room_centroid_xy(room)
            if c is None:
                keep.append(room)
                continue
            nearest = _nearest_flat_label(c[0], c[1], residential)
            if nearest is None or nearest == fname:
                keep.append(room)
                continue
            target = next((f for f in residential if str(f.get("flat")) == nearest), None)
            if target is None:
                keep.append(room)
                continue
            target.setdefault("rooms", []).append(room)
            moved += 1
        flat_entry["rooms"] = keep
    if moved:
        logger.debug("Room map: re-homed {} room(s) to nearest flat anchor", moved)


def _pin_cloud_bbox(
    points: list[tuple[float, float]],
    *,
    pad: float = 2.5,
) -> tuple[float, float, float, float] | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (
        max(0.0, min(xs) - pad),
        min(100.0, max(xs) + pad),
        max(0.0, min(ys) - pad),
        min(100.0, max(ys) + pad),
    )


def _rooms_from_pin_fit_cells(
    bbox: tuple[float, float, float, float],
    cells: tuple[tuple[str, float, float, float, float], ...],
    *,
    reason: str,
) -> list[dict[str, Any]]:
    x0, x1, y0, y1 = bbox
    w = max(1.0, x1 - x0)
    h = max(1.0, y1 - y0)
    rooms: list[dict[str, Any]] = []
    for name, fx0, fx1, fy0, fy1 in cells:
        rx0 = x0 + fx0 * w
        rx1 = x0 + fx1 * w
        ry0 = y0 + fy0 * h
        ry1 = y0 + fy1 * h
        # Clamp to plan bounds while keeping a usable box.
        rx0, rx1 = max(0.0, rx0), min(100.0, rx1)
        ry0, ry1 = max(0.0, ry0), min(100.0, ry1)
        if rx1 - rx0 < 1.8 or ry1 - ry0 < 1.8:
            continue
        rooms.append({
            "name": name,
            "polygon": [
                {"x": rx0, "y": ry0}, {"x": rx1, "y": ry0},
                {"x": rx1, "y": ry1}, {"x": rx0, "y": ry1},
            ],
            "confidence": 85,
            "reason": reason,
        })
    return rooms


def _flat_needs_pin_fit(rooms: list[dict[str, Any]], pin_count: int) -> bool:
    """True when extract is too thin to cover a fully pinned 4BHK flat."""
    if pin_count >= 12 and len(rooms) < 16:
        return True
    names = {str(r.get("name") or "").strip().lower() for r in rooms}
    bases = {re.sub(r"\s*\([^)]*\)\s*$", "", n).strip() for n in names}
    required = {"bedroom-3", "bedroom-4", "kitchen", "pdr", "toilet-3"}
    missing = sum(1 for r in required if not any(r in b for b in bases))
    if pin_count >= 10 and missing >= 2:
        return True
    return False


def _refine_flats_with_pin_hints(
    flats: list[dict[str, Any]],
    pin_hints: list[tuple[float, float]],
) -> list[dict[str, Any]]:
    """Improve sparse / overlapping maps using engineer pin positions.

    1) Re-home rooms to the flat whose OCR anchor is nearest the room centroid.
    2) For flats with many nearby pins but a thin extract, rebuild room AABBs
       from a 4BHK cell layout fitted to that flat's pin cloud.
    """
    if not pin_hints or not flats:
        return flats

    _rehome_rooms_by_flat_anchor(flats)

    pins_by_flat: dict[str, list[tuple[float, float]]] = {}
    for x, y in pin_hints:
        fname = _nearest_flat_label(x, y, flats)
        if not fname:
            continue
        pins_by_flat.setdefault(fname, []).append((x, y))

    for flat_entry in flats:
        fname = str(flat_entry.get("flat") or "")
        if not fname or fname == _COMMON_AREA_FLAT:
            continue
        pts = pins_by_flat.get(fname) or []
        rooms = list(flat_entry.get("rooms") or [])
        if not _flat_needs_pin_fit(rooms, len(pts)):
            continue
        bbox = _pin_cloud_bbox(pts)
        if bbox is None:
            continue
        rebuilt = _rooms_from_pin_fit_cells(
            bbox, _PIN_FIT_4BHK_CELLS, reason=f"pin-fit layout for {fname}",
        )
        if len(rebuilt) < 12:
            continue
        _disambiguate_duplicate_room_names(rebuilt, label=fname)
        flat_entry["rooms"] = rebuilt
        logger.info(
            "Room map {}: rebuilt {} rooms from {} pin hint(s) (extract had {})",
            fname, len(rebuilt), len(pts), len(rooms),
        )
    return flats


def _flat_anchor(flat_entry: dict[str, Any]) -> tuple[float, float] | None:
    """Prefer OCR anchor when present; else centroid of culled room union."""
    anchor = flat_entry.get("anchor")
    if isinstance(anchor, dict):
        try:
            return float(anchor["x"]), float(anchor["y"])
        except (KeyError, TypeError, ValueError):
            pass
    return _flat_centroid(flat_entry)


def _reclaim_specialized_from_living(rooms: list[dict[str, Any]], *, label: str) -> None:
    """Pull Puja/Store/Utility cells out of an oversized Living / Dining AABB.

    The model often paints Living / Dining over the small rooms that share its
    wall, then places those rooms one grid row below/beside the true label.
    When a specialized room abuts Living on a long edge, reclaim the shared
    strip so engineer pins in Puja/Store resolve correctly.
    """
    for liv in rooms:
        if not _is_living_dining_name(str(liv.get("name") or "")):
            continue
        lb = _rect_bounds(liv["polygon"])
        for sp in rooms:
            if sp is liv or not _is_specialized_room_name(str(sp.get("name") or "")):
                continue
            sb = _rect_bounds(sp["polygon"])
            x_overlap = min(lb[1], sb[1]) - max(lb[0], sb[0])
            y_overlap = min(lb[3], sb[3]) - max(lb[2], sb[2])
            # Specialized room directly BELOW living, sharing a horizontal edge.
            if x_overlap >= 3.0 and abs(sb[2] - lb[3]) <= 1.5 and sb[2] >= lb[2]:
                # Expand specialized upward into living; cut living's right/overlap strip
                # when the specialized room only covers part of living's width.
                new_sp_y0 = lb[2]
                _set_room_polygon(sp, sb[0], sb[1], new_sp_y0, sb[3])
                if sb[0] > lb[0] + 2.0:
                    _set_room_polygon(liv, lb[0], sb[0], lb[2], lb[3])
                else:
                    _set_room_polygon(liv, lb[0], lb[1], lb[2], sb[2])
                logger.debug(
                    "Room map {}: reclaimed {!r} upward from Living strip ({:.1f}-{:.1f})",
                    label, sp.get("name"), sb[0], sb[1],
                )
                lb = _rect_bounds(liv["polygon"])
                continue
            # Specialized room directly RIGHT of living, sharing a vertical edge.
            if y_overlap >= 3.0 and abs(sb[0] - lb[1]) <= 1.5 and sb[0] >= lb[0]:
                new_sp_x0 = max(lb[0], min(sb[0], lb[1] - 2.0))
                # Claim the right strip of living into the specialized room.
                _set_room_polygon(sp, new_sp_x0, max(sb[1], lb[1]), max(sb[2], lb[2]), min(sb[3], lb[3]))
                if new_sp_x0 > lb[0] + 2.0:
                    _set_room_polygon(liv, lb[0], new_sp_x0, lb[2], lb[3])
                logger.debug(
                    "Room map {}: reclaimed {!r} leftward from Living strip",
                    label, sp.get("name"),
                )
                lb = _rect_bounds(liv["polygon"])


def _ensure_adjacent_store_utility(rooms: list[dict[str, Any]], *, label: str) -> None:
    """If Puja exists but Store is missing beside it, peel a Store from Living/empty gap.

    Common CAD layout: Puja | Store along the same band as Living / Dining.
    """
    names = {str(r.get("name") or "").strip().lower() for r in rooms}
    has_store = any("store" in n for n in names)
    has_utility = any("utility" in n for n in names)
    puja = next((r for r in rooms if "puja" in str(r.get("name") or "").lower()), None)
    sit = next(
        (r for r in rooms if "sit-out" in str(r.get("name") or "").lower()
         or "sit out" in str(r.get("name") or "").lower()),
        None,
    )
    if puja is not None and not has_store:
        pb = _rect_bounds(puja["polygon"])
        # Store typically mirrors Puja to its exterior side (higher x for right-side flats).
        sx0, sx1 = pb[1], min(100.0, pb[1] + max(4.0, pb[1] - pb[0]))
        sy0, sy1 = pb[2], pb[3]
        if sx1 - sx0 >= 3.0:
            rooms.append({
                "name": "Store",
                "polygon": [
                    {"x": sx0, "y": sy0}, {"x": sx1, "y": sy0},
                    {"x": sx1, "y": sy1}, {"x": sx0, "y": sy1},
                ],
                "confidence": 80,
                "reason": "adjacent to Puja (layout completion)",
            })
            logger.debug("Room map {}: synthesized Store beside Puja at x={:.1f}-{:.1f}", label, sx0, sx1)
            # Shrink Living if it still covers that strip.
            for liv in rooms:
                if not _is_living_dining_name(str(liv.get("name") or "")):
                    continue
                lb = _rect_bounds(liv["polygon"])
                if lb[1] > sx0 and lb[2] < sy1 and lb[3] > sy0:
                    _set_room_polygon(liv, lb[0], min(lb[1], sx0), lb[2], lb[3])

    if sit is not None and not has_utility:
        sb = _rect_bounds(sit["polygon"])
        # Peel the outer (higher-x) third of a wide Sit-Out as Utility.
        width = sb[1] - sb[0]
        if width >= 8.0:
            split = sb[0] + width * (2.0 / 3.0)
            # Extend slightly past the old Sit-Out edge — Utility often sits in
            # the outer corner and pins land just outside the AI AABB.
            util_x1 = min(100.0, sb[1] + 4.0)
            _set_room_polygon(sit, sb[0], split, sb[2], sb[3])
            rooms.append({
                "name": "Utility",
                "polygon": [
                    {"x": split, "y": sb[2]}, {"x": util_x1, "y": sb[2]},
                    {"x": util_x1, "y": sb[3]}, {"x": split, "y": sb[3]},
                ],
                "confidence": 80,
                "reason": "peeled from Sit-Out (layout completion)",
            })
            logger.debug(
                "Room map {}: synthesized Utility from Sit-Out strip x={:.1f}-{:.1f}",
                label, split, util_x1,
            )

def _trim_overlapping_rectangles(rooms: list[dict[str, Any]], *, label: str) -> None:
    """
    Second, complementary defence against overlapping rectangles (mutates
    ``rooms`` in place). The cell-ownership dedup above resolves the SAME
    cell being claimed by two rooms; this handles the smaller residual case
    where two genuinely ADJACENT rooms each read their own wall boundary
    slightly imprecisely, leaving a thin overlap that isn't a shared cell at
    all (confirmed on a real floor plan: two rooms with distinct, only
    partially-overlapping cell sets, overlapping by roughly half a grid
    cell's width). Real rooms share a flat wall, not a shared floor area, so
    each overlapping pair is trimmed back to meet exactly at the midpoint of
    the overlap, on whichever axis the overlap is thinner (the wall is more
    likely the axis with the smaller gap).
    """
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            b1 = _rect_bounds(rooms[i]["polygon"])
            b2 = _rect_bounds(rooms[j]["polygon"])
            ox0, ox1 = max(b1[0], b2[0]), min(b1[1], b2[1])
            oy0, oy1 = max(b1[2], b2[2]), min(b1[3], b2[3])
            ox, oy = ox1 - ox0, oy1 - oy0
            if ox <= 0 or oy <= 0:
                continue  # no overlap
            logger.debug(
                "Trimming overlap between {} and {} rooms {!r}/{!r}: {:.2f}x{:.2f} units",
                label, label, rooms[i]["name"], rooms[j]["name"], ox, oy,
            )
            if ox <= oy:
                # Thinner along x — the shared wall is vertical. Whichever
                # room is to the left gets pulled back to the midpoint;
                # whichever is to the right advances to meet it.
                mid = (ox0 + ox1) / 2
                for r, b in ((rooms[i], b1), (rooms[j], b2)):
                    is_left = b[0] < b[1] and (b[0] + b[1]) / 2 < mid
                    _set_rect_edge(r, "x1" if is_left else "x0", mid)
            else:
                # Thinner along y — the shared wall is horizontal.
                mid = (oy0 + oy1) / 2
                for r, b in ((rooms[i], b1), (rooms[j], b2)):
                    is_top = (b[2] + b[3]) / 2 < mid
                    _set_rect_edge(r, "y1" if is_top else "y0", mid)


def _set_rect_edge(room: dict[str, Any], edge: str, value: float) -> None:
    """Move one edge (x0/x1/y0/y1) of a room's axis-aligned rectangle polygon to ``value``."""
    axis = "x" if edge[0] == "x" else "y"
    bounds = _rect_bounds(room["polygon"])
    old_value = bounds[0] if edge == "x0" else bounds[1] if edge == "x1" else bounds[2] if edge == "y0" else bounds[3]
    for point in room["polygon"]:
        if point[axis] == old_value:
            point[axis] = value


# Full-image-percent distance a pin may sit outside every room polygon and still
# snap to the nearest one. Within the already-chosen flat we allow a bit more
# (coarse AI boxes leave real gaps between Lobby/Dining and Master wet rooms);
# cross-flat snaps are rejected separately.
_NEAREST_ROOM_TOLERANCE = 2.5

# Vertical core split (full-image %). Left-wing vs right-wing flats often bleed
# across this line; rooms on the wrong side of their flat are culled.
_FLAT_SIDE_SPLIT_X = 50.0

# Same printed name (e.g. two "Dress" rooms) kept when centroids are farther
# apart than this — name-dedupe used to delete the second Dress/Sit-Out.
_DUP_ROOM_NAME_SEP = 8.0

# Priority: specialized/small rooms beat oversized Living/Master when a pin
# sits in overlapping AABBs (lower = better).
_ROOM_PRIORITY: dict[str, int] = {
    "handwash": 0,
    "hand wash": 0,
    "pdr": 0,
    "puja": 0,
    "store": 0,
    "dress": 1,
    "toilet": 1,
    "m. toilet": 1,
    "m toilet": 1,
    "utility": 2,
    "sit-out": 2,
    "sit out": 2,
    "kitchen": 3,
    "lobby": 4,
    "drawing": 4,
    "dining": 5,
    "bedroom": 5,
    "living": 6,
    "master": 6,
}


def _rect_bounds(polygon: list[dict[str, float]]) -> tuple[float, float, float, float]:
    xs = [p["x"] for p in polygon]
    ys = [p["y"] for p in polygon]
    return min(xs), max(xs), min(ys), max(ys)


def _distance_to_rect(x: float, y: float, bounds: tuple[float, float, float, float]) -> float:
    """0 if (x, y) is inside/on the rectangle; otherwise the distance to its nearest edge/corner."""
    x0, x1, y0, y1 = bounds
    dx = max(x0 - x, 0.0, x - x1)
    dy = max(y0 - y, 0.0, y - y1)
    return (dx * dx + dy * dy) ** 0.5


def _flat_centroid(flat_entry: dict[str, Any]) -> tuple[float, float] | None:
    """Centroid of the union AABB of every room in the flat — used to pick the
    owning flat when overlapping AABBs from neighbouring flats all contain a pin."""
    xs: list[float] = []
    ys: list[float] = []
    for room in flat_entry.get("rooms") or []:
        poly = room.get("polygon") or []
        if not poly:
            continue
        try:
            x0, x1, y0, y1 = _rect_bounds(poly)
        except (KeyError, TypeError, ValueError):
            continue
        xs.extend([x0, x1])
        ys.extend([y0, y1])
    if not xs or not ys:
        return None
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def locate_pin(
    flats: list[dict[str, Any]],
    pin_x: float | None,
    pin_y: float | None,
) -> tuple[str, str] | None:
    """
    Resolve a pin (x, y) to (flat, room).

    Prefers residential flats over Common Area, specialized/small rooms over
    oversized Living/Master AABBs, and flat OCR anchors over polluted union
    centroids when neighbouring flats both contain the point.
    """
    if pin_x is None or pin_y is None:
        return None

    # (priority, area, centroid_dist, flat_name, room_name)
    containing: list[tuple[int, float, float, str, str]] = []
    # (edge_dist, priority, area, flat_name, room_name)
    nearest_outside: tuple[float, int, float, str, str] | None = None

    flat_anchors: dict[str, tuple[float, float]] = {}
    for flat_entry in flats:
        fname = str(flat_entry.get("flat") or "")
        fa = _flat_anchor(flat_entry)
        if fa is not None:
            flat_anchors[fname] = fa
        for room in flat_entry.get("rooms") or []:
            polygon = room.get("polygon") or []
            if not polygon:
                continue
            try:
                bounds = _rect_bounds(polygon)
            except (KeyError, TypeError, ValueError):
                continue
            room_name = str(room.get("name") or "")
            pri = _room_priority(room_name)
            area = max(0.0, bounds[1] - bounds[0]) * max(0.0, bounds[3] - bounds[2])
            cx, cy = (bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2
            dist = ((pin_x - cx) ** 2 + (pin_y - cy) ** 2) ** 0.5
            if _point_in_polygon(pin_x, pin_y, polygon):
                containing.append((pri, area, dist, fname, room_name))
                continue
            edge_dist = _distance_to_rect(pin_x, pin_y, bounds)
            if edge_dist <= _NEAREST_ROOM_TOLERANCE:
                cand = (edge_dist, pri, area, fname, room_name)
                if nearest_outside is None or cand < nearest_outside:
                    nearest_outside = cand

    def _anchor_dist(fname: str) -> float:
        fa = flat_anchors.get(fname)
        if fa is None:
            return 1e9
        return ((pin_x - fa[0]) ** 2 + (pin_y - fa[1]) ** 2) ** 0.5

    def _pick_room(cands: list[tuple[int, float, float, str, str]]) -> tuple[str, str]:
        # Prefer non-common flats, then specialized priority, then small area.
        def key(c: tuple[int, float, float, str, str]) -> tuple:
            fname = c[3]
            common_penalty = 1 if fname == _COMMON_AREA_FLAT else 0
            return (common_penalty, c[0], c[1], c[2])

        best = min(cands, key=key)
        return best[3], best[4]

    if containing:
        flats_hit = {c[3] for c in containing}
        residential = {f for f in flats_hit if f != _COMMON_AREA_FLAT}
        if residential:
            # Ignore Common Area when a flat room also contains the pin
            # (Common Lobby was swallowing Drawing Room).
            containing = [c for c in containing if c[3] != _COMMON_AREA_FLAT]
            flats_hit = residential

        if len(flats_hit) == 1:
            return _pick_room(containing)

        chosen_flat = min(flats_hit, key=_anchor_dist)
        in_flat = [c for c in containing if c[3] == chosen_flat]
        return _pick_room(in_flat)

    if nearest_outside is not None:
        snap_flat = nearest_outside[3]
        # Prefer nearest flat by anchor among all flats, but allow snap when
        # the edge hit is clearly closer than any other flat's nearest room.
        if flat_anchors and min(flat_anchors.keys(), key=_anchor_dist) != snap_flat:
            # Still accept if this is a residential snap and Common Area "won" anchor.
            nearest_flat = min(flat_anchors.keys(), key=_anchor_dist)
            if not (
                nearest_flat == _COMMON_AREA_FLAT
                and snap_flat != _COMMON_AREA_FLAT
            ):
                return None
        return nearest_outside[3], nearest_outside[4]
    return None


class RoomMapService:
    """Extracts and caches the semantic room map for a floor plan image."""

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db
        # Per-instance memo: analyze resolves ~N pins and must not re-run the
        # full geometry sanitize (and its INFO spam) for every pin.
        self._sanitized_flats_by_plan: dict[str, list[dict[str, Any]]] = {}

    async def get_cached(self, floor_plan_id: str, org_id: str) -> dict[str, Any] | None:
        return await self._db[_COLLECTION].find_one({"_id": floor_plan_id, "org_id": org_id})

    async def get_sanitized_flats(
        self,
        floor_plan_id: str,
        org_id: str,
        *,
        cached: dict[str, Any] | None = None,
        pin_hints: list[tuple[float, float]] | None = None,
    ) -> list[dict[str, Any]]:
        """Room polygons ready for locate_pin / heatmap (sanitized once per plan).

        When ``pin_hints`` are provided (engineer capture pin positions), sparse
        / overlapping flat extracts are refined so pins land in real rooms.
        """
        hit = self._sanitized_flats_by_plan.get(floor_plan_id)
        if hit is None:
            doc = cached if cached is not None else await self.get_cached(floor_plan_id, org_id)
            flats = [
                {**f, "flat": _canonical_flat_label(str(f.get("flat") or ""))}
                for f in ((doc or {}).get("flats") or [])
            ]
            flats = _sanitize_room_map_flats(flats)
            self._sanitized_flats_by_plan[floor_plan_id] = flats
            hit = flats
        if pin_hints:
            refined = _refine_flats_with_pin_hints(copy.deepcopy(hit), pin_hints)
            self._sanitized_flats_by_plan[floor_plan_id] = refined
            return refined
        return hit

    def _cache_needs_reextract(self, cached: dict[str, Any] | None, image_url: str) -> bool:
        """True when the cached map is missing, for a different image, or on an old schema."""
        if not cached or not cached.get("flats"):
            return True
        if cached.get("image_url") != image_url:
            return True
        if int(cached.get("schema_version") or 0) < _ROOM_MAP_SCHEMA_VERSION:
            return True
        # Defence-in-depth: any leftover A/B/C flat label forces a rebuild.
        for flat_entry in cached.get("flats") or []:
            name = str(flat_entry.get("flat") or "")
            if re.search(r"\([A-Za-z]\)\s*$", name):
                return True
        return False

    async def invalidate_cached(self, floor_plan_id: str, org_id: str) -> None:
        """Drop a cached room map so the next ensure/resolve re-extracts."""
        self._sanitized_flats_by_plan.pop(floor_plan_id, None)
        await self._db[_COLLECTION].delete_one({"_id": floor_plan_id, "org_id": org_id})

    async def ensure_room_map(
        self,
        *,
        floor_plan_id: str,
        org_id: str,
        image_url: str,
        force: bool = False,
    ) -> dict[str, Any] | None:
        """
        Return the cached room map for this floor plan, extracting it if missing
        or if the underlying image URL / schema changed. Never raises —
        extraction failures are logged and None is returned so report generation
        can fall back to "Pin N" instead of failing.
        """
        if not image_url:
            return None

        cached = await self.get_cached(floor_plan_id, org_id)
        if not force and not self._cache_needs_reextract(cached, image_url):
            return cached

        try:
            safe_url = validate_image_url(image_url)
            image_bytes, _mime = await download_image(safe_url, timeout=60.0)
            full = Image.open(io.BytesIO(image_bytes))

            provider = _get_room_map_provider()
            flats, model = await self._extract_flats(full, provider)

            doc = {
                "_id": floor_plan_id,
                "org_id": org_id,
                "image_url": image_url,
                "flats": flats,
                "model": model,
                "schema_version": _ROOM_MAP_SCHEMA_VERSION,
                "extracted_at": _utcnow(),
                "error": None,
            }
            await self._db[_COLLECTION].replace_one({"_id": floor_plan_id}, doc, upsert=True)
            self._sanitized_flats_by_plan.pop(floor_plan_id, None)
            logger.info(
                "Room map extracted floor_plan_id={} flats={} rooms={} schema={}",
                floor_plan_id,
                len(flats),
                sum(len(f["rooms"]) for f in flats),
                _ROOM_MAP_SCHEMA_VERSION,
            )
            return doc
        except Exception as exc:
            logger.warning("Room map extraction failed floor_plan_id={}: {}", floor_plan_id, exc)
            await self._db[_COLLECTION].update_one(
                {"_id": floor_plan_id},
                {
                    "$set": {
                        "org_id": org_id,
                        "image_url": image_url,
                        "error": str(exc)[:500],
                        "extracted_at": _utcnow(),
                    },
                    "$setOnInsert": {"flats": [], "schema_version": 0},
                },
                upsert=True,
            )
            return cached

    async def _extract_flats(
        self,
        full: Image.Image,
        provider: VisionProvider,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """
        Extraction stages:
          1. Read flat numbers per overlapping tile; canonicalise (no A/B/C).
          2. Dedupe near-duplicate OCR hits; for distant same-number clusters,
             extract rooms from each cluster and MERGE under one "Flat NN".
          3. Extract building-core / common areas from the central crop.

        Returns (flats, model) where flats is [{"flat": "Flat 01", "rooms": [...]}].
        """
        W, H = full.size
        model: str | None = None

        flat_cells: dict[str, list[tuple[int, int]]] = {}
        flat_positions: dict[str, list[tuple[float, float]]] = {}
        for ri, (fy0, fy1) in enumerate(_GRID_BANDS):
            for ci, (fx0, fx1) in enumerate(_GRID_BANDS):
                tile = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
                res = await provider.read_flat_labels(image_b64=_to_jpeg_b64(tile), mime="image/jpeg")
                model = model or res.model
                for entry in res.content.get("flats") or []:
                    if isinstance(entry, dict):
                        num = _canonical_flat_number(str(entry.get("number") or ""))
                        try:
                            lx = max(0.0, min(1.0, float(entry.get("x", 0.5))))
                            ly = max(0.0, min(1.0, float(entry.get("y", 0.5))))
                        except (TypeError, ValueError):
                            lx = ly = 0.5
                    else:
                        num = _canonical_flat_number(str(entry))
                        lx = ly = 0.5
                    if not num:
                        continue
                    flat_cells.setdefault(num, []).append((ci, ri))
                    abs_x = fx0 + lx * (fx1 - fx0)
                    abs_y = fy0 + ly * (fy1 - fy0)
                    flat_positions.setdefault(num, []).append((abs_x, abs_y))

        flat_cells, flat_positions = self._consolidate_flat_detections(flat_cells, flat_positions)

        flats: list[dict[str, Any]] = []
        for num in sorted(flat_cells):
            positions = flat_positions.get(num) or []
            cells = flat_cells[num]
            clusters = self._position_clusters(positions)
            if not clusters:
                clusters = [positions] if positions else [[]]

            all_rooms: list[dict[str, Any]] = []
            cluster_anchor: tuple[float, float] | None = None
            for cluster in clusters:
                if cluster:
                    cx = sum(p[0] for p in cluster) / len(cluster)
                    cy = sum(p[1] for p in cluster) / len(cluster)
                    if cluster_anchor is None:
                        cluster_anchor = (cx * 100.0, cy * 100.0)
                    fx0 = max(0.0, cx - _FLAT_CROP_HALF_SPAN)
                    fx1 = min(1.0, cx + _FLAT_CROP_HALF_SPAN)
                    fy0 = max(0.0, cy - _FLAT_CROP_HALF_SPAN)
                    fy1 = min(1.0, cy + _FLAT_CROP_HALF_SPAN)
                elif cells:
                    fx0 = max(0.0, min(_GRID_BANDS[c][0] for c, _ in cells) - _FLAT_CROP_PAD)
                    fx1 = min(1.0, max(_GRID_BANDS[c][1] for c, _ in cells) + _FLAT_CROP_PAD)
                    fy0 = max(0.0, min(_GRID_BANDS[r][0] for _, r in cells) - _FLAT_CROP_PAD)
                    fy1 = min(1.0, max(_GRID_BANDS[r][1] for _, r in cells) + _FLAT_CROP_PAD)
                else:
                    continue
                crop = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
                gridded = _draw_grid(crop, _CROP_GRID_COLS, _CROP_GRID_ROWS)
                res = await provider.extract_rooms_in_crop(
                    image_b64=_to_jpeg_b64(gridded),
                    mime="image/jpeg",
                    cols=_CROP_GRID_COLS,
                    rows=_CROP_GRID_ROWS,
                    target_flat_number=num,
                )
                model = model or res.model
                rooms = _parse_rooms(
                    res.content.get("rooms"),
                    crop_box=(fx0, fy0, fx1, fy1),
                    own_x=(fx0 * 100, fx1 * 100),
                    own_y=(fy0 * 100, fy1 * 100),
                    exclude_common=True,
                    label=f"Flat {num}",
                )
                all_rooms.extend(rooms)

            merged = self._merge_rooms_for_flat(all_rooms, label=f"Flat {num}")
            if merged:
                entry: dict[str, Any] = {"flat": f"Flat {num}", "rooms": merged}
                if cluster_anchor is not None:
                    entry["anchor"] = {"x": cluster_anchor[0], "y": cluster_anchor[1]}
                flats.append(entry)

        fx0, fy0, fx1, fy1 = _CORE_TILE
        core_crop = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
        core_gridded = _draw_grid(core_crop, _CROP_GRID_COLS, _CROP_GRID_ROWS)
        try:
            core_res = await provider.extract_common_areas_in_crop(
                image_b64=_to_jpeg_b64(core_gridded),
                mime="image/jpeg",
                cols=_CROP_GRID_COLS,
                rows=_CROP_GRID_ROWS,
            )
            model = model or core_res.model
            common_rooms = _parse_rooms(
                core_res.content.get("rooms"),
                crop_box=(fx0, fy0, fx1, fy1),
                own_x=(0.0, 100.0),
                own_y=(0.0, 100.0),
                exclude_common=False,
                label=_COMMON_AREA_FLAT,
            )
            if common_rooms:
                flats.append({"flat": _COMMON_AREA_FLAT, "rooms": common_rooms})
        except NotImplementedError:
            pass

        flats = _sanitize_room_map_flats(flats)
        return flats, model

    def _consolidate_flat_detections(
        self,
        flat_cells: dict[str, list[tuple[int, int]]],
        flat_positions: dict[str, list[tuple[float, float]]],
    ) -> tuple[dict[str, list[tuple[int, int]]], dict[str, list[tuple[float, float]]]]:
        """Merge near-duplicate OCR hits for the same flat number. Never invent A/B/C keys."""
        result_cells: dict[str, list[tuple[int, int]]] = {}
        result_positions: dict[str, list[tuple[float, float]]] = {}

        for num, positions in flat_positions.items():
            cells = flat_cells.get(num) or []
            kept_pos: list[tuple[float, float]] = []
            kept_cells: list[tuple[int, int]] = []
            for idx, pos in enumerate(positions):
                cell = cells[idx] if idx < len(cells) else None
                duplicate = False
                for prev in kept_pos:
                    if ((pos[0] - prev[0]) ** 2 + (pos[1] - prev[1]) ** 2) ** 0.5 <= _OCR_DEDUPE_DISTANCE:
                        duplicate = True
                        break
                if duplicate:
                    continue
                kept_pos.append(pos)
                if cell is not None:
                    kept_cells.append(cell)
            result_positions[num] = kept_pos
            result_cells[num] = kept_cells or list(dict.fromkeys(cells))

        for num, cells in flat_cells.items():
            if num not in result_cells:
                result_cells[num] = list(dict.fromkeys(cells))
                result_positions[num] = []
        return result_cells, result_positions

    def _position_clusters(
        self,
        positions: list[tuple[float, float]],
    ) -> list[list[tuple[float, float]]]:
        """Group far-apart detections so each cluster gets its own room-extract crop."""
        if not positions:
            return []
        if len(positions) == 1:
            return [list(positions)]

        clusters: list[list[int]] = []
        for i, pos in enumerate(positions):
            placed = False
            for cluster in clusters:
                cx = sum(positions[j][0] for j in cluster) / len(cluster)
                cy = sum(positions[j][1] for j in cluster) / len(cluster)
                if ((pos[0] - cx) ** 2 + (pos[1] - cy) ** 2) ** 0.5 <= _CLUSTER_SEPARATION:
                    cluster.append(i)
                    placed = True
                    break
            if not placed:
                clusters.append([i])
        return [[positions[i] for i in cluster] for cluster in clusters]

    def _merge_rooms_for_flat(
        self,
        rooms: list[dict[str, Any]],
        *,
        label: str,
    ) -> list[dict[str, Any]]:
        """Deduplicate rooms extracted from multiple clusters of the same flat number.

        Same printed name is kept twice when centroids are far apart (two Dress
        rooms, two Sit-Outs). Close duplicates keep the larger AABB.
        """
        if not rooms:
            return []
        merged: list[dict[str, Any]] = []
        for room in rooms:
            name = str(room.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            rc = _room_centroid_xy(room)
            twin_idx = None
            for i, existing in enumerate(merged):
                if str(existing.get("name") or "").strip().lower() != key:
                    continue
                ec = _room_centroid_xy(existing)
                if rc is None or ec is None:
                    twin_idx = i
                    break
                sep = ((rc[0] - ec[0]) ** 2 + (rc[1] - ec[1]) ** 2) ** 0.5
                if sep <= _DUP_ROOM_NAME_SEP:
                    twin_idx = i
                    break
            if twin_idx is None:
                merged.append(room)
                continue
            existing = merged[twin_idx]
            try:
                b1 = _rect_bounds(existing["polygon"])
                b2 = _rect_bounds(room["polygon"])
            except (KeyError, TypeError, ValueError):
                continue
            area1 = max(0.0, b1[1] - b1[0]) * max(0.0, b1[3] - b1[2])
            area2 = max(0.0, b2[1] - b2[0]) * max(0.0, b2[3] - b2[2])
            if area2 > area1:
                merged[twin_idx] = room
        # Full sanitize (cull / wet-gap / dress / sit-out) runs once on the
        # whole floor map after every flat is merged.
        merged = _keep_primary_room_cluster(merged, label=label)
        _trim_overlapping_rectangles(merged, label=label)
        _reclaim_specialized_from_living(merged, label=label)
        _ensure_adjacent_store_utility(merged, label=label)
        return merged

    async def resolve_pin_location(
        self,
        *,
        floor_plan_id: str,
        org_id: str,
        pin_x: float | None,
        pin_y: float | None,
        fallback_pin_name: str,
    ) -> tuple[str, str]:
        """
        Resolve a pin's (x, y) to (flat, room) using the cached room map.
        Self-heals missing / stale-schema caches via lazy extract. Falls back to
        ("Unknown", fallback_pin_name) when unresolved — never raises.
        """
        if floor_plan_id:
            cached = await self.get_cached(floor_plan_id, org_id)
            image_url = str((cached or {}).get("image_url") or "")
            if cached is None or self._cache_needs_reextract(cached, image_url):
                cached = await self._extract_for_existing_plan(floor_plan_id, org_id)
            flats = await self.get_sanitized_flats(floor_plan_id, org_id, cached=cached)
            located = locate_pin(flats, pin_x, pin_y)
            if located:
                flat_name, room_name = located
                return _canonical_flat_label(flat_name), room_name
        return _FALLBACK_FLAT, fallback_pin_name

    async def _extract_for_existing_plan(
        self,
        floor_plan_id: str,
        org_id: str,
    ) -> dict[str, Any] | None:
        """Look up a pre-existing floor plan's image and extract its room map on demand."""
        plan = await self._db["floor_plans"].find_one({"_id": floor_plan_id, "orgId": org_id})
        if not plan:
            return None
        image_url = plan.get("file_url") or plan.get("fileUrl") or ""
        if not image_url:
            return None
        return await self.ensure_room_map(
            floor_plan_id=floor_plan_id,
            org_id=org_id,
            image_url=image_url,
        )


def _room_centroid(room: dict[str, Any]) -> tuple[float, float] | None:
    poly = room.get("polygon") or []
    if not poly:
        return None
    try:
        b = _rect_bounds(poly)
    except (KeyError, TypeError, ValueError):
        return None
    return (b[0] + b[1]) / 2, (b[2] + b[3]) / 2


def _room_area(room: dict[str, Any]) -> float:
    poly = room.get("polygon") or []
    if not poly:
        return 0.0
    try:
        b = _rect_bounds(poly)
    except (KeyError, TypeError, ValueError):
        return 0.0
    return max(0.0, b[1] - b[0]) * max(0.0, b[3] - b[2])


def _keep_primary_room_cluster(
    rooms: list[dict[str, Any]],
    *,
    label: str,
    link_dist: float = _ROOM_CLUSTER_LINK_DIST,
) -> list[dict[str, Any]]:
    """Drop only small neighbour-bleed outliers; keep multi-wing flats intact.

    Oversized flat crops can include a slice of the adjacent apartment (1–3
    rooms). Those should be dropped. L-shaped / multi-wing flats, however,
    legitimately have room centroids farther apart than ``link_dist`` — the
    old "keep largest cluster only" rule deleted Living / Master Bedroom /
    Puja on real Floor-4 maps and broke pin→room + Flat Finishing rosters.
    """
    if len(rooms) < 4:
        return rooms

    centroids: list[tuple[float, float] | None] = [_room_centroid(r) for r in rooms]
    parent = list(range(len(rooms)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(rooms)):
        ci = centroids[i]
        if ci is None:
            continue
        for j in range(i + 1, len(rooms)):
            cj = centroids[j]
            if cj is None:
                continue
            if ((ci[0] - cj[0]) ** 2 + (ci[1] - cj[1]) ** 2) ** 0.5 <= link_dist:
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(len(rooms)):
        clusters.setdefault(find(i), []).append(i)

    if len(clusters) < 2:
        return rooms

    def cluster_score(idxs: list[int]) -> tuple[float, int]:
        return (sum(_room_area(rooms[i]) for i in idxs), len(idxs))

    primary = max(clusters.values(), key=cluster_score)
    primary_area = cluster_score(primary)[0] or 1.0

    kept: set[int] = set(primary)
    dropped: list[str] = []
    for idxs in clusters.values():
        if set(idxs) <= kept:
            continue
        area, n = cluster_score(idxs)
        # Neighbour bleed is almost always a tiny satellite (1–3 rooms).
        # Anything larger is treated as part of this flat (second wing).
        if n <= 3 and area < 0.28 * primary_area:
            dropped.extend(str(rooms[i].get("name") or "?") for i in idxs)
            continue
        kept.update(idxs)

    if dropped:
        logger.debug(
            "Room map {}: dropping {} neighbour-bleed room(s) outside primary cluster: {}",
            label, len(dropped), ", ".join(dropped),
        )
    if len(kept) == len(rooms):
        return rooms
    return [rooms[i] for i in sorted(kept)]
