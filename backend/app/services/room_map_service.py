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

# The building core sits in the centre of the plan; crop a generous central band for common-area
# extraction. (fx0, fy0, fx1, fy1) as fractions of the full image.
_CORE_TILE = (0.28, 0.28, 0.72, 0.72)


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


def locate_pin(
    flats: list[dict[str, Any]],
    pin_x: float | None,
    pin_y: float | None,
) -> tuple[str, str] | None:
    """
    Resolve a pin (x, y) to (flat, room) by EXACT point-in-polygon containment only.

    Deliberately NO nearest-room fallback: for construction progress a wrong room is worse than a
    missing one, so a pin that lands inside no detected room returns None (the caller then shows the
    honest "Pin N" fallback) rather than being snapped to an adjacent/neighbouring room.
    """
    if pin_x is None or pin_y is None:
        return None
    for flat_entry in flats:
        for room in flat_entry.get("rooms", []):
            if _point_in_polygon(pin_x, pin_y, room["polygon"]):
                return flat_entry["flat"], room["name"]
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
        flat_cells: dict[str, list[tuple[int, int]]] = {}
        for ri, (fy0, fy1) in enumerate(_GRID_BANDS):
            for ci, (fx0, fx1) in enumerate(_GRID_BANDS):
                tile = full.crop((int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)))
                res = await provider.read_flat_labels(image_b64=_to_jpeg_b64(tile), mime="image/jpeg")
                model = model or res.model
                for num in res.content.get("flats") or []:
                    num = str(num).strip()
                    if num:
                        flat_cells.setdefault(num, []).append((ci, ri))

        # Stage 2 — for each flat, derive its crop region from the union of bands it appeared in,
        # extract rooms there, and keep only rooms whose centre falls in that region.
        flats: list[dict[str, Any]] = []
        for num in sorted(flat_cells):
            cells = flat_cells[num]
            # Bounding fractional region across all bands this flat's label was seen in, padded.
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
