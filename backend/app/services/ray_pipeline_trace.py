"""
Trace one world ray through every stitch coordinate frame (visualization / audit only).

Uses the same formulas as ``fisheye_stitch._hemisphere_map`` without modifying them.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from app.services.fisheye_stitch import _lens_rot_matrix, _rot_matrix, _ry_pi_matrix
from app.services.orientation_verify import (
    LENS2_BODY_FLIP_DETAIL,
    STITCHER_FORWARD,
    STITCHER_ZENITH,
    lonlat_to_pixel,
    world_vector_to_lonlat,
)
from app.services.world_direction_fisheye import _lens_stitch_params_from_metadata

 
def _mat_list(R: np.ndarray) -> list[list[float]]:
    return [[float(R[i, j]) for j in range(3)] for i in range(3)]


def _vec_list(v: np.ndarray) -> list[float]:
    return [float(v[0]), float(v[1]), float(v[2])]


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return v
    return v / n


def pixel_to_lonlat_continuous(px: float, py: float, width: int, height: int) -> tuple[float, float]:
    """Inverse of ``_hemisphere_map`` equirect grid (GPano layout)."""
    import numpy as np

    ix = int(round(px))
    iy = int(round(py))
    ix = max(0, min(width - 1, ix))
    iy = max(0, min(height - 1, iy))
    xs = np.linspace(-np.pi, np.pi, width)
    ys = np.linspace(np.pi / 2, -np.pi / 2, height)
    return float(np.degrees(xs[ix])), float(np.degrees(ys[iy]))


def lonlat_to_world_vector(lon_deg: float, lat_deg: float) -> tuple[float, float, float]:
    """Same as ``_hemisphere_map`` sphere_dirs (before yaw_offset)."""
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    x = math.cos(lat) * math.sin(lon)
    y = math.sin(lat)
    z = math.cos(lat) * math.cos(lon)
    return (x, y, z)


def stitcher_conventions() -> dict[str, Any]:
    return {
        "world_frame": {
            "description": "Right-handed unit sphere used by _hemisphere_map",
            "formulas": [
                "X = cos(lat) * sin(lon)",
                "Y = sin(lat)",
                "Z = cos(lat) * cos(lon)",
            ],
            "reference_directions": {
                "forward_plus_Z": list(STITCHER_FORWARD),
                "zenith_plus_Y": list(STITCHER_ZENITH),
                "lon_0_lat_0": list(STITCHER_FORWARD),
            },
            "longitude": "atan2(X, Z); lon=0° at +Z (forward)",
            "latitude": "asin(Y); lat=+90° at +Y (zenith, GPano row 0)",
        },
        "equirect_grid": {
            "lon_rad": "np.linspace(-π, π, out_w)  →  x=0 is lon=−180°",
            "lat_rad": "np.linspace(+π/2, −π/2, out_h)  →  y=0 is lat=+90° (GPano)",
            "yaw_offset": "lon_sphere = lon_output + yaw_offset (applied before sphere_dirs)",
            "current_lens1_yaw_offset_deg": 0.0,
            "current_lens2_yaw_offset_deg": 0.0,
        },
        "rotation": {
            "calibration_order": "R_cal = Rz(rc) @ Rx(rb) @ Ry(ra)  [degrees from blob]",
            "lens1_effective": "R_eff = R_cal",
            "lens2_effective": "R_eff = R_cal @ Ry(π)",
            "lens2_body_flip": LENS2_BODY_FLIP_DETAIL,
            "world_to_lens": "v_lens = R_eff @ v_world",
        },
        "lens_frame": {
            "optical_axis": "+Z (boresight)",
            "theta": "acos(Zr)  — incidence angle from boresight [rad/deg]",
            "phi": "atan2(Yr, Xr)  — azimuth in lens image plane [rad/deg]",
        },
        "fisheye_equidistant": {
            "model": "r_px = radius * theta / (FOV/2)",
            "pixel": "u = cx + r_px * cos(phi),  v = cy + r_px * sin(phi)",
            "valid": "theta <= FOV/2",
        },
        "inverse_remap": {
            "description": "cv2.remap builds mapx/mapy: for each panorama pixel (x,y) …",
            "steps": [
                "1. lon_output, lat from equirect grid (GPano y-down latitude)",
                "2. lon_sphere = lon_output + yaw_offset",
                "3. (X,Y,Z) = sphere_dirs(lon_sphere, lat)",
                "4. (Xr,Yr,Zr) = R_eff @ (X,Y,Z)",
                "5. theta, phi → sample fisheye at (u,v)",
            ],
            "forward_inverse": "Given v_world, lon=atan2(X,Z), lat=asin(Y); "
            "lon_output = lon_sphere − yaw_offset; panorama (x,y) from lonlat_to_pixel",
        },
    }


def trace_world_ray_for_lens(
    world_vector: tuple[float, float, float],
    lens_key: str,
    meta: dict,
    out_w: int,
    out_h: int,
    *,
    yaw_offset_deg: float = 0.0,
    body_flip: bool = False,
) -> dict[str, Any]:
    """Forward trace: world ray → lens frames → fisheye (u,v) → panorama (x,y)."""
    fov_deg = float(meta.get("fisheye_fov_deg", 204.0))
    cx, cy, radius, rot = _lens_stitch_params_from_metadata(meta, lens_key)
    ra, rb, rc = rot

    v_world = _unit(np.array(world_vector, dtype=np.float64))
    R_cal = _rot_matrix(ra, rb, rc)
    Ry_pi = _ry_pi_matrix()

    v_after_R_cal = R_cal @ v_world
    v_after_Ry_pi = Ry_pi @ v_after_R_cal if body_flip else v_after_R_cal.copy()
    R_eff = _lens_rot_matrix(rot, body_flip=body_flip)
    v_lens = R_eff @ v_world

    Xr, Yr, Zr = float(v_lens[0]), float(v_lens[1]), float(v_lens[2])
    theta = float(math.acos(max(-1.0, min(1.0, Zr))))
    phi = float(math.atan2(Yr, Xr))
    fov_half = math.radians(fov_deg / 2.0)
    r_px = float(radius * (theta / fov_half))
    u = float(cx + r_px * math.cos(phi))
    v = float(cy + r_px * math.sin(phi))
    valid_fov = bool(theta <= fov_half)

    lon_sphere_deg, lat_deg = world_vector_to_lonlat(
        float(v_world[0]), float(v_world[1]), float(v_world[2]),
    )
    lon_output_deg = lon_sphere_deg - yaw_offset_deg
    pano_x, pano_y = lonlat_to_pixel(lon_output_deg, lat_deg, out_w, out_h)

    # Inverse-remap round-trip from that panorama pixel (audit)
    lon_out_back, lat_back = pixel_to_lonlat_continuous(float(pano_x), float(pano_y), out_w, out_h)
    lon_sphere_back = lon_out_back + yaw_offset_deg
    xyz_back = lonlat_to_world_vector(lon_sphere_back, lat_back)

    return {
        "lens": lens_key,
        "calibration_rot_deg": [ra, rb, rc],
        "yaw_offset_deg": yaw_offset_deg,
        "body_flip": body_flip,
        "step_1_world_ray": {
            "vector_xyz": _vec_list(v_world),
            "lon_deg": lon_sphere_deg,
            "lat_deg": lat_deg,
            "note": "Stitcher world / GPano sphere frame",
        },
        "step_2_after_R_cal": {
            "formula": f"R_cal = Rz({rc}) @ Rx({rb}) @ Ry({ra})",
            "matrix": _mat_list(R_cal),
            "vector_xyz": _vec_list(v_after_R_cal),
        },
        "step_3_after_Ry_pi": {
            "applied": body_flip,
            "formula": "Ry(π) = _rot_matrix(180°, 0°, 0°)" if body_flip else "skipped (lens1)",
            "matrix": _mat_list(Ry_pi) if body_flip else None,
            "vector_xyz": _vec_list(v_after_Ry_pi),
            "note": "Lens2 only; composed as R_eff = R_cal @ Ry(π)",
        },
        "step_4_effective_rotation": {
            "formula": (
                f"R_eff = R_cal @ Ry(π)" if body_flip else f"R_eff = R_cal"
            ),
            "matrix": _mat_list(R_eff),
            "vector_lens_xyz": _vec_list(v_lens),
        },
        "step_5_fisheye_angles": {
            "theta_rad": theta,
            "theta_deg": math.degrees(theta),
            "phi_rad": phi,
            "phi_deg": math.degrees(phi),
            "definition": "theta=acos(Zr), phi=atan2(Yr,Xr) in lens frame (+Z boresight)",
        },
        "step_6_fisheye_pixel": {
            "r_px": r_px,
            "u": u,
            "v": v,
            "cx": cx,
            "cy": cy,
            "radius": radius,
            "fov_deg": fov_deg,
            "formula": "r = radius * theta / (FOV/2); u = cx + r*cos(phi); v = cy + r*sin(phi)",
            "valid_in_fov": valid_fov,
        },
        "step_7_inverse_mapping_to_panorama": {
            "description": "Which equirect pixel displays this world direction",
            "lon_sphere_deg": lon_sphere_deg,
            "yaw_offset_deg": yaw_offset_deg,
            "lon_output_deg": lon_output_deg,
            "lat_deg": lat_deg,
            "formula_lon": "lon_sphere = atan2(X,Z); lon_output = lon_sphere − yaw_offset",
        },
        "step_8_panorama_pixel": {
            "x": pano_x,
            "y": pano_y,
            "out_width": out_w,
            "out_height": out_h,
            "formula": "GPano: x from lon, y from lat (row 0 = lat +90°)",
        },
        "inverse_remap_round_trip": {
            "from_pano_pixel": [pano_x, pano_y],
            "lon_output_deg": lon_out_back,
            "lon_sphere_deg": lon_sphere_back,
            "lat_deg": lat_back,
            "world_xyz": list(xyz_back),
            "matches_input_world": np.allclose(xyz_back, _vec_list(v_world), atol=1e-6),
        },
    }


def build_ray_pipeline_trace(
    meta: dict,
    world_vector: Optional[tuple[float, float, float]] = None,
) -> dict[str, Any]:
    """Trace one world ray through lens1 and lens2 paths."""
    out_w = int(meta.get("output_width", 5760))
    out_h = int(meta.get("output_height", 2880))
    if world_vector is None:
        world_vector = STITCHER_FORWARD  # lon=0°, lat=0° panorama centre

    w = _unit(np.array(world_vector, dtype=np.float64))
    lon, lat = world_vector_to_lonlat(float(w[0]), float(w[1]), float(w[2]))

    return {
        "conventions": stitcher_conventions(),
        "sample_ray": {
            "world_vector_xyz": _vec_list(w),
            "lon_deg": lon,
            "lat_deg": lat,
            "description": "Default: forward +Z at panorama centre (lon=0°, lat=0°)",
        },
        "lens1": trace_world_ray_for_lens(
            tuple(w), "lens1", meta, out_w, out_h, yaw_offset_deg=0.0, body_flip=False,
        ),
        "lens2": trace_world_ray_for_lens(
            tuple(w), "lens2", meta, out_w, out_h, yaw_offset_deg=0.0, body_flip=True,
        ),
    }


def format_ray_pipeline_trace(data: dict) -> str:
    lines: list[str] = [
        "═══ Ray pipeline trace (one world direction through full stitch path) ═══",
        "",
        "── Coordinate conventions ──",
    ]
    conv = data["conventions"]
    for key, val in conv.items():
        lines.append(f"  [{key}]")
        if isinstance(val, dict):
            for k2, v2 in val.items():
                if isinstance(v2, list):
                    lines.append(f"    {k2}:")
                    for item in v2:
                        lines.append(f"      • {item}")
                elif isinstance(v2, dict):
                    lines.append(f"    {k2}: {v2}")
                else:
                    lines.append(f"    {k2}: {v2}")
        lines.append("")

    s = data["sample_ray"]
    lines.extend([
        "── Sample world ray ──",
        f"  (X,Y,Z) = ({s['world_vector_xyz'][0]:.6f}, {s['world_vector_xyz'][1]:.6f}, {s['world_vector_xyz'][2]:.6f})",
        f"  lon = {s['lon_deg']:.4f}°,  lat = {s['lat_deg']:.4f}°",
        f"  ({s['description']})",
        "",
    ])

    for lens_key in ("lens1", "lens2"):
        t = data[lens_key]
        lines.append(f"── {lens_key.upper()} trace ──")
        lines.append(f"  calibration (ra,rb,rc) = {t['calibration_rot_deg']}")
        lines.append(f"  yaw_offset = {t['yaw_offset_deg']}°   body_flip = {t['body_flip']}")
        lines.append("")
        lines.append("  1) World ray (X,Y,Z):")
        w = t["step_1_world_ray"]
        lines.append(f"     {_fmt_vec(w['vector_xyz'])}   lon={w['lon_deg']:.4f}° lat={w['lat_deg']:.4f}°")
        lines.append("")
        lines.append(f"  2) After R_cal  [{t['step_2_after_R_cal']['formula']}]:")
        lines.append(f"     {_fmt_vec(t['step_2_after_R_cal']['vector_xyz'])}")
        lines.append(f"     R_cal = {_fmt_mat(t['step_2_after_R_cal']['matrix'])}")
        lines.append("")
        s3 = t["step_3_after_Ry_pi"]
        lines.append(f"  3) After Ry(π):  {s3['formula']}")
        if s3["applied"]:
            lines.append(f"     {_fmt_vec(s3['vector_xyz'])}")
            lines.append(f"     Ry(π) = {_fmt_mat(s3['matrix'])}")
        else:
            lines.append("     (not applied)")
        lines.append("")
        lines.append(f"  4) Effective R_eff @ v_world → lens frame:")
        lines.append(f"     v_lens = {_fmt_vec(t['step_4_effective_rotation']['vector_lens_xyz'])}")
        lines.append(f"     R_eff = {_fmt_mat(t['step_4_effective_rotation']['matrix'])}")
        lines.append("")
        ang = t["step_5_fisheye_angles"]
        lines.append("  5) Fisheye angles (lens frame):")
        lines.append(f"     theta = {ang['theta_deg']:.4f}°   phi = {ang['phi_deg']:.4f}°")
        lines.append("")
        fp = t["step_6_fisheye_pixel"]
        lines.append("  6) Fisheye pixel (equidistant):")
        lines.append(
            f"     r = {fp['r_px']:.2f} px   (u,v) = ({fp['u']:.2f}, {fp['v']:.2f})"
            f"   valid={fp['valid_in_fov']}"
        )
        lines.append(f"     cx={fp['cx']:.1f} cy={fp['cy']:.1f} radius={fp['radius']:.1f} FOV={fp['fov_deg']}°")
        lines.append("")
        inv = t["step_7_inverse_mapping_to_panorama"]
        lines.append("  7) Inverse mapping (world → equirect lon/lat):")
        lines.append(
            f"     lon_sphere={inv['lon_sphere_deg']:.4f}°  "
            f"lon_output={inv['lon_output_deg']:.4f}°  lat={inv['lat_deg']:.4f}°"
        )
        lines.append("")
        pan = t["step_8_panorama_pixel"]
        lines.append("  8) Panorama pixel (GPano layout):")
        lines.append(f"     (x,y) = ({pan['x']}, {pan['y']})  on {pan['out_width']}×{pan['out_height']}")
        rt = t["inverse_remap_round_trip"]
        lines.append(
            f"     round-trip from (x,y): world={rt['world_xyz']}  matches={rt['matches_input_world']}"
        )
        lines.append("")

    lines.append(
        "Note: cv2.remap runs this chain FORWARD per panorama pixel "
        "(steps 7→1→2→3→4→5→6) to build mapx/mapy; the trace above follows one fixed world ray."
    )
    return "\n".join(lines).rstrip()


def _fmt_vec(v: list[float]) -> str:
    return f"({v[0]:+.6f}, {v[1]:+.6f}, {v[2]:+.6f})"


def _fmt_mat(m: list[list[float]]) -> str:
    rows = ["[" + ", ".join(f"{x:+.5f}" for x in row) + "]" for row in m]
    return "[" + "; ".join(rows) + "]"
