from __future__ import annotations

import base64
import io
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
    rooms: list[dict[str, Any]] = []
    seen: set[str] = set()
    for room in raw_rooms:
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
        polygon = _cells_to_full_polygon(
            cells, crop_x0=cx0, crop_y0=cy0, crop_w=(cx1 - cx0), crop_h=(cy1 - cy0)
        )
        if not polygon:
            continue
        ccx = (polygon[0]["x"] + polygon[2]["x"]) / 2
        ccy = (polygon[0]["y"] + polygon[2]["y"]) / 2
        # Reject rooms whose centre is outside the owned region (neighbour bleed across the core).
        if not (own_x[0] <= ccx <= own_x[1] and own_y[0] <= ccy <= own_y[1]):
            continue
        # For flats, also drop rooms in the central core cross-band (that's common-area territory).
        if exclude_common and (abs(ccx - 50.0) < _CORE_BAND or abs(ccy - 50.0) < _CORE_BAND):
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
    return rooms


# Full-image-percent distance a pin may sit outside every room polygon and still
# snap to the nearest one. AI-extracted room boxes (see _cells_to_full_polygon)
# are grid-cell bounding rectangles, not true outlines, so a fresh extraction can
# leave thin real gaps between adjacent rooms — confirmed on a real floor plan
# where a re-extraction that fixed overlapping/duplicate boxes elsewhere left a
# pin sitting ~5 units from the nearest room with nothing containing it. That gap
# is extraction noise, not the pin genuinely being in an unmapped area, so a
# small tolerance is worth the risk. Kept well below the smallest real room
# dimension on any floor plan seen so far (~7 units) so it can't reach all the
# way into a different, unrelated room on the other side of a gap.
_NEAREST_ROOM_TOLERANCE = 3.0


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


def locate_pin(
    flats: list[dict[str, Any]],
    pin_x: float | None,
    pin_y: float | None,
) -> tuple[str, str] | None:
    """
    Resolve a pin (x, y) to (flat, room).

    Primary rule is exact point-in-polygon containment: for construction progress a wrong room is
    worse than a missing one, so a pin should never be snapped across a real gap into an unrelated,
    visually-distant room. See _NEAREST_ROOM_TOLERANCE for the one narrow exception.

    Room polygons are AI-extracted bounding boxes of grid cells (see _cells_to_full_polygon), not
    true outlines, so two adjacent rooms can genuinely overlap when the model's cell ranges are
    slightly off — confirmed on a real floor plan where "Drawing Room" and "Bedroom-2" shared an
    identical x-range with overlapping y-ranges, so two visually-distinct pins both landed inside
    BOTH boxes. Picking the first match by array order there is arbitrary and wrong roughly half the
    time. When a point falls inside more than one polygon, the room whose CENTROID is nearest the
    point wins — this is a genuine disambiguation (not a "nearest room" fallback for points outside
    every polygon), since every candidate here already legitimately contains the point.
    """
    if pin_x is None or pin_y is None:
        return None
    best: tuple[float, str, str] | None = None  # (distance_to_centroid, flat, room)
    nearest_outside: tuple[float, str, str] | None = None  # (distance_to_edge, flat, room)
    for flat_entry in flats:
        for room in flat_entry.get("rooms", []):
            polygon = room["polygon"]
            bounds = _rect_bounds(polygon)
            if _point_in_polygon(pin_x, pin_y, polygon):
                cx, cy = (bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2
                dist = ((pin_x - cx) ** 2 + (pin_y - cy) ** 2) ** 0.5
                if best is None or dist < best[0]:
                    best = (dist, flat_entry["flat"], room["name"])
                continue
            if best is not None:
                continue  # already have a genuine containing room; no need to track edge distance
            edge_dist = _distance_to_rect(pin_x, pin_y, bounds)
            if edge_dist <= _NEAREST_ROOM_TOLERANCE and (nearest_outside is None or edge_dist < nearest_outside[0]):
                nearest_outside = (edge_dist, flat_entry["flat"], room["name"])
    if best is not None:
        return best[1], best[2]
    if nearest_outside is not None:
        return nearest_outside[1], nearest_outside[2]
    return None


class RoomMapService:
    """Extracts and caches the semantic room map for a floor plan image."""

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._db = db

    async def get_cached(self, floor_plan_id: str, org_id: str) -> dict[str, Any] | None:
        return await self._db[_COLLECTION].find_one({"_id": floor_plan_id, "org_id": org_id})

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
        or if the underlying image URL changed (plan was replaced). Never raises —
        extraction failures are logged and None is returned so report generation
        can fall back to "Pin N" instead of failing.
        """
        if not image_url:
            return None

        cached = await self.get_cached(floor_plan_id, org_id)
        if not force and cached and cached.get("image_url") == image_url and cached.get("flats"):
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
                "extracted_at": _utcnow(),
                "error": None,
            }
            await self._db[_COLLECTION].replace_one({"_id": floor_plan_id}, doc, upsert=True)
            logger.info(
                "Room map extracted floor_plan_id={} flats={} rooms={}",
                floor_plan_id,
                len(flats),
                sum(len(f["rooms"]) for f in flats),
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
                    "$setOnInsert": {"flats": []},
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
          1. Read the flat number(s) in each tile of an aspect-adaptive overlapping grid, recording
             which grid bands each flat appears in.
          2. For each flat, crop to the bounding region of its bands (data-driven, so it works for
             portrait/landscape/square plans), grid it, extract rooms, keep those inside the region.
          3. Extract building-core / common areas from the central crop.

        Returns (flats, model) where flats is [{"flat": "Flat 01", "rooms": [{name, polygon}]}].
        """
        W, H = full.size
        model: str | None = None

        # Stage 1 — read the flat number(s) in each focused tile of an aspect-adaptive overlapping
        # grid. Record every (col, row) band a flat appears in, so its crop region can be derived
        # from its actual position (works for portrait/landscape/square, unlike fixed quadrants).
        #
        # IMPORTANT: the SAME flat number (e.g. "01") legitimately repeats more than once on a
        # single floor plan — many towers number flats per-wing/per-core, so "Flat 01" in the top
        # wing and "Flat 01" in the bottom wing can be two entirely different, physically separate
        # units that happen to share a label (confirmed empirically on a real plan: same label,
        # different room names/dimensions/layout in each occurrence). Grouping cells purely by
        # label text merges their bounding regions into one oversized crop, and Stage 2 then only
        # manages to extract rooms for ONE of the two real flats — the other silently vanishes from
        # the room map entirely, leaving a real, populated part of the floor plan with zero room
        # polygons (this is exactly what caused capture pins there to never resolve to any room).
        #
        # A flat's cells can't be split by grid-adjacency alone — the 3x3 grid's overlapping bands
        # mean two occurrences read in "adjacent" cells can still be genuinely far apart in real
        # image space (confirmed on a real plan). So each occurrence also carries its absolute
        # (x, y) position in the FULL image (0-1), derived from the model's reported in-tile
        # fraction — no extra model calls, just a richer per-tile response schema — and
        # `_split_oversized_flats` clusters occurrences by that actual distance.
        flat_cells: dict[str, list[tuple[int, int]]] = {}
        flat_positions: dict[str, list[tuple[float, float]]] = {}
        for ri, (fy0, fy1) in enumerate(_GRID_BANDS):
            for ci, (fx0, fx1) in enumerate(_GRID_BANDS):
                tile = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
                res = await provider.read_flat_labels(image_b64=_to_jpeg_b64(tile), mime="image/jpeg")
                model = model or res.model
                for entry in res.content.get("flats") or []:
                    if isinstance(entry, dict):
                        num = str(entry.get("number") or "").strip()
                        try:
                            lx = max(0.0, min(1.0, float(entry.get("x", 0.5))))
                            ly = max(0.0, min(1.0, float(entry.get("y", 0.5))))
                        except (TypeError, ValueError):
                            lx = ly = 0.5
                    else:
                        # Tolerate a provider still returning bare strings (old schema).
                        num = str(entry).strip()
                        lx = ly = 0.5
                    if not num:
                        continue
                    flat_cells.setdefault(num, []).append((ci, ri))
                    abs_x = fx0 + lx * (fx1 - fx0)
                    abs_y = fy0 + ly * (fy1 - fy0)
                    flat_positions.setdefault(num, []).append((abs_x, abs_y))

        flat_cells, flat_positions = self._split_oversized_flats(flat_cells, flat_positions)

        # Stage 2 — for each flat, derive a TIGHT crop centred on where its label was actually seen
        # (its occurrences' absolute-position centroid, padded by a fixed margin) rather than the
        # full union of grid bands it appeared in. A band-union crop can be huge — e.g. a label read
        # in bands (row1, row2) spans nearly the whole image height — and sweeps in a neighbouring
        # flat's rooms, which the model then extracts INSTEAD of the target flat's own rooms
        # (confirmed on a real floor plan: a flat's band-union crop also contained a chunk of the
        # building core / an adjacent flat, and the model's response was entirely the wrong flat's
        # rooms). The occurrence positions are a direct, already-available fix for this.
        flats: list[dict[str, Any]] = []
        for num in sorted(flat_cells):
            cells = flat_cells[num]
            positions = flat_positions.get(num) or []
            if positions:
                cx = sum(p[0] for p in positions) / len(positions)
                cy = sum(p[1] for p in positions) / len(positions)
                fx0 = max(0.0, cx - _FLAT_CROP_HALF_SPAN)
                fx1 = min(1.0, cx + _FLAT_CROP_HALF_SPAN)
                fy0 = max(0.0, cy - _FLAT_CROP_HALF_SPAN)
                fy1 = min(1.0, cy + _FLAT_CROP_HALF_SPAN)
            else:
                # No position data (e.g. provider still on the old bare-string schema) — fall back
                # to the previous band-union behaviour.
                fx0 = max(0.0, min(_GRID_BANDS[c][0] for c, _ in cells) - _FLAT_CROP_PAD)
                fx1 = min(1.0, max(_GRID_BANDS[c][1] for c, _ in cells) + _FLAT_CROP_PAD)
                fy0 = max(0.0, min(_GRID_BANDS[r][0] for _, r in cells) - _FLAT_CROP_PAD)
                fy1 = min(1.0, max(_GRID_BANDS[r][1] for _, r in cells) + _FLAT_CROP_PAD)
            crop = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
            gridded = _draw_grid(crop, _CROP_GRID_COLS, _CROP_GRID_ROWS)
            res = await provider.extract_rooms_in_crop(
                image_b64=_to_jpeg_b64(gridded),
                mime="image/jpeg",
                cols=_CROP_GRID_COLS,
                rows=_CROP_GRID_ROWS,
                # Tells the model exactly which flat-number label to target when the crop still
                # catches the edge of a neighbouring flat — a real floor plan showed the model
                # anchoring on the WRONG flat's rooms when two labels were both visible in-crop.
                target_flat_number=num.split(" (")[0],
            )
            model = model or res.model
            rooms = _parse_rooms(
                res.content.get("rooms"),
                crop_box=(fx0, fy0, fx1, fy1),
                # Ownership = the flat's crop region in percent (rooms outside it are neighbour bleed).
                own_x=(fx0 * 100, fx1 * 100),
                own_y=(fy0 * 100, fy1 * 100),
                exclude_common=True,
                label=f"Flat {num}",
            )
            if rooms:
                flats.append({"flat": f"Flat {num}", "rooms": rooms})

        # Stage 3 — extract building-core / common areas from the central crop, so pins in the
        # lift lobby / shafts resolve to a common area instead of a neighbouring flat's room.
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
            pass  # provider without common-area support — flats still extracted

        return flats, model

    def _split_oversized_flats(
        self,
        flat_cells: dict[str, list[tuple[int, int]]],
        flat_positions: dict[str, list[tuple[float, float]]],
    ) -> tuple[dict[str, list[tuple[int, int]]], dict[str, list[tuple[float, float]]]]:
        """
        Splits a flat label into multiple distinct flats when its occurrences
        (already gathered in Stage 1 — no extra model calls here) sit far
        apart in the FULL IMAGE, using each occurrence's absolute (x, y)
        position (derived from the model's reported in-tile fraction, see
        `_extract_flats`).

        Grid CELL adjacency alone can't disambiguate this: `_GRID_BANDS`'s
        overlapping bands mean two occurrences read in "adjacent" cells (e.g.
        row 1 and row 2) can still be genuinely far apart in absolute terms.
        Absolute distance is the actual test that matters; cell indices were
        only ever a proxy for it.

        Occurrences farther apart than one grid band's width (each band spans
        45% of the axis) are treated as genuinely separate flats — anything
        closer is treated as repeated/overlapping readings of the same flat.

        Returns both the (possibly split) cell map AND the matching position
        map, so Stage 2 can derive each resulting flat's crop from ITS OWN
        occurrences' positions rather than the full original cell-band union
        (a tight, position-centred crop avoids sweeping in a neighbouring
        flat's rooms — see `_extract_flats` Stage 2 for why an oversized crop
        caused wrong-flat room extraction on a real floor plan).

        This replaced an earlier attempt that re-cropped a synthetic "half" of
        the bounding box and asked the model to re-read it — that was
        unreliable because the arbitrary split point could land on the wrong
        side of where the label actually printed, making a real second flat
        look like "no evidence" purely by bad luck of geometry.
        """
        _SEPARATION_THRESHOLD = 0.40  # slightly under one band's 0.45 width

        result_cells: dict[str, list[tuple[int, int]]] = {}
        result_positions: dict[str, list[tuple[float, float]]] = {}

        for num, cells in flat_cells.items():
            positions = flat_positions.get(num) or []
            if len(positions) < 2:
                result_cells[num] = cells
                result_positions[num] = positions
                continue

            clusters: list[list[int]] = []  # each entry: indices into `positions`
            for i, pos in enumerate(positions):
                placed = False
                for cluster in clusters:
                    # Compare against the cluster's current centroid.
                    cx = sum(positions[j][0] for j in cluster) / len(cluster)
                    cy = sum(positions[j][1] for j in cluster) / len(cluster)
                    if ((pos[0] - cx) ** 2 + (pos[1] - cy) ** 2) ** 0.5 <= _SEPARATION_THRESHOLD:
                        cluster.append(i)
                        placed = True
                        break
                if not placed:
                    clusters.append([i])

            if len(clusters) < 2:
                result_cells[num] = cells
                result_positions[num] = positions
                continue

            # Cells and positions were appended in the same order per num (see
            # `_extract_flats` Stage 1), so index `idx` in `cells` corresponds
            # to index `idx` in `positions` — zip them directly.
            cell_buckets: list[list[tuple[int, int]]] = [[] for _ in clusters]
            pos_buckets: list[list[tuple[float, float]]] = [[] for _ in clusters]
            for idx, cell in enumerate(cells):
                for gi, cluster in enumerate(clusters):
                    if idx in cluster:
                        cell_buckets[gi].append(cell)
                        pos_buckets[gi].append(positions[idx])
                        break

            keep = [i for i, b in enumerate(cell_buckets) if b]
            if len(keep) < 2:
                result_cells[num] = cells
                result_positions[num] = positions
                continue

            logger.info(
                "[room-map] flat label '{}' occurrences are far apart in absolute "
                "position — splitting into {} separate flats (cells={}, positions={})",
                num, len(keep), cells, positions,
            )
            for out_idx, gi in enumerate(keep, start=1):
                key = f"{num} ({chr(64 + out_idx)})"
                result_cells[key] = cell_buckets[gi]
                result_positions[key] = pos_buckets[gi]

        return result_cells, result_positions

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
        Self-heals floor plans uploaded before this feature existed: if no cache
        row exists yet, extraction is run lazily here (once) instead of forever
        falling back. Falls back to ("Unknown", fallback_pin_name) if the floor
        plan can't be found, extraction fails, or the pin lands outside every
        detected room — never raises.
        """
        if floor_plan_id:
            cached = await self.get_cached(floor_plan_id, org_id)
            if cached is None:
                cached = await self._extract_for_existing_plan(floor_plan_id, org_id)
            flats = (cached or {}).get("flats") or []
            located = locate_pin(flats, pin_x, pin_y)
            if located:
                return located
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
