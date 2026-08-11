"""Cache helper for equirect → perspective rig views (T4 stub).

Keyed by (captureId, rigVersion). On miss, renders DEFAULT_RIG, JPEG-encodes
each view at q85, and stores the JPEG bytes in ``capture_derived_views`` so a
second analyze hits Mongo instead of reprojecting.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np
from bson.binary import Binary
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.panorama_views import RIG_VERSION, ViewSpec, render_rig

_COLLECTION = "capture_derived_views"
_JPEG_QUALITY = 85


def _encode_jpeg(bgr: np.ndarray, *, quality: int = _JPEG_QUALITY) -> bytes:
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("cv2.imencode failed for derived view")
    return buf.tobytes()


def _decode_equirect(equirect_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(equirect_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("equirect_bytes is not a decodable image")
    return bgr


async def get_or_render_views(
    db: AsyncIOMotorDatabase,
    capture_id: str,
    org_id: str,
    equirect_bytes: bytes,
) -> list[tuple[ViewSpec, bytes]]:
    """Return (ViewSpec, JPEG bytes) for each rig view, caching in Mongo.

    Cache hit: rebuild the list from stored Binary blobs.
    Cache miss: render_rig → JPEG q85 → upsert document with view metadata +
    bytes (Cloudinary URLs deferred; storing local JPEG bytes for now).
    """
    col = db[_COLLECTION]
    cached = await col.find_one(
        {"captureId": capture_id, "rigVersion": RIG_VERSION, "orgId": org_id}
    )
    if cached and cached.get("views"):
        out: list[tuple[ViewSpec, bytes]] = []
        for entry in cached["views"]:
            raw = entry.get("jpegBytes")
            if raw is None:
                break
            jpeg = bytes(raw)
            spec = ViewSpec(
                name=str(entry["name"]),
                yaw_deg=float(entry.get("yawDeg", 0.0)),
                pitch_deg=float(entry.get("pitchDeg", 0.0)),
                hfov_deg=float(entry.get("hfovDeg", 90.0)),
                surface=str(entry.get("surface", "walls")),
            )
            out.append((spec, jpeg))
        else:
            if len(out) == len(cached["views"]):
                logger.debug(
                    "derived_views cache hit capture_id={} rigVersion={} views={}",
                    capture_id,
                    RIG_VERSION,
                    len(out),
                )
                return out

    equirect_bgr = _decode_equirect(equirect_bytes)
    rendered = render_rig(equirect_bgr)
    result: list[tuple[ViewSpec, bytes]] = []
    view_docs: list[dict[str, Any]] = []
    for spec, bgr in rendered:
        jpeg = _encode_jpeg(bgr)
        result.append((spec, jpeg))
        view_docs.append({
            "name": spec.name,
            "surface": spec.surface,
            "yawDeg": spec.yaw_deg,
            "pitchDeg": spec.pitch_deg,
            "hfovDeg": spec.hfov_deg,
            "byteSize": len(jpeg),
            "jpegBytes": Binary(jpeg),
            # Cloudinary URL deferred — bytes cached locally for hit detection.
            "url": None,
            "note": "jpeg bytes cached in Mongo; Cloudinary upload not wired yet",
        })

    doc = {
        "captureId": capture_id,
        "orgId": org_id,
        "rigVersion": RIG_VERSION,
        "views": view_docs,
        "viewCount": len(view_docs),
        "updatedAt": datetime.now(timezone.utc),
    }
    await col.update_one(
        {"captureId": capture_id, "rigVersion": RIG_VERSION, "orgId": org_id},
        {"$set": doc},
        upsert=True,
    )
    logger.debug(
        "derived_views cache miss → stored capture_id={} rigVersion={} views={}",
        capture_id,
        RIG_VERSION,
        len(result),
    )
    return result
