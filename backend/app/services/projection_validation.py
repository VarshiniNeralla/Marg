"""
Fisheye projection validation overlay (visualization only).

Reuses the same world→lens→UV equidistant mapping as ``world_direction_to_fisheye_pixel``
without modifying stitch equations.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from app.services.fisheye_stitch import _lens_rot_matrix
from app.services.world_direction_fisheye import _lens_stitch_params_from_metadata

THETA_RING_LABELS_DEG = (15, 30, 45, 60, 75, 90, 105)
DEFAULT_SAMPLE_COUNT = 500


def _theta_stops_bgr(fov_half_deg: float) -> list[tuple[float, tuple[int, int, int]]]:
    """Piecewise BGR stops: blue=0°, green=60°, yellow=90°, orange=120°, red=FOV/2."""
    edge = float(fov_half_deg)
    stops: list[tuple[float, tuple[int, int, int]]] = [
        (0.0, (255, 0, 0)),
        (60.0, (0, 255, 0)),
        (90.0, (0, 255, 255)),
    ]
    if edge >= 120.0:
        stops.append((120.0, (0, 165, 255)))
    stops.append((edge, (0, 0, 255)))
    return stops


def theta_deg_to_bgr(theta_deg: float, fov_half_deg: float) -> tuple[int, int, int]:
    """Map incidence angle to rainbow BGR (OpenCV)."""
    stops = _theta_stops_bgr(fov_half_deg)
    t = max(0.0, min(float(theta_deg), stops[-1][0]))
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1 or i == len(stops) - 2:
            if t1 <= t0:
                return c1
            a = (t - t0) / (t1 - t0)
            return tuple(int(round(c0[j] + a * (c1[j] - c0[j]))) for j in range(3))
    return stops[-1][1]


def sample_world_rays_uniform_fov(
    n: int,
    fov_deg: float,
    rot: tuple[float, float, float],
    *,
    body_flip: bool = False,
    seed: int = 42,
) -> np.ndarray:
    """Sample ``n`` unit world directions uniformly over the valid fisheye cone."""
    rng = np.random.default_rng(seed)
    fov_half = np.radians(fov_deg / 2.0)
    cos_min = float(np.cos(fov_half))
    u = rng.random(n)
    cos_theta = 1.0 - u * (1.0 - cos_min)
    theta = np.arccos(cos_theta)
    phi = rng.uniform(-np.pi, np.pi, n)
    sin_t = np.sin(theta)
    v_lens = np.stack([
        sin_t * np.cos(phi),
        sin_t * np.sin(phi),
        cos_theta,
    ], axis=1)
    R = _lens_rot_matrix(rot, body_flip=body_flip)
    v_world = (R.T @ v_lens.T).T
    norms = np.linalg.norm(v_world, axis=1, keepdims=True)
    return v_world / np.maximum(norms, 1e-12)


def project_world_rays(
    world_vectors: np.ndarray,
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    rot: tuple[float, float, float],
    *,
    body_flip: bool = False,
) -> list[dict[str, Any]]:
    """Project world unit directions through the current fisheye model."""
    fov = np.radians(fov_deg)
    fov_half = fov / 2.0
    R = _lens_rot_matrix(rot, body_flip=body_flip)
    rows: list[dict[str, Any]] = []
    for w in world_vectors:
        wn = w / max(float(np.linalg.norm(w)), 1e-12)
        Xr, Yr, Zr = R @ wn
        theta = float(np.arccos(np.clip(Zr, -1.0, 1.0)))
        phi = float(np.arctan2(Yr, Xr))
        r = float(radius * (theta / fov_half))
        u = float(cx + r * np.cos(phi))
        v = float(cy + r * np.sin(phi))
        rows.append({
            "world_vector": tuple(float(x) for x in wn),
            "theta_deg": float(np.degrees(theta)),
            "phi_deg": float(np.degrees(phi)),
            "radius_px": r,
            "pixel_u": u,
            "pixel_v": v,
            "valid": bool(theta <= fov_half),
        })
    return rows


def _draw_theta_ring(
    out,
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    theta_label_deg: float,
) -> None:
    import cv2

    fov_half_rad = np.radians(fov_deg / 2.0)
    theta_rad = np.radians(theta_label_deg)
    r_px = radius * (theta_rad / fov_half_rad)
    pts: list[tuple[int, int]] = []
    for phi_deg in range(0, 360, 2):
        phi = np.radians(phi_deg)
        x = int(round(cx + r_px * np.cos(phi)))
        y = int(round(cy + r_px * np.sin(phi)))
        pts.append((x, y))
    if len(pts) >= 2:
        cv2.polylines(out, [np.array(pts, dtype=np.int32)], True, (220, 220, 220), 1, cv2.LINE_AA)
    label_x = int(round(cx + r_px * math.cos(-math.pi / 4)))
    label_y = int(round(cy + r_px * math.sin(-math.pi / 4)))
    cv2.putText(
        out,
        f"{int(theta_label_deg)}°",
        (label_x + 4, label_y - 4),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )


def render_projection_validation(
    img,
    samples: list[dict[str, Any]],
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    lens_label: str,
) -> np.ndarray:
    """Draw rainbow spokes and equidistant theta rings on a fisheye crop."""
    import cv2

    out = img.copy()
    h, w = out.shape[:2]
    fov_half_deg = fov_deg / 2.0
    icx, icy = int(round(cx)), int(round(cy))

    for theta_label in THETA_RING_LABELS_DEG:
        _draw_theta_ring(out, cx, cy, radius, fov_deg, theta_label)

    cv2.circle(out, (icx, icy), max(1, int(round(radius))), (0, 255, 0), 1, cv2.LINE_AA)
    cv2.drawMarker(out, (icx, icy), (255, 255, 255), cv2.MARKER_CROSS, 16, 1, cv2.LINE_AA)

    for row in samples:
        if not row["valid"]:
            continue
        u, v = int(round(row["pixel_u"])), int(round(row["pixel_v"]))
        if not (0 <= u < w and 0 <= v < h):
            continue
        color = theta_deg_to_bgr(row["theta_deg"], fov_half_deg)
        cv2.line(out, (icx, icy), (u, v), color, 1, cv2.LINE_AA)
        cv2.circle(out, (u, v), 2, color, -1, cv2.LINE_AA)

    cv2.putText(
        out,
        f"{lens_label}: rays colored by theta (blue=0 deg, red=FOV/2={fov_half_deg:.0f} deg)",
        (10, h - 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        out,
        f"gray rings every 15 deg (equidistant r = R * theta / (FOV/2)), n={len(samples)} rays",
        (10, h - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )
    return out


def build_lens_projection_validation(
    meta: dict,
    lens_key: str,
    fisheye_img,
    *,
    sample_count: int = DEFAULT_SAMPLE_COUNT,
    body_flip: bool = False,
) -> tuple[dict[str, Any], Optional[np.ndarray]]:
    """Build report dict and annotated image for one lens."""
    fov = float(meta.get("fisheye_fov_deg", 204.0))
    cx, cy, radius, rot = _lens_stitch_params_from_metadata(meta, lens_key)
    world = sample_world_rays_uniform_fov(
        sample_count, fov, rot, body_flip=body_flip, seed=42 if lens_key == "lens1" else 43,
    )
    samples = project_world_rays(world, cx, cy, radius, fov, rot, body_flip=body_flip)
    report = {
        "lens": lens_key,
        "sample_count": len(samples),
        "fov_deg": fov,
        "cx": cx,
        "cy": cy,
        "radius": radius,
        "body_flip": body_flip,
        "theta_ring_labels_deg": list(THETA_RING_LABELS_DEG),
        "samples": samples,
    }
    if fisheye_img is None:
        return report, None
    label = "lens1" if lens_key == "lens1" else "lens2"
    img = render_projection_validation(fisheye_img, samples, cx, cy, radius, fov, label)
    return report, img


def build_projection_validation_debug(
    meta: dict,
    top_after_rotation,
    bottom_after_rotation,
    *,
    sample_count: int = DEFAULT_SAMPLE_COUNT,
) -> tuple[dict[str, Any], Optional[np.ndarray], Optional[np.ndarray]]:
    """Return (combined report, lens1 png, lens2 png)."""
    r1, img1 = build_lens_projection_validation(
        meta, "lens1", top_after_rotation, sample_count=sample_count, body_flip=False,
    )
    r2, img2 = build_lens_projection_validation(
        meta, "lens2", bottom_after_rotation, sample_count=sample_count, body_flip=True,
    )
    return {"lens1": r1, "lens2": r2}, img1, img2
