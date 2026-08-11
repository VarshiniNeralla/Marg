"""
Orchestrates AI Construction Progress Monitoring: joins real floor/capture/
room-map data with a ConstructionProgressProvider (a real vLLM vision model)
and persists the result as an immutable snapshot per floor per day — the
source of truth for the progress dashboard, timeline, heatmap, and
comparison views.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.construction_progress_providers import (
    ALL_ACTIVITIES,
    COMPLETE_THRESHOLD,
    CaptureRef,
    ConstructionProgressProvider,
    VllmConstructionProgressProvider,
)
from app.services.flat_finishing_rosters import complete_flat_room_roster
from app.services.pin_orphan_service import restore_orphan_pins_for_floor
from app.services.room_map_service import (
    RoomMapService,
    _COMMON_AREA_FLAT,
    _canonical_flat_label,
    _point_in_polygon,
    locate_pin,
)

_COLLECTION = "construction_progress_snapshots"
_PIN_HALO_HALF = 2.5  # % of floor-plan width/height for per-pin fallback boxes
# Grow room AABBs just enough to enclose pins that locate_pin already attributed
# via its edge-tolerance (pins often sit 1–3% outside coarse AI grid boxes).
_ROOM_EXPAND_PAD = 0.75
# Room AABBs thinner than this (full-image %) are treated as degenerate — expand
# so the UI wash is actually visible (Floor-1 Living strips after Puja carve).
_MIN_VISIBLE_ROOM_SPAN = 3.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_polygon(polygon: list[Any]) -> list[dict[str, float]]:
    pts: list[dict[str, float]] = []
    for p in polygon or []:
        if isinstance(p, dict) and "x" in p and "y" in p:
            pts.append({"x": float(p["x"]), "y": float(p["y"])})
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            pts.append({"x": float(p[0]), "y": float(p[1])})
    return pts


def _room_key(flat: str, room: str) -> tuple[str, str]:
    return _canonical_flat_label(flat), str(room or "").strip().lower()


def _aabb_polygon(x0: float, x1: float, y0: float, y1: float) -> list[dict[str, float]]:
    x0 = max(0.0, min(100.0, x0))
    x1 = max(0.0, min(100.0, x1))
    y0 = max(0.0, min(100.0, y0))
    y1 = max(0.0, min(100.0, y1))
    return [
        {"x": x0, "y": y0},
        {"x": x1, "y": y0},
        {"x": x1, "y": y1},
        {"x": x0, "y": y1},
    ]


def _expand_polygon_to_include(
    polygon: list[dict[str, float]],
    points: list[tuple[float, float]],
    *,
    pad: float = _ROOM_EXPAND_PAD,
) -> list[dict[str, float]]:
    """Expand a room AABB so every attributed pin tip falls inside the drawn box."""
    if not polygon:
        return polygon
    xs = [p["x"] for p in polygon]
    ys = [p["y"] for p in polygon]
    for x, y in points:
        xs.append(x)
        ys.append(y)
    return _aabb_polygon(min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)


def _pin_halo_polygon(x: float, y: float, half: float = _PIN_HALO_HALF) -> list[dict[str, float]]:
    return _aabb_polygon(x - half, x + half, y - half, y + half)


def _align_heatmap_to_pins(
    room_heatmap: list[dict[str, Any]],
    *,
    pins: list[dict[str, Any]],
    captures: list[CaptureRef],
    flats: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Lock pin labels to locate_pin; keep room-map polygons unexpanded.

    Expanding AABBs so every attributed pin sits inside caused heavy overlap
    (one pin inside neighbour boxes grew several rooms at once). Drawn boxes
    stay as the room map extracted them; pin→room identity lives on
    ``heatmapPins`` (used by the UI when a pin is clicked).
    """
    caps_by_pin: dict[str, list[CaptureRef]] = {}
    for cap in captures:
        if cap.pin_id:
            caps_by_pin.setdefault(cap.pin_id, []).append(cap)

    state_by_room: dict[tuple[str, str], str] = {
        _room_key(str(r.get("flatName") or ""), str(r.get("roomName") or "")): str(
            r.get("state") or "no_images"
        )
        for r in room_heatmap
    }

    heatmap_pins: list[dict[str, Any]] = []
    for pin in pins:
        pin_id = str(pin.get("_id") or pin.get("id") or "")
        pin_caps = caps_by_pin.get(pin_id) or []
        if not pin_caps:
            continue
        try:
            x = float(pin.get("x"))
            y = float(pin.get("y"))
        except (TypeError, ValueError):
            continue
        # Start from capture attribution (same locate pass used for scoring),
        # then re-resolve against the current room map so labels stay in sync.
        # Human review override always wins (Floor-1 pin room corrections).
        flat_name = pin_caps[0].flat_name
        room_name = pin_caps[0].room_name
        resolved = True
        if pin.get("correctedFlatName") and pin.get("correctedRoomName"):
            flat_name = _canonical_flat_label(str(pin["correctedFlatName"]))
            room_name = str(pin["correctedRoomName"])
        else:
            located = locate_pin(flats, x, y)
            resolved = located is not None
            if located:
                flat_name, room_name = located[0], located[1]
                flat_name = _canonical_flat_label(flat_name)
        state = state_by_room.get(_room_key(flat_name, room_name), "in_progress")
        if state in ("no_images", "uploaded"):
            state = "in_progress"
        human_attributed = bool(pin.get("correctedFlatName") and pin.get("correctedRoomName"))
        heatmap_pins.append({
            "pinId": pin_id,
            "sequenceNumber": int(pin.get("sequenceNumber") or pin.get("sequence_number") or 0),
            "x": x,
            "y": y,
            "flatName": flat_name,
            "roomName": room_name,
            "state": state,
            "capturesCount": len(pin_caps),
            "resolved": resolved,
            "humanAttributed": human_attributed,
        })

    pins_by_room: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for p in heatmap_pins:
        pins_by_room.setdefault(_room_key(p["flatName"], p["roomName"]), []).append(p)

    aligned: list[dict[str, Any]] = []
    covered_pin_ids: set[str] = set()
    for room in room_heatmap:
        state = str(room.get("state") or "no_images")
        if state == "uploaded":
            state = "in_progress"
        flat_name = str(room.get("flatName") or "")
        room_name = str(room.get("roomName") or "")
        key = _room_key(flat_name, room_name)
        if state == "no_images":
            aligned.append({**room, "state": state})
            continue
        poly = _normalize_polygon(room.get("polygon") or [])
        if not poly:
            continue
        room_pins = pins_by_room.get(key) or []
        pins_inside = [
            p for p in room_pins
            if _point_in_polygon(float(p["x"]), float(p["y"]), poly)
        ]
        human_pins = [p for p in room_pins if p.get("humanAttributed")]
        # Human room overrides may place the tip in a neighbour polygon (e.g. Puja
        # tip labelled Living / Dining). Still draw this room's wash for those pins.
        if room_pins and not pins_inside and not human_pins:
            continue
        if not room_pins:
            continue
        draw_pins = room_pins if human_pins else pins_inside
        captures_count = max(
            int(room.get("capturesCount") or 0),
            sum(int(p["capturesCount"]) for p in room_pins),
        )
        xs = [p["x"] for p in poly]
        ys = [p["y"] for p in poly]
        span_x = max(xs) - min(xs) if xs else 0.0
        span_y = max(ys) - min(ys) if ys else 0.0
        draw_poly = poly
        if human_pins or span_x < _MIN_VISIBLE_ROOM_SPAN or span_y < _MIN_VISIBLE_ROOM_SPAN:
            draw_poly = _expand_polygon_to_include(
                poly,
                [(float(p["x"]), float(p["y"])) for p in draw_pins],
                pad=max(_ROOM_EXPAND_PAD, 2.0),
            )
        aligned.append({
            **room,
            "polygon": draw_poly,
            "state": state,
            "capturesCount": captures_count,
            "pinNumbers": sorted(
                {int(p["sequenceNumber"]) for p in draw_pins if p.get("sequenceNumber")}
            ),
        })
        for p in draw_pins:
            covered_pin_ids.add(p["pinId"])

    # locate_pin miss (or name not on the room-map roster): personal halo so
    # the pin still has a clickable room identity.
    for p in heatmap_pins:
        if p["pinId"] in covered_pin_ids:
            continue
        aligned.append({
            "flatName": p["flatName"],
            "roomName": p["roomName"],
            "polygon": _pin_halo_polygon(p["x"], p["y"]),
            "state": p["state"],
            "capturesCount": p["capturesCount"],
            "pinNumbers": [int(p["sequenceNumber"])] if p.get("sequenceNumber") else [],
        })

    for p in heatmap_pins:
        p.pop("resolved", None)
        p.pop("humanAttributed", None)
    heatmap_pins.sort(key=lambda p: p["sequenceNumber"])
    return aligned, heatmap_pins


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def get_construction_progress_provider(
    db: AsyncIOMotorDatabase | None = None,
) -> ConstructionProgressProvider:
    """Factory — settings-driven (T11).

    CONSTRUCTION_PROGRESS_PROVIDER:
      vllm     — local Gemma only (default; fully restores prior behaviour)
      hybrid   — local first, Claude escalation hooks available
      anthropic — Claude-only (requires ANTHROPIC_API_KEY + anthropic package)
    """
    from app.core.config import get_settings

    settings = get_settings()
    kind = (settings.CONSTRUCTION_PROGRESS_PROVIDER or "vllm").strip().lower()
    if kind == "hybrid":
        from app.services.construction_progress_providers.hybrid_provider import (
            HybridConstructionProgressProvider,
        )
        return HybridConstructionProgressProvider(settings, db=db)
    if kind == "anthropic":
        from app.services.construction_progress_providers.anthropic_provider import (
            AnthropicConstructionProgressProvider,
        )
        return AnthropicConstructionProgressProvider(settings, db=db)
    return VllmConstructionProgressProvider(db=db)


class ConstructionProgressService:
    def __init__(
        self,
        db: AsyncIOMotorDatabase,
        *,
        provider: ConstructionProgressProvider | None = None,
    ) -> None:
        self._db = db
        # Provider gets `db` so it can reuse cached derived rig views instead
        # of reprojecting every panorama on every analyze run.
        self._provider = provider or get_construction_progress_provider(db)
        self._room_maps = RoomMapService(db)

    # ── Floor + capture resolution ────────────────────────────────────────────

    async def _get_floor_context(self, org_id: str, floor_id: str) -> dict[str, Any] | None:
        floor = await self._db["floors"].find_one({"_id": floor_id, "orgId": org_id}) \
            or await self._db["floors"].find_one({"id": floor_id, "orgId": org_id})
        if not floor:
            return None
        tower = await self._db["towers"].find_one({"_id": floor.get("towerId"), "orgId": org_id}) \
            or await self._db["towers"].find_one({"id": floor.get("towerId"), "orgId": org_id})
        project_id = tower.get("projectId") if tower else None
        project = None
        if project_id:
            project = await self._db["projects"].find_one({"_id": project_id, "orgId": org_id}) \
                or await self._db["projects"].find_one({"id": project_id, "orgId": org_id})
        floor_plan = await self._db["floor_plans"].find_one(
            {"floorId": floor_id, "orgId": org_id}, sort=[("createdAt", -1)]
        )
        return {
            "floorId": floor_id,
            "floorLabel": floor.get("label") or "",
            "towerId": floor.get("towerId") or "",
            "towerName": (tower or {}).get("name") or "",
            "projectId": project_id or "",
            "projectName": (project or {}).get("name") or "",
            "floorPlanId": (floor_plan or {}).get("_id") or (floor_plan or {}).get("id") or "",
            "floorPlanImageUrl": str((floor_plan or {}).get("fileUrl") or (floor_plan or {}).get("file_url") or ""),
        }

    async def _get_capture_refs(self, org_id: str, floor_id: str, floor_plan_id: str) -> list[CaptureRef]:
        """Floor -> capture_pins -> captures (by captureIds AND by pin roomId).

        Captures don't reliably carry floorId, so pins are the join key. Linking
        used to require pin.captureIds only — when createCapture landed without
        updateCapturePin(captureIds), the photo stayed in the gallery as an
        orphan and never entered analysis. We also pull captures whose roomId
        matches a pin's backing room and self-heal captureIds so the undercount
        cannot recur.
        """
        pins = await self._db["capture_pins"].find({"orgId": org_id, "floorId": floor_id}).to_list(length=1000)
        # Pull floor-prefixed captures even when no pin exists yet — restore may
        # have just recreated pins, but also covers mid-flight orphans.
        if not pins:
            # Last-chance restore when every pin was wiped but captures remain.
            await restore_orphan_pins_for_floor(
                self._db,
                org_id=org_id,
                floor_id=floor_id,
                floor_plan_id=floor_plan_id or None,
                resequence=True,
            )
            pins = await self._db["capture_pins"].find({"orgId": org_id, "floorId": floor_id}).to_list(length=1000)
        if not pins:
            return []

        # Refine sparse room maps with pin positions BEFORE locating each pin
        # (Floor-1 Flat 02 extracts often miss Bedroom-3/4 / balconies / toilets).
        pin_hints: list[tuple[float, float]] = []
        for pin in pins:
            try:
                pin_hints.append((float(pin["x"]), float(pin["y"])))
            except (KeyError, TypeError, ValueError):
                continue
        if floor_plan_id and pin_hints:
            await self._room_maps.get_sanitized_flats(
                floor_plan_id, org_id, pin_hints=pin_hints,
            )

        capture_ids: list[str] = []
        pin_by_capture: dict[str, dict[str, Any]] = {}
        pin_by_room: dict[str, dict[str, Any]] = {}
        room_ids: list[str] = []
        for pin in pins:
            room_id = str(pin.get("roomId") or pin.get("room_id") or "")
            if room_id:
                pin_by_room[room_id] = pin
                room_ids.append(room_id)
            for cid in pin.get("captureIds") or pin.get("capture_ids") or []:
                if not cid:
                    continue
                cid_s = str(cid)
                capture_ids.append(cid_s)
                pin_by_capture[cid_s] = pin

        # Room-owned captures (may be missing from captureIds after a sync race).
        room_captures: list[dict[str, Any]] = []
        if room_ids:
            room_captures = await self._db["captures"].find(
                {
                    "orgId": org_id,
                    "$or": [
                        {"roomId": {"$in": room_ids}},
                        {"room_id": {"$in": room_ids}},
                    ],
                }
            ).to_list(length=2000)

        for cap in room_captures:
            cap_id = str(cap.get("id") or cap.get("_id") or "")
            if not cap_id:
                continue
            room_id = str(cap.get("roomId") or cap.get("room_id") or "")
            pin = pin_by_room.get(room_id)
            if not pin:
                continue
            if cap_id not in pin_by_capture:
                # Self-heal: persist the missing link so gallery/analysis/pins converge.
                pin_key = pin.get("_id") or pin.get("id")
                if pin_key:
                    await self._db["capture_pins"].update_one(
                        {"_id": pin_key, "orgId": org_id},
                        {"$addToSet": {"captureIds": cap_id}},
                    )
                    logger.info(
                        "[construction-progress] healed orphan capture={} onto pin={} via roomId={}",
                        cap_id, pin_key, room_id,
                    )
                pin_by_capture[cap_id] = pin
                capture_ids.append(cap_id)

        if not capture_ids:
            return []

        # Deduplicate ids while keeping order.
        seen_ids: set[str] = set()
        unique_ids: list[str] = []
        for cid in capture_ids:
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            unique_ids.append(cid)

        captures = await self._db["captures"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": unique_ids}}, {"id": {"$in": unique_ids}}]}
        ).to_list(length=2000)

        refs: list[CaptureRef] = []
        for cap in captures:
            cap_id = str(cap.get("id") or cap.get("_id") or "")
            pin = pin_by_capture.get(cap_id)
            # Defence-in-depth against stale/corrupted pin<->capture links: a
            # capture's own roomId is stamped from the pin that created it, so
            # it must start with that pin's floorId. Without this check, a
            # leftover captureId on the wrong pin (confirmed to happen from old
            # seed/demo data) would silently pull a DIFFERENT floor's photo
            # into this floor's analysis — evidence for one floor showing up
            # under another floor's activities.
            if pin:
                pin_floor = str(pin.get("floorId") or "")
                cap_room = str(cap.get("roomId") or cap.get("room_id") or "")
                if pin_floor and cap_room and not cap_room.startswith(pin_floor):
                    logger.warning(
                        "[construction-progress] skipping capture={} — belongs to roomId={} "
                        "but is linked from a pin on floorId={} (stale pin<->capture link)",
                        cap_id, cap_room, pin_floor,
                    )
                    continue
            flat_name, room_name = _FALLBACK_LOCATION
            if pin and floor_plan_id:
                # Human review override wins over geometry (Floor-1 pin corrections).
                if pin.get("correctedFlatName") and pin.get("correctedRoomName"):
                    flat_name = str(pin["correctedFlatName"])
                    room_name = str(pin["correctedRoomName"])
                else:
                    flat_name, room_name = await self._room_maps.resolve_pin_location(
                        floor_plan_id=floor_plan_id,
                        org_id=org_id,
                        pin_x=pin.get("x"),
                        pin_y=pin.get("y"),
                        fallback_pin_name=cap.get("roomName") or f"Pin {pin.get('sequenceNumber', '?')}",
                    )
            image_url = str(
                cap.get("processedPanoramaUrl")
                or cap.get("original_url")
                or cap.get("originalFileUrl")
                or cap.get("thumbnailUrl")
                or ""
            )
            captured_at = _parse_dt(cap.get("createdAt")) or _parse_dt(cap.get("uploadedAt"))
            refs.append(
                CaptureRef(
                    capture_id=cap_id,
                    pin_id=str((pin or {}).get("_id") or (pin or {}).get("id") or ""),
                    room_name=room_name,
                    flat_name=flat_name,
                    captured_at=captured_at,
                    image_url=image_url,
                )
            )
        return refs

    async def _get_room_heatmap(
        self,
        org_id: str,
        floor_plan_id: str,
        activities_by_room: dict[tuple[str, str], list[float]],
        captures_by_room: dict[tuple[str, str], int],
    ) -> list[dict[str, Any]]:
        """Colors every room the floor plan's room-map knows about.

        "no_images" vs the rest is driven by REAL capture presence
        (`captures_by_room`, built directly from resolved pin->room captures)
        — NOT by whether the AI found confirmable activity evidence there.
        Those are different questions: a room can have real uploaded photos
        that the model simply couldn't match to any checklist activity. Product
        rule: any photographed room is "in_progress" (field capture implies
        work is underway) — never a separate "uploaded / unconfirmed" state.
        Only rooms with zero captures stay "no_images".
        """
        if not floor_plan_id:
            return []
        cached = await self._room_maps.get_cached(floor_plan_id, org_id)
        flats = await self._room_maps.get_sanitized_flats(
            floor_plan_id, org_id, cached=cached,
        )

        heatmap: list[dict[str, Any]] = []
        for flat_entry in flats:
            flat_name = _canonical_flat_label(str(flat_entry.get("flat") or ""))
            for room in flat_entry.get("rooms") or []:
                room_name = room.get("name") or ""
                polygon = room.get("polygon") or []
                key = (flat_name, room_name)
                # Case-insensitive + legacy A/B/C flat labels so status isn't lost.
                legacy_keys = [
                    k for k in captures_by_room
                    if str(k[1]).strip().lower() == str(room_name).strip().lower()
                    and _canonical_flat_label(k[0]) == flat_name
                ]
                captures_count = captures_by_room.get(key, 0)
                if not captures_count:
                    captures_count = sum(captures_by_room.get(k, 0) for k in legacy_keys)
                pcts = list(activities_by_room.get(key, []))
                if not pcts:
                    for k in activities_by_room:
                        if (
                            str(k[1]).strip().lower() == str(room_name).strip().lower()
                            and _canonical_flat_label(k[0]) == flat_name
                        ):
                            pcts.extend(activities_by_room.get(k, []))
                if captures_count == 0:
                    state = "no_images"
                elif pcts and all(p >= COMPLETE_THRESHOLD for p in pcts):
                    state = "completed"
                else:
                    # Captured = work in progress, whether or not the model
                    # returned activity percentages yet.
                    state = "in_progress"
                heatmap.append({
                    "flatName": flat_name,
                    "roomName": room_name,
                    "polygon": polygon,
                    "state": state,
                    "capturesCount": captures_count,
                })
        return heatmap

    # ── Snapshot generation ────────────────────────────────────────────────────

    async def analyze_floor(
        self,
        org_id: str,
        floor_id: str,
        *,
        as_of: datetime | None = None,
        analyzed_by: str | None = None,
    ) -> dict[str, Any]:
        context = await self._get_floor_context(org_id, floor_id)
        if not context:
            raise ValueError("Floor not found")

        as_of = as_of or _utcnow()
        floor_plan_id = context.get("floorPlanId") or ""
        # Upgrade / rebuild stale room maps (schema v2 drops Flat 01 (A)/(B)
        # phantoms) before resolving pins, so capture assignment and heatmap
        # share the same canonical flat list.
        if floor_plan_id and context.get("floorPlanImageUrl"):
            await self._room_maps.ensure_room_map(
                floor_plan_id=floor_plan_id,
                org_id=org_id,
                image_url=str(context["floorPlanImageUrl"]),
                force=False,
            )
        # Recreate pins for captures whose backing pin/room was deleted in a
        # sync race — otherwise Images Analyzed undercounts and Pin N vanishes
        # from the plan while still appearing in the gallery.
        restored = await restore_orphan_pins_for_floor(
            self._db,
            org_id=org_id,
            floor_id=floor_id,
            floor_plan_id=floor_plan_id or None,
            resequence=True,
        )
        if restored:
            logger.info(
                "[construction-progress] restored {} orphan pin(s) before analyze floor={}",
                restored, floor_id,
            )
        captures = await self._get_capture_refs(org_id, floor_id, floor_plan_id)
        # Defence-in-depth: never leave A/B/C on capture refs even if a stale
        # map briefly resolved them that way.
        captures = [
            CaptureRef(
                capture_id=c.capture_id,
                pin_id=c.pin_id,
                room_name=c.room_name,
                flat_name=_canonical_flat_label(c.flat_name),
                captured_at=c.captured_at,
                image_url=c.image_url,
            )
            for c in captures
        ]
        capture_lookup = {c.capture_id: c for c in captures}

        # "Flat Finishing Works" must reach 100% only once EVERY ROOM in every
        # physical flat confirms an activity, not just one photographed room
        # in that flat — so the provider needs the full roster of rooms per
        # flat (and per common-area) from the room map, not just the ones
        # that happen to have a capture yet. A room with zero evidence still
        # occupies a denominator slot (it contributes 0%), which is what
        # makes "2 of 40 rooms done" read as 5%, not 100%.
        flat_units: list[str] = []
        common_area_units: list[str] = []
        flat_room_rosters: dict[str, list[str]] = {}
        sanitized_flats: list[dict[str, Any]] = []
        if floor_plan_id:
            cached_room_map = await self._room_maps.get_cached(floor_plan_id, org_id)
            sanitized_flats = await self._room_maps.get_sanitized_flats(
                floor_plan_id, org_id, cached=cached_room_map,
            )
            for flat_entry in sanitized_flats:
                flat_name = _canonical_flat_label(str(flat_entry.get("flat") or ""))
                if not flat_name:
                    continue
                # Preserve every room polygon on this flat (including duplicate
                # Dress/Sit-Out after disambiguation). Order is stable for UI.
                room_names = [
                    str(r.get("name") or "").strip()
                    for r in (flat_entry.get("rooms") or [])
                    if str(r.get("name") or "").strip()
                ]
                if flat_name == _COMMON_AREA_FLAT:
                    common_area_units = room_names
                else:
                    flat_units.append(flat_name)
                    # Guarantee every functional room on the floor plan appears
                    # in Flat Finishing (extract/sanitize often omit Kitchen,
                    # Multi-Purpose, labeled Dress/Balcony, etc.).
                    flat_room_rosters[flat_name] = complete_flat_room_roster(
                        flat_name, room_names,
                    )

        # Any pin-attributed room must appear in Flat Finishing even if the
        # room-map roster briefly omitted it (name drift / late sanitize).
        for cap in captures:
            fname = _canonical_flat_label(cap.flat_name)
            rname = str(cap.room_name or "").strip()
            if not fname or not rname or fname == _COMMON_AREA_FLAT or fname == "Unknown":
                continue
            roster = flat_room_rosters.setdefault(fname, [])
            if fname not in flat_units:
                flat_units.append(fname)
            if rname not in roster:
                roster.append(rname)

        # Re-complete after capture union so templates still fill gaps.
        for fname in list(flat_room_rosters.keys()):
            if fname == _COMMON_AREA_FLAT:
                continue
            flat_room_rosters[fname] = complete_flat_room_roster(
                fname, flat_room_rosters[fname],
            )

        # Factual site metadata — rendered into the vision prompt as facts
        # (not instructions) so the model treats project/tower/floor as
        # provenance context without letting it inflate confidence. T7e.
        provider_context: dict[str, str] = {
            "org_id": org_id,
            "project_name": str(context.get("projectName") or ""),
            "tower_name": str(context.get("towerName") or ""),
            "floor_label": str(context.get("floorLabel") or ""),
            "captured_at": as_of.isoformat() if as_of else "",
        }
        result = await self._provider.assess_floor_progress(
            floor_id=floor_id,
            activities=ALL_ACTIVITIES,
            captures=captures,
            as_of=as_of,
            flat_units=flat_units or None,
            common_area_units=common_area_units or None,
            flat_room_rosters=flat_room_rosters or None,
            context=provider_context,
        )

        # Built from each capture's OWN raw per-activity results, not from
        # which capture "won" an activity's flat-level best-evidence
        # comparison. A room's heatmap status must reflect what its own
        # photo showed — a sibling room in the same flat scoring higher on
        # the same activities must never make THIS room look untouched, even
        # though only one of them can be the flat-level "winner" for the
        # activity card. Falls back to the old evidence-id-based behaviour
        # for a provider that doesn't populate per_capture_completion.
        activities_by_room: dict[tuple[str, str], list[float]] = {}
        if result.per_capture_completion:
            for cap_id, pcts in result.per_capture_completion.items():
                cap = capture_lookup.get(cap_id)
                if cap:
                    activities_by_room.setdefault((cap.flat_name, cap.room_name), []).extend(pcts)
        else:
            for a in result.activities:
                for cid in a.evidence_capture_ids:
                    cap = capture_lookup.get(cid)
                    if cap:
                        activities_by_room.setdefault((cap.flat_name, cap.room_name), []).append(a.completion_pct)

        activity_docs = []
        for a in result.activities:
            activity_docs.append({
                "activityId": a.activity.activity_id,
                "name": a.activity.name,
                "section": a.activity.section,
                "sequenceIndex": a.activity.sequence_index,
                "status": a.status,
                "completionPct": a.completion_pct,
                "confidencePct": a.confidence_pct,
                "evidenceCaptureIds": a.evidence_capture_ids,
            })

        captures_by_room: dict[tuple[str, str], int] = {}
        for cap in captures:
            key = (cap.flat_name, cap.room_name)
            captures_by_room[key] = captures_by_room.get(key, 0) + 1

        room_heatmap = await self._get_room_heatmap(
            org_id, context["floorPlanId"], activities_by_room, captures_by_room
        )

        pins_for_align = await self._db["capture_pins"].find(
            {"orgId": org_id, "floorId": floor_id}
        ).to_list(length=1000)
        flats_for_align: list[dict[str, Any]] = []
        if floor_plan_id:
            cached_for_align = await self._room_maps.get_cached(floor_plan_id, org_id)
            flats_for_align = await self._room_maps.get_sanitized_flats(
                floor_plan_id, org_id, cached=cached_for_align,
            )
        room_heatmap, heatmap_pins = _align_heatmap_to_pins(
            room_heatmap,
            pins=pins_for_align,
            captures=captures,
            flats=flats_for_align,
        )

        # Three honest buckets, not two: lumping "actively being worked on,
        # with real photos" together with "never photographed at all" under
        # one "pending" number is what made a floor with visible in-progress
        # rooms still read as "0 completed / 54 pending" — indistinguishable
        # from a floor nobody has touched yet.
        rooms_completed = sum(1 for r in room_heatmap if r["state"] == "completed")
        rooms_in_progress = sum(1 for r in room_heatmap if r["state"] in ("uploaded", "in_progress"))
        # Legacy snapshots may still carry "uploaded"; treat as in_progress for counts.
        rooms_not_started = sum(1 for r in room_heatmap if r["state"] == "no_images")
        # Activity status buckets (v4.4):
        activities_completed = sum(1 for a in activity_docs if a["status"] == "completed")
        activities_in_progress = sum(1 for a in activity_docs if a["status"] == "in_progress")
        activities_not_assessed = sum(1 for a in activity_docs if a["status"] == "not_assessed")
        activities_not_observable = sum(1 for a in activity_docs if a["status"] == "not_observable")
        # Legacy "no_evidence" (should be rare after evidence-aware status) counts
        # with not_assessed for summary totals.
        activities_no_evidence = sum(1 for a in activity_docs if a["status"] == "no_evidence")
        activities_not_started = activities_not_assessed + activities_not_observable + activities_no_evidence
        confident_docs = [a for a in activity_docs if a["confidencePct"] > 0]
        avg_confidence = (
            round(sum(a["confidencePct"] for a in confident_docs) / len(confident_docs), 1)
            if confident_docs else 0.0
        )
        last_inspection = max((c.captured_at for c in captures if c.captured_at), default=None)

        # Floor-level status: "Completed" only if EVERY scorable activity is
        # "completed". not_observable is excluded (cannot finish from photos).
        # not_assessed still blocks "Completed" — required areas without
        # photos must not let the floor read as done.
        scorable_activity_docs = [
            a for a in activity_docs if a["status"] != "not_observable"
        ]
        overall_status = (
            "completed"
            if scorable_activity_docs and all(a["status"] == "completed" for a in scorable_activity_docs)
            else "in_progress"
        )

        flat_progress_docs = [
            {
                "flatName": fp.flat_name,
                "completionPct": fp.completion_pct,
                "roomsComplete": fp.rooms_complete,
                "roomsTotal": fp.rooms_total,
                "roomsRequired": getattr(fp, "rooms_required", fp.rooms_total),
                "roomsPhotographed": getattr(fp, "rooms_photographed", fp.rooms_total),
                "isFullyComplete": getattr(fp, "is_fully_complete", False),
                "rooms": [
                    {
                        "roomName": r.room_name,
                        "isComplete": r.is_complete,
                        "activities": [
                            {
                                "activityId": a.activity_id,
                                "activityName": a.activity_name,
                                "completionPct": a.completion_pct,
                                "confidencePct": a.confidence_pct,
                                "evidenceCaptureIds": a.evidence_capture_ids,
                                "evidence": a.evidence or "",
                                "status": (
                                    getattr(a, "status", None)
                                    or (
                                        "completed" if a.completion_pct >= 100.0
                                        else "in_progress" if (
                                            a.completion_pct > 0 or a.evidence_capture_ids
                                        )
                                        else "no_evidence"
                                    )
                                ),
                            }
                            for a in r.activities
                        ],
                    }
                    for r in fp.rooms
                ],
            }
            for fp in result.flat_progress
        ]

        # Guarantee every flat's full room-map roster is present in Flat
        # Finishing Works (provider may omit empty rooms on some paths).
        by_flat_doc = {
            _canonical_flat_label(str(d["flatName"])): d for d in flat_progress_docs
        }
        for flat_name, room_names in flat_room_rosters.items():
            doc_fp = by_flat_doc.get(flat_name)
            if doc_fp is None:
                doc_fp = {
                    "flatName": flat_name,
                    "completionPct": 0.0,
                    "roomsComplete": 0,
                    "roomsTotal": len(room_names),
                    "rooms": [],
                }
                flat_progress_docs.append(doc_fp)
                by_flat_doc[flat_name] = doc_fp
            existing = {str(r.get("roomName") or "") for r in doc_fp["rooms"]}
            for room_name in room_names:
                if room_name in existing:
                    continue
                doc_fp["rooms"].append({
                    "roomName": room_name,
                    "isComplete": False,
                    "activities": [],
                    "pinNumbers": [],
                    "capturesCount": 0,
                })
                existing.add(room_name)
            # Stable alphabetical order so every flat reads consistently.
            doc_fp["rooms"].sort(key=lambda r: str(r.get("roomName") or "").lower())

        # Attach pin numbers + capture counts so Flat Finishing Works can show
        # every roster room with accurate coverage (not "No Photos Yet" when
        # pins/captures exist under that room name).
        # Prefer geometric pin→room from heatmapPins (unique names after
        # disambiguation); fall back to name key for older snapshots.
        pins_by_room_key: dict[tuple[str, str], list[int]] = {}
        for p in heatmap_pins:
            pins_by_room_key.setdefault(
                _room_key(str(p["flatName"]), str(p["roomName"])), []
            ).append(int(p["sequenceNumber"]))
        # Also fold pin rooms into roster (same guarantee as captures above).
        for p in heatmap_pins:
            fname = _canonical_flat_label(str(p.get("flatName") or ""))
            rname = str(p.get("roomName") or "").strip()
            if not fname or not rname or fname in (_COMMON_AREA_FLAT, "Unknown"):
                continue
            doc_fp = by_flat_doc.get(fname)
            if doc_fp is None:
                continue
            if not any(str(r.get("roomName") or "") == rname for r in doc_fp["rooms"]):
                doc_fp["rooms"].append({
                    "roomName": rname,
                    "isComplete": False,
                    "activities": [],
                    "pinNumbers": [],
                    "capturesCount": 0,
                })
                doc_fp["rooms"].sort(key=lambda r: str(r.get("roomName") or "").lower())

        caps_by_room_key = {
            _room_key(flat, room): count
            for (flat, room), count in captures_by_room.items()
        }
        # Polygon lookup for rooms that share a base name (Dress ×3).
        room_poly_by_flat: dict[str, list[tuple[str, list[dict[str, float]]]]] = {}
        for flat_entry in flats_for_align:
            fname = _canonical_flat_label(str(flat_entry.get("flat") or ""))
            for r in flat_entry.get("rooms") or []:
                poly = _normalize_polygon(r.get("polygon") or [])
                if poly:
                    room_poly_by_flat.setdefault(fname, []).append(
                        (str(r.get("name") or ""), poly)
                    )

        for fp in flat_progress_docs:
            fname = _canonical_flat_label(str(fp["flatName"]))
            for room in fp["rooms"]:
                rname = str(room["roomName"])
                key = _room_key(fname, rname)
                pin_nums = sorted({n for n in pins_by_room_key.get(key, []) if n})
                polys = [
                    poly for n, poly in room_poly_by_flat.get(fname, [])
                    if n == rname
                ]
                if polys and heatmap_pins:
                    inside = []
                    for p in heatmap_pins:
                        if _canonical_flat_label(str(p["flatName"])) != fname:
                            continue
                        try:
                            px, py = float(p["x"]), float(p["y"])
                        except (TypeError, ValueError):
                            continue
                        if any(_point_in_polygon(px, py, poly) for poly in polys):
                            seq = int(p.get("sequenceNumber") or 0)
                            if seq:
                                inside.append(seq)
                    if inside:
                        pin_nums = sorted(set(inside))
                room["pinNumbers"] = pin_nums
                room["capturesCount"] = int(caps_by_room_key.get(key, 0) or len(pin_nums))
                # Do NOT wipe scored activities when capture matching fails —
                # that was destroying evidence and resetting flat %. If AI
                # scored the room, treat it as photographed.
                if int(room["capturesCount"] or 0) <= 0 and room.get("activities"):
                    room["capturesCount"] = 1
                if int(room["capturesCount"] or 0) <= 0 and not room.get("activities"):
                    room["isComplete"] = False

            # v4.4: recompute flat finishing from photographed rooms' work %.
            photographed_rooms = [
                r for r in fp["rooms"]
                if int(r.get("capturesCount") or 0) >= 1 or (r.get("activities") or [])
            ]
            complete = sum(1 for r in photographed_rooms if r.get("isComplete"))
            rooms_required = int(fp.get("roomsRequired") or len(fp["rooms"]) or 0)
            rooms_photographed = len(photographed_rooms)
            fp["roomsComplete"] = complete
            fp["roomsPhotographed"] = rooms_photographed
            fp["roomsRequired"] = rooms_required
            fp["roomsTotal"] = rooms_photographed if rooms_photographed else rooms_required

            room_work_pcts: list[float] = []
            for r in photographed_rooms:
                if r.get("isComplete"):
                    room_work_pcts.append(100.0)
                    continue
                acts = [
                    a for a in (r.get("activities") or [])
                    if a.get("status") != "not_observable"
                ]
                if not acts:
                    room_work_pcts.append(0.0)
                    continue
                avg = sum(float(a.get("completionPct") or 0.0) for a in acts) / len(acts)
                room_work_pcts.append(min(avg, 99.0))
            if room_work_pcts:
                completion_pct = round(sum(room_work_pcts) / len(room_work_pcts), 1)
            else:
                completion_pct = 0.0
            is_fully = (
                rooms_required > 0
                and rooms_photographed >= rooms_required
                and complete >= rooms_required
            )
            if is_fully:
                completion_pct = 100.0
            elif completion_pct >= 100.0 and not is_fully:
                completion_pct = 99.0
            fp["completionPct"] = completion_pct
            fp["isFullyComplete"] = is_fully

        # Floor finishing % from finalized flat + common scopes (not the
        # legacy mean of only high-scoring activity cards).
        from app.services.construction_progress_providers.vllm_provider import (
            rollup_floor_finishing_progress,
        )
        from app.services.construction_progress_providers.base import FlatProgress as _FlatProgress

        flat_for_rollup = [
            _FlatProgress(
                flat_name=str(fp["flatName"]),
                completion_pct=float(fp.get("completionPct") or 0.0),
                rooms_complete=int(fp.get("roomsComplete") or 0),
                rooms_total=int(fp.get("roomsTotal") or 0),
                rooms_required=int(fp.get("roomsRequired") or 0),
                rooms_photographed=int(fp.get("roomsPhotographed") or 0),
                is_fully_complete=bool(fp.get("isFullyComplete")),
            )
            for fp in flat_progress_docs
            if str(fp.get("flatName") or "").lower() != "common area"
        ]
        overall_finishing_pct = rollup_floor_finishing_progress(
            flat_for_rollup, result.activities,
        )

        # Prefer residential flats first in the Flat Finishing dropdown.
        flat_progress_docs.sort(
            key=lambda d: (
                0 if str(d.get("flatName") or "").lower().startswith("flat") else 1,
                str(d.get("flatName") or ""),
            )
        )

        # Coverage ≠ progress: rooms with ≥1 usable capture ÷ roster rooms.
        # Progress (overallProgressPct) averages photographed rooms only;
        # this sibling field is how sparse photo coverage is communicated.
        roster_room_count = sum(len(fp.get("rooms") or []) for fp in flat_progress_docs)
        photographed_room_count = sum(
            1
            for fp in flat_progress_docs
            for r in (fp.get("rooms") or [])
            if int(r.get("capturesCount") or 0) >= 1
        )
        coverage_pct = (
            round((photographed_room_count / roster_room_count) * 100, 1)
            if roster_room_count
            else 0.0
        )

        doc = {
            "orgId": org_id,
            "projectId": context["projectId"],
            "towerId": context["towerId"],
            "floorId": floor_id,
            "projectName": context["projectName"],
            "towerName": context["towerName"],
            "floorName": context["floorLabel"],
            "floorPlanId": context["floorPlanId"],
            "floorPlanImageUrl": context["floorPlanImageUrl"],
            "snapshotDate": as_of,
            "overallProgressPct": overall_finishing_pct,
            "overallConfidencePct": result.overall_confidence_pct,
            "overallStatus": overall_status,
            "imagesAnalyzedCount": len(captures),
            "activities": activity_docs,
            "roomHeatmap": room_heatmap,
            "heatmapPins": heatmap_pins,
            "flatProgress": flat_progress_docs,
            "summaryCards": {
                "roomsCompleted": rooms_completed,
                "roomsInProgress": rooms_in_progress,
                "roomsNotStarted": rooms_not_started,
                "activitiesCompleted": activities_completed,
                "activitiesInProgress": activities_in_progress,
                "activitiesNotStarted": activities_not_started,
                "activitiesNotAssessed": activities_not_assessed,
                "activitiesNotObservable": activities_not_observable,
                "imagesAnalyzed": len(captures),
                "lastInspection": last_inspection,
                "avgConfidencePct": avg_confidence,
                "coveragePct": coverage_pct,
            },
            "executiveSummary": result.executive_summary,
            "model": result.model,
            "analyzedBy": analyzed_by,
            "promptVersion": _prompt_version(),
            "rigVersion": _rig_version(),
            "createdAt": _utcnow(),
        }
        insert_result = await self._db[_COLLECTION].insert_one(doc)
        doc["_id"] = insert_result.inserted_id
        logger.info(
            "Construction progress snapshot created floor_id={} org_id={} overall={}%",
            floor_id, org_id, overall_finishing_pct,
        )
        # Re-apply human pin + activity corrections onto the new snapshot so a
        # fresh analyze does not wipe Floor-1 (and later) review fixes.
        try:
            from app.services.review_correction_applier import ReviewCorrectionApplier
            applied = await ReviewCorrectionApplier(self._db).backfill_floor(
                org_id=org_id, floor_id=floor_id,
            )
            logger.info("Re-applied review corrections after analyze: {}", applied)
            # Reload so API response includes human-corrected flatProgress.
            refreshed = await self._db[_COLLECTION].find_one({"_id": doc["_id"]})
            if refreshed:
                doc = refreshed
        except Exception as exc:
            logger.warning("Post-analyze review correction apply failed: {}", exc)
        return _serialize_snapshot(doc)

    # ── Reads ──────────────────────────────────────────────────────────────────

    async def get_latest_snapshot(self, org_id: str, floor_id: str) -> dict[str, Any] | None:
        doc = await self._db[_COLLECTION].find_one(
            {"orgId": org_id, "floorId": floor_id}, sort=[("snapshotDate", -1)]
        )
        return _serialize_snapshot(doc) if doc else None

    async def delete_floor_reports(self, org_id: str, floor_id: str) -> int:
        """Delete every progress snapshot for a floor, resetting it back to 'not analyzed'."""
        result = await self._db[_COLLECTION].delete_many({"orgId": org_id, "floorId": floor_id})
        return result.deleted_count

    async def list_floor_summaries(self, org_id: str) -> list[dict[str, Any]]:
        """One row per floor — the picker list for the Construction Progress
        overview page. Floors never analyzed show progress=None so the UI can
        offer "Analyze now". Batches all lookups (towers/projects/latest
        snapshots) instead of one round trip per floor — with 100+ floors per
        org, the naive per-floor version took 15+ seconds; this is a handful
        of queries regardless of floor count."""
        floors = await self._db["floors"].find({"orgId": org_id}).to_list(length=1000)
        if not floors:
            return []

        tower_ids = {str(f.get("towerId")) for f in floors if f.get("towerId")}
        towers = await self._db["towers"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": list(tower_ids)}}, {"id": {"$in": list(tower_ids)}}]}
        ).to_list(length=1000)
        tower_by_id = {str(t.get("id") or t.get("_id")): t for t in towers}

        project_ids = {str(t.get("projectId")) for t in towers if t.get("projectId")}
        projects = await self._db["projects"].find(
            {"orgId": org_id, "$or": [{"_id": {"$in": list(project_ids)}}, {"id": {"$in": list(project_ids)}}]}
        ).to_list(length=1000)
        project_by_id = {str(p.get("id") or p.get("_id")): p for p in projects}

        # Latest snapshot per floor via a single aggregation instead of N finds.
        latest_by_floor: dict[str, dict[str, Any]] = {}
        pipeline = [
            {"$match": {"orgId": org_id}},
            {"$sort": {"snapshotDate": -1}},
            {"$group": {"_id": "$floorId", "doc": {"$first": "$$ROOT"}}},
        ]
        async for row in self._db[_COLLECTION].aggregate(pipeline):
            latest_by_floor[str(row["_id"])] = row["doc"]

        # A floor counts as having captures if any pin on it links a real capture
        # via captureIds OR owns a capture through its backing roomId (orphans
        # healed at analyze time still need to make the floor listable).
        pins = await self._db["capture_pins"].find(
            {"orgId": org_id}
        ).to_list(length=5000)
        candidate_capture_ids: set[str] = set()
        room_ids_by_floor: dict[str, list[str]] = {}
        pin_ids_by_floor: dict[str, list[str]] = {}
        for pin in pins:
            fid = str(pin.get("floorId") or "")
            if not fid:
                continue
            room_id = str(pin.get("roomId") or pin.get("room_id") or "")
            if room_id:
                room_ids_by_floor.setdefault(fid, []).append(room_id)
            ids = [str(cid) for cid in (pin.get("captureIds") or pin.get("capture_ids") or []) if cid]
            if ids:
                pin_ids_by_floor.setdefault(fid, []).extend(ids)
                candidate_capture_ids.update(ids)

        existing_capture_ids: set[str] = set()
        if candidate_capture_ids:
            cursor = self._db["captures"].find(
                {
                    "orgId": org_id,
                    "$or": [
                        {"_id": {"$in": list(candidate_capture_ids)}},
                        {"id": {"$in": list(candidate_capture_ids)}},
                    ],
                },
                {"_id": 1, "id": 1},
            )
            async for doc in cursor:
                existing_capture_ids.add(str(doc.get("id") or doc.get("_id") or ""))

        floors_with_room_captures: set[str] = set()
        all_room_ids = [rid for rids in room_ids_by_floor.values() for rid in rids]
        if all_room_ids:
            async for doc in self._db["captures"].find(
                {
                    "orgId": org_id,
                    "$or": [
                        {"roomId": {"$in": all_room_ids}},
                        {"room_id": {"$in": all_room_ids}},
                    ],
                },
                {"roomId": 1, "room_id": 1},
            ):
                rid = str(doc.get("roomId") or doc.get("room_id") or "")
                for fid, rids in room_ids_by_floor.items():
                    if rid in rids:
                        floors_with_room_captures.add(fid)
                        break

        floors_with_captures = {
            fid for fid, cids in pin_ids_by_floor.items()
            if any(cid in existing_capture_ids for cid in cids)
        } | floors_with_room_captures

        summaries: list[dict[str, Any]] = []
        for floor in floors:
            floor_id = str(floor.get("id") or floor.get("_id"))
            if floor_id not in floors_with_captures:
                continue
            tower = tower_by_id.get(str(floor.get("towerId")))
            project = project_by_id.get(str(tower.get("projectId"))) if tower else None
            latest = latest_by_floor.get(floor_id)
            summaries.append({
                "floorId": floor_id,
                "projectId": str((tower or {}).get("projectId") or ""),
                "projectName": str((project or {}).get("name") or ""),
                "towerId": str(floor.get("towerId") or ""),
                "towerName": str((tower or {}).get("name") or ""),
                "floorName": str(floor.get("label") or ""),
                "overallProgressPct": latest.get("overallProgressPct") if latest else None,
                "overallStatus": latest.get("overallStatus", "in_progress") if latest else None,
                "lastInspection": (latest.get("summaryCards") or {}).get("lastInspection") if latest else None,
                "analyzed": latest is not None,
            })
        return summaries

    async def get_timeline(self, org_id: str, floor_id: str) -> list[dict[str, Any]]:
        docs = await self._db[_COLLECTION].find(
            {"orgId": org_id, "floorId": floor_id}
        ).sort("snapshotDate", 1).to_list(length=1000)
        return [
            {
                "snapshotId": str(d["_id"]),
                "snapshotDate": d.get("snapshotDate"),
                "overallProgressPct": d.get("overallProgressPct", 0.0),
            }
            for d in docs
        ]

    async def compare(self, org_id: str, floor_id: str, from_id: str, to_id: str) -> dict[str, Any]:
        from bson import ObjectId

        def _oid(v: str):
            return ObjectId(v) if ObjectId.is_valid(v) else v

        before = await self._db[_COLLECTION].find_one({"_id": _oid(from_id), "orgId": org_id, "floorId": floor_id})
        after = await self._db[_COLLECTION].find_one({"_id": _oid(to_id), "orgId": org_id, "floorId": floor_id})
        if not before or not after:
            raise ValueError("Snapshot not found")

        before_by_id = {a["activityId"]: a for a in before.get("activities", [])}
        newly_completed = []
        for a in after.get("activities", []):
            prev = before_by_id.get(a["activityId"])
            if a["status"] == "completed" and (not prev or prev["status"] != "completed"):
                newly_completed.append(a["name"])

        return {
            "before": _serialize_snapshot(before),
            "after": _serialize_snapshot(after),
            "progressDelta": round(after.get("overallProgressPct", 0) - before.get("overallProgressPct", 0), 1),
            "newlyCompletedActivities": newly_completed,
        }

    async def get_heatmap(self, org_id: str, floor_id: str) -> list[dict[str, Any]]:
        latest = await self._db[_COLLECTION].find_one(
            {"orgId": org_id, "floorId": floor_id}, sort=[("snapshotDate", -1)]
        )
        return (latest or {}).get("roomHeatmap", [])


_FALLBACK_LOCATION = ("Unknown", "Unknown")


def _serialize_snapshot(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    return {
        "snapshotId": str(doc["_id"]),
        "projectId": doc.get("projectId", ""),
        "projectName": doc.get("projectName", ""),
        "towerId": doc.get("towerId", ""),
        "towerName": doc.get("towerName", ""),
        "floorId": doc.get("floorId", ""),
        "floorName": doc.get("floorName", ""),
        "floorPlanId": doc.get("floorPlanId", ""),
        "floorPlanImageUrl": doc.get("floorPlanImageUrl", ""),
        "snapshotDate": doc.get("snapshotDate"),
        "overallProgressPct": doc.get("overallProgressPct", 0.0),
        "overallConfidencePct": doc.get("overallConfidencePct", 0.0),
        "overallStatus": doc.get("overallStatus", "in_progress"),
        "imagesAnalyzedCount": doc.get("imagesAnalyzedCount", 0),
        "activities": doc.get("activities", []),
        "roomHeatmap": doc.get("roomHeatmap", []),
        "heatmapPins": doc.get("heatmapPins", []),
        "flatProgress": doc.get("flatProgress", []),
        "summaryCards": doc.get("summaryCards", {}),
        "executiveSummary": doc.get("executiveSummary", ""),
        "model": doc.get("model", ""),
        "analyzedBy": doc.get("analyzedBy") or doc.get("analyzed_by"),
        "promptVersion": doc.get("promptVersion") or doc.get("prompt_version"),
        "rigVersion": doc.get("rigVersion") if doc.get("rigVersion") is not None else doc.get("rig_version"),
        "createdAt": doc.get("createdAt"),
    }


def _prompt_version() -> str:
    from app.services.construction_progress_providers.vllm_provider import PROMPT_VERSION
    return PROMPT_VERSION


def _rig_version() -> int:
    from app.services.panorama_views import RIG_VERSION
    return RIG_VERSION
