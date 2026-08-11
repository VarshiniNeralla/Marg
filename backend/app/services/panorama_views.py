"""Render flat (rectilinear) views out of an equirectangular panorama.

The construction-progress vision model was previously shown the raw 2:1
equirect frame, where walls bend, ceiling/floor smear toward the poles, and a
1.8 MB byte budget forced ~35% downscale at JPEG q50. Slicing the sphere into
per-surface flat views removes the distortion AND fits the byte budget at full
quality, because each view is only a fraction of the frame.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# Bump whenever the rig below changes — derived views are cached by
# (capture_id, RIG_VERSION), and metric runs are keyed by it.
RIG_VERSION = 1


@dataclass(frozen=True)
class ViewSpec:
    name: str          # "wall_0" | "ceiling" | "floor" — cache key suffix
    yaw_deg: float
    pitch_deg: float
    hfov_deg: float
    surface: str       # "walls" | "ceiling" | "floor" — joins ActivityDef.surface_group


# 4 walls at 90° hFOV (slight corner overlap is deliberate: an activity
# straddling a corner appears whole in at least one view), plus poles.
DEFAULT_RIG: tuple[ViewSpec, ...] = (
    ViewSpec("wall_0",   0.0,   0.0, 90.0, "walls"),
    ViewSpec("wall_90",  90.0,  0.0, 90.0, "walls"),
    ViewSpec("wall_180", 180.0, 0.0, 90.0, "walls"),
    ViewSpec("wall_270", 270.0, 0.0, 90.0, "walls"),
    ViewSpec("ceiling",  0.0,  75.0, 100.0, "ceiling"),
    ViewSpec("floor",    0.0, -75.0, 100.0, "floor"),
)

VIEW_SIZE = 1280  # px, square


def equirect_to_perspective(
    equirect_bgr: np.ndarray,
    *,
    yaw_deg: float,
    pitch_deg: float,
    hfov_deg: float,
    out_w: int = VIEW_SIZE,
    out_h: int = VIEW_SIZE,
) -> np.ndarray:
    """One rectilinear view out of a 2:1 equirectangular BGR image.

    Camera convention: +Z forward, +X right, +Y DOWN (OpenCV image axes).
    yaw_deg rotates right, pitch_deg > 0 looks UP.
    """
    eq_h, eq_w = equirect_bgr.shape[:2]
    focal = (out_w / 2.0) / np.tan(np.radians(hfov_deg) / 2.0)

    u, v = np.meshgrid(
        np.arange(out_w, dtype=np.float32),
        np.arange(out_h, dtype=np.float32),
    )
    x = u - out_w / 2.0
    y = v - out_h / 2.0
    z = np.full_like(x, focal, dtype=np.float32)

    norm = np.sqrt(x * x + y * y + z * z)
    dx, dy, dz = x / norm, y / norm, z / norm

    # Pitch about the X axis. A forward ray (0,0,1) becomes (0,-sin p, cos p),
    # so positive pitch yields negative image-y => looking up.
    p = np.radians(pitch_deg)
    cp, sp = np.cos(p), np.sin(p)
    dy, dz = dy * cp - dz * sp, dy * sp + dz * cp

    # Yaw about the Y axis.
    a = np.radians(yaw_deg)
    ca, sa = np.cos(a), np.sin(a)
    dx, dz = dx * ca + dz * sa, -dx * sa + dz * ca

    lon = np.arctan2(dx, dz)                       # -pi..pi
    lat = np.arcsin(np.clip(-dy, -1.0, 1.0))       # -pi/2..pi/2, +ve = up

    map_x = ((lon / (2.0 * np.pi)) + 0.5) * eq_w
    map_y = (0.5 - (lat / np.pi)) * eq_h
    np.clip(map_y, 0, eq_h - 1, out=map_y)

    return cv2.remap(
        equirect_bgr,
        map_x.astype(np.float32),
        map_y.astype(np.float32),
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_WRAP,   # wraps the longitude seam
    )


def render_rig(
    equirect_bgr: np.ndarray,
    rig: tuple[ViewSpec, ...] = DEFAULT_RIG,
) -> list[tuple[ViewSpec, np.ndarray]]:
    """All rig views for one panorama."""
    return [
        (
            spec,
            equirect_to_perspective(
                equirect_bgr,
                yaw_deg=spec.yaw_deg,
                pitch_deg=spec.pitch_deg,
                hfov_deg=spec.hfov_deg,
            ),
        )
        for spec in rig
    ]


def contact_sheet(
    views: list[tuple[ViewSpec, np.ndarray]],
    *,
    cols: int = 3,
    tile: int = 640,
) -> np.ndarray:
    """Tile rig views into one labelled JPEG — used by the T3 review dialog so a
    reviewer sees all six surfaces at once instead of a warped panorama."""
    if not views:
        return np.zeros((tile, tile, 3), dtype=np.uint8)

    rows = (len(views) + cols - 1) // cols
    sheet = np.zeros((rows * tile, cols * tile, 3), dtype=np.uint8)

    for i, (spec, img) in enumerate(views):
        r, c = divmod(i, cols)
        resized = cv2.resize(img, (tile, tile), interpolation=cv2.INTER_AREA)
        labelled = resized.copy()
        cv2.putText(
            labelled,
            spec.name,
            (12, 36),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            labelled,
            spec.name,
            (12, 36),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )
        y0, x0 = r * tile, c * tile
        sheet[y0:y0 + tile, x0:x0 + tile] = labelled

    return sheet
