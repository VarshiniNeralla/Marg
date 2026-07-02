"""
Project canonical world directions onto fisheye crops (visualization only).

Uses the same world→lens→UV mapping as ``fisheye_stitch._hemisphere_map`` for a
single ray (yaw_offset does not apply to world-direction projection).
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from app.services.fisheye_stitch import _lens_rot_matrix
from app.services.orientation_verify import WORLD_AXIS_MARKERS


def world_direction_to_fisheye_pixel(
    world_vector: tuple[float, float, float],
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    rot: tuple[float, float, float],
    *,
    body_flip: bool = False,
) -> dict[str, Any]:
    """Map one world unit direction to fisheye pixel (mapx, mapy)."""
    fov = np.radians(fov_deg)
    w = np.array(world_vector, dtype=np.float64)
    n = float(np.linalg.norm(w))
    if n < 1e-12:
        return {"valid": False, "reason": "zero vector"}
    w = w / n
    R = _lens_rot_matrix(rot, body_flip=body_flip)
    Xr, Yr, Zr = R @ w
    theta = float(np.arccos(np.clip(Zr, -1.0, 1.0)))
    phi = float(np.arctan2(Yr, Xr))
    r = radius * (theta / (fov / 2.0))
    mapx = float(cx + r * np.cos(phi))
    mapy = float(cy + r * np.sin(phi))
    valid = bool(theta <= fov / 2.0)
    dist = math.hypot(mapx - cx, mapy - cy)
    return {
        "world_vector": tuple(float(x) for x in w),
        "pixel_x": mapx,
        "pixel_y": mapy,
        "theta_deg": float(np.degrees(theta)),
        "phi_deg": float(np.degrees(phi)),
        "valid": valid,
        "inside_fov": valid,
        "dist_from_center_px": dist,
        "inside_fisheye_circle": dist <= radius + 0.5,
    }


def _enrich_lens_hit(
    hit: dict[str, Any],
    cx: float,
    cy: float,
    radius: float,
    img_w: int,
    img_h: int,
) -> dict[str, Any]:
    px, py = hit["pixel_x"], hit["pixel_y"]
    hit = dict(hit)
    hit["inside_image"] = 0 <= px < img_w and 0 <= py < img_h
    hit["inside_fisheye_circle"] = hit.get("inside_fisheye_circle", False)
    hit["unexpected_outside"] = (
        hit["valid"] and hit["inside_fov"] and not hit["inside_fisheye_circle"]
    ) or (hit["valid"] and not hit["inside_image"])
    return hit


def _lens_stitch_params_from_metadata(meta: dict, lens_key: str) -> tuple[float, float, float, tuple[float, float, float]]:
    """Reconstruct scaled lens geometry used at stitch time from debug metadata."""
    lens = meta[lens_key]
    sx = float(meta.get("scale_x", 1.0))
    sy = float(meta.get("scale_y", 1.0))
    sr = (sx + sy) / 2.0
    cx = float(lens["cx"]) * sx
    cy = float(lens["cy"]) * sy
    radius = float(lens["radius"]) * sr
    rot = tuple(float(x) for x in lens["rot"])
    layout = meta.get("layout", "top-bottom")
    if lens_key == "lens2" and layout == "side-by-side":
        cx -= float(meta.get("decoded_width", 0)) / 2.0
    return cx, cy, radius, rot


def project_world_axes_to_both_lenses(
    meta: dict,
    *,
    top_wh: Optional[tuple[int, int]] = None,
    bot_wh: Optional[tuple[int, int]] = None,
) -> dict[str, Any]:
    """Project ±X/±Y/±Z through lens1 and lens2 independently."""
    fov = float(meta.get("fisheye_fov_deg", 204.0))
    l1 = _lens_stitch_params_from_metadata(meta, "lens1")
    l2 = _lens_stitch_params_from_metadata(meta, "lens2")

    rows: list[dict[str, Any]] = []
    for label, vec, color in WORLD_AXIS_MARKERS:
        p1 = world_direction_to_fisheye_pixel(
            vec, l1[0], l1[1], l1[2], fov, l1[3], body_flip=False,
        )
        p2 = world_direction_to_fisheye_pixel(
            vec, l2[0], l2[1], l2[2], fov, l2[3], body_flip=True,
        )
        if top_wh is not None:
            p1 = _enrich_lens_hit(p1, l1[0], l1[1], l1[2], top_wh[0], top_wh[1])
        if bot_wh is not None:
            p2 = _enrich_lens_hit(p2, l2[0], l2[1], l2[2], bot_wh[0], bot_wh[1])
        rows.append({
            "direction": label,
            "world_vector": vec,
            "color_bgr": color,
            "lens1": {
                "pixel_x": p1["pixel_x"],
                "pixel_y": p1["pixel_y"],
                "valid": p1["valid"],
                "theta_deg": p1["theta_deg"],
                "inside_fisheye_circle": p1.get("inside_fisheye_circle"),
                "inside_image": p1.get("inside_image"),
                "unexpected_outside": p1.get("unexpected_outside"),
                "dist_from_center_px": p1.get("dist_from_center_px"),
            },
            "lens2": {
                "pixel_x": p2["pixel_x"],
                "pixel_y": p2["pixel_y"],
                "valid": p2["valid"],
                "theta_deg": p2["theta_deg"],
                "inside_fisheye_circle": p2.get("inside_fisheye_circle"),
                "inside_image": p2.get("inside_image"),
                "unexpected_outside": p2.get("unexpected_outside"),
                "dist_from_center_px": p2.get("dist_from_center_px"),
            },
        })

    return {
        "note": "yaw_offset not used; lens2 uses R2 @ Ry(π) body flip",
        "lens1_params": {"cx": l1[0], "cy": l1[1], "radius": l1[2], "rot": l1[3]},
        "lens2_params": {"cx": l2[0], "cy": l2[1], "radius": l2[2], "rot": l2[3]},
        "projections": rows,
    }


def _attach_checks(data: dict) -> dict:
    data = dict(data)
    data["checks"] = summarize_world_direction_checks(data)
    return data


def _pair_opposite(
    projections: list[dict[str, Any]],
    a: str,
    b: str,
    lens: str,
    cx: float,
    cy: float,
) -> dict[str, Any]:
    pa = next(r for r in projections if r["direction"] == a)[lens]
    pb = next(r for r in projections if r["direction"] == b)[lens]
    if not (pa["valid"] and pb["valid"]):
        return {"opposite": None, "reason": "one or both invalid in FOV"}
    ax, ay = pa["pixel_x"] - cx, pa["pixel_y"] - cy
    bx, by = pb["pixel_x"] - cx, pb["pixel_y"] - cy
    dot = ax * bx + ay * by
    dist_a = math.hypot(ax, ay)
    dist_b = math.hypot(bx, by)
    if dist_a < 1.0 or dist_b < 1.0:
        return {"opposite": None, "reason": "marker at optical center"}
    cos_angle = dot / (dist_a * dist_b)
    return {
        "opposite": cos_angle < -0.95,
        "cos_angle": cos_angle,
        "angle_deg": float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0)))),
    }


def summarize_world_direction_checks(data: dict) -> dict[str, Any]:
    """Automated checks for the user's verification criteria."""
    projs = data["projections"]
    l1 = data["lens1_params"]
    l2 = data["lens2_params"]
    pz = next(r for r in projs if r["direction"] == "+Z")
    mz = next(r for r in projs if r["direction"] == "-Z")

    def _center_dist(hit: dict, cx: float, cy: float) -> float:
        return math.hypot(hit["pixel_x"] - cx, hit["pixel_y"] - cy)

    unexpected = [
        f"{r['direction']} lens1" if r["lens1"].get("unexpected_outside") else None
        for r in projs
    ] + [
        f"{r['direction']} lens2" if r["lens2"].get("unexpected_outside") else None
        for r in projs
    ]
    unexpected = [x for x in unexpected if x]

    return {
        "plus_z_at_lens1_center_px": _center_dist(pz["lens1"], l1["cx"], l1["cy"]),
        "minus_z_at_lens2_center_px": _center_dist(mz["lens2"], l2["cx"], l2["cy"]),
        "lens1_x_opposite": _pair_opposite(projs, "+X", "-X", "lens1", l1["cx"], l1["cy"]),
        "lens1_y_opposite": _pair_opposite(projs, "+Y", "-Y", "lens1", l1["cx"], l1["cy"]),
        "lens2_x_opposite": _pair_opposite(projs, "+X", "-X", "lens2", l2["cx"], l2["cy"]),
        "lens2_y_opposite": _pair_opposite(projs, "+Y", "-Y", "lens2", l2["cx"], l2["cy"]),
        "unexpected_outside": unexpected,
    }


def format_world_direction_fisheye_report(data: dict) -> str:
    lines = [
        "── World direction → fisheye pixel (per lens) ──",
        "",
        f"Lens1: cx={data['lens1_params']['cx']:.1f} cy={data['lens1_params']['cy']:.1f} "
        f"r={data['lens1_params']['radius']:.1f}",
        f"Lens2: cx={data['lens2_params']['cx']:.1f} cy={data['lens2_params']['cy']:.1f} "
        f"r={data['lens2_params']['radius']:.1f}",
        "",
        "Expected: +Z at lens1 optical center; -Z at lens2 center; ±X/±Y opposite.",
        "unexpected_outside=True → valid in FOV but outside fisheye circle or image bounds.",
        "",
    ]
    for row in data["projections"]:
        d = row["direction"]
        l1 = row["lens1"]
        l2 = row["lens2"]
        lines.append(f"{d}  world={row['world_vector']}")
        lines.append(
            f"  lens1: x={l1['pixel_x']:.1f} y={l1['pixel_y']:.1f}  "
            f"valid={l1['valid']}  theta={l1['theta_deg']:.2f}°  "
            f"in_circle={l1.get('inside_fisheye_circle')}  "
            f"unexpected_outside={l1.get('unexpected_outside')}"
        )
        lines.append(
            f"  lens2: x={l2['pixel_x']:.1f} y={l2['pixel_y']:.1f}  "
            f"valid={l2['valid']}  theta={l2['theta_deg']:.2f}°  "
            f"in_circle={l2.get('inside_fisheye_circle')}  "
            f"unexpected_outside={l2.get('unexpected_outside')}"
        )
        lines.append("")
    checks = data.get("checks") or summarize_world_direction_checks(data)
    lines.extend([
        "── Validation summary ──",
        f"+Z vs lens1 center: {checks['plus_z_at_lens1_center_px']:.1f} px",
        f"-Z vs lens2 center: {checks['minus_z_at_lens2_center_px']:.1f} px",
    ])
    for key, label in (
        ("lens1_x_opposite", "lens1 ±X opposite"),
        ("lens1_y_opposite", "lens1 ±Y opposite"),
        ("lens2_x_opposite", "lens2 ±X opposite"),
        ("lens2_y_opposite", "lens2 ±Y opposite"),
    ):
        c = checks[key]
        if c.get("opposite") is True:
            lines.append(f"{label}: yes (angle {c['angle_deg']:.1f}°)")
        elif c.get("opposite") is False:
            lines.append(f"{label}: NO (angle {c['angle_deg']:.1f}°, cos={c['cos_angle']:.3f})")
        else:
            lines.append(f"{label}: n/a ({c.get('reason', '?')})")
    if checks["unexpected_outside"]:
        lines.append(f"unexpected_outside: {', '.join(checks['unexpected_outside'])}")
    else:
        lines.append("unexpected_outside: none")
    return "\n".join(lines).rstrip()


def _draw_fisheye_circle_overlay(
    out,
    cx: float,
    cy: float,
    radius: float,
    lens_label: str,
) -> None:
    import cv2

    icx, icy, ir = int(round(cx)), int(round(cy)), int(round(radius))
    cv2.circle(out, (icx, icy), max(1, ir), (0, 255, 0), 2, cv2.LINE_AA)
    cv2.drawMarker(out, (icx, icy), (255, 255, 255), cv2.MARKER_CROSS, 20, 2, cv2.LINE_AA)
    cv2.putText(
        out, f"{lens_label} center (cx,cy)", (icx + 12, icy - 12),
        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA,
    )


def render_world_directions_on_fisheye(
    img,
    projections: list[dict[str, Any]],
    lens: str,
    cx: float,
    cy: float,
    radius: float,
) -> np.ndarray:
    """Draw fisheye circle, optical center, and labeled world-direction markers."""
    import cv2

    out = img.copy()
    h, w = out.shape[:2]
    _draw_fisheye_circle_overlay(out, cx, cy, radius, lens)

    for row in projections:
        p = row[lens]
        px_f, py_f = p["pixel_x"], p["pixel_y"]
        px, py = int(round(px_f)), int(round(py_f))
        color = tuple(int(c) for c in row["color_bgr"])
        label = row["direction"]
        valid = p.get("valid", False)
        in_circle = p.get("inside_fisheye_circle", False)
        in_img = 0 <= px < w and 0 <= py < h
        unexpected = p.get("unexpected_outside", False)

        if not valid:
            if in_img:
                cv2.drawMarker(out, (px, py), (0, 0, 255), cv2.MARKER_TILTED_CROSS, 16, 2, cv2.LINE_AA)
                cv2.putText(out, f"{label}?", (px + 8, py - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
            continue

        if unexpected or not in_circle:
            cv2.circle(out, (px, py), 12, (0, 0, 255), 2, cv2.LINE_AA)
            cv2.circle(out, (px, py), 8, color, 1, cv2.LINE_AA)
        else:
            cv2.circle(out, (px, py), 10, color, -1, cv2.LINE_AA)
            cv2.circle(out, (px, py), 12, (255, 255, 255), 1, cv2.LINE_AA)

        if in_img:
            tx = min(max(px + 14, 4), w - 70)
            ty = min(max(py - 6, 16), h - 4)
            suffix = " !" if unexpected else ""
            cv2.putText(
                out, f"{label}{suffix}", (tx, ty),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, color if not unexpected else (0, 0, 255), 2, cv2.LINE_AA,
            )

    cv2.putText(
        out, f"{lens}: green=fisheye circle, filled=valid in circle", (10, h - 10),
        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1, cv2.LINE_AA,
    )
    return out


def build_world_direction_fisheye_debug(
    meta: dict,
    top_after_rotation,
    bottom_after_rotation,
) -> tuple[dict, Optional[np.ndarray], Optional[np.ndarray]]:
    """Return (report, lens1 annotated 04 image, lens2 annotated 05 image)."""
    th = int(top_after_rotation.shape[0]) if top_after_rotation is not None else 0
    tw = int(top_after_rotation.shape[1]) if top_after_rotation is not None else 0
    bh = int(bottom_after_rotation.shape[0]) if bottom_after_rotation is not None else 0
    bw = int(bottom_after_rotation.shape[1]) if bottom_after_rotation is not None else 0

    data = project_world_axes_to_both_lenses(
        meta,
        top_wh=(tw, th) if tw and th else None,
        bot_wh=(bw, bh) if bw and bh else None,
    )
    data = _attach_checks(data)
    projs = data["projections"]
    l1p = data["lens1_params"]
    l2p = data["lens2_params"]

    top_out = None
    bot_out = None
    if top_after_rotation is not None:
        top_out = render_world_directions_on_fisheye(
            top_after_rotation, projs, "lens1",
            l1p["cx"], l1p["cy"], l1p["radius"],
        )
    if bottom_after_rotation is not None:
        bot_out = render_world_directions_on_fisheye(
            bottom_after_rotation, projs, "lens2",
            l2p["cx"], l2p["cy"], l2p["radius"],
        )
    return data, top_out, bot_out
