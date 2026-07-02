"""
Measure and visualize lens optical-axis directions using the *current* stitcher
conventions — no remapping or rotation changes.

Reads calibration from a raw file, applies ``fisheye_stitch._lens_rot_matrix`` exactly
as ``_hemisphere_map`` does, and reports where each lens +Z optical axis lands in
the stitcher world / equirect frame.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

from app.services.fisheye_stitch import (
    DualFisheyeCalibration,
    _lens_rot_matrix,
    parse_embedded_calibration,
)

# Documented stitcher world frame (must match _hemisphere_map inline mapping).
STITCHER_FORWARD = (0.0, 0.0, 1.0)  # lon=0°, lat=0°
STITCHER_ZENITH = (0.0, 1.0, 0.0)   # lat=+90°
LENS_OPTICAL_AXIS = (0.0, 0.0, 1.0)  # theta = acos(Zr) in lens frame

# Match fisheye_stitch::_hemisphere_map lens2 call sites.
LENS2_STITCHER_YAW_OFFSET_DEG = 0.0
LENS2_BODY_FLIP_AXIS = "Ry (π)"
LENS2_BODY_FLIP_DETAIL = (
    "_rot_matrix(180, 0, 0) → Ry(π) only; first calibration arg (ra) is the Ry axis. Not Rx or Rz."
)

# World axis unit vectors in stitcher frame + BGR marker colors.
WORLD_AXIS_MARKERS: tuple[tuple[str, tuple[float, float, float], tuple[int, int, int]], ...] = (
    ("+X", (1.0, 0.0, 0.0), (0, 0, 255)),
    ("-X", (-1.0, 0.0, 0.0), (0, 0, 128)),
    ("+Y", (0.0, 1.0, 0.0), (0, 255, 0)),
    ("-Y", (0.0, -1.0, 0.0), (0, 160, 0)),
    ("+Z", (0.0, 0.0, 1.0), (255, 160, 0)),
    ("-Z", (0.0, 0.0, -1.0), (255, 0, 255)),
)


@dataclass(frozen=True)
class AxisReport:
    lens_label: str
    calibration_rot_deg: tuple[float, float, float]
    stitcher_yaw_offset_deg: float
    world_vector: tuple[float, float, float]
    longitude_deg: float
    latitude_deg: float

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class LensOrientationAudit:
    """Full audit for one lens: R matrix, boresight, yaw_offset interaction."""

    lens_label: str
    calibration_rot_deg: tuple[float, float, float]
    rotation_formula: str
    body_flip_applied: bool
    rotation_matrix: list[list[float]]  # 3×3 effective R used by stitcher
    # Boresight from R alone (yaw_offset does not enter this vector).
    world_vector_before_yaw_offset: tuple[float, float, float]
    world_longitude_deg: float
    world_latitude_deg: float
    stitcher_yaw_offset_deg: float
    # Where that world direction is assigned on the output equirect by _hemisphere_map:
    # lon_sphere = lon_output + yaw_offset  ⇒  lon_output = lon_world − yaw_offset.
    output_equirect_longitude_deg: float
    output_equirect_latitude_deg: float
    # World vector is unchanged by yaw_offset; only output lon shifts.
    yaw_offset_applied_to: str = "equirect longitude before sphere_dirs (not composed with R)"

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Lens2CompositionCandidate:
    name: str
    formula: str
    world_vector: tuple[float, float, float]
    world_longitude_deg: float
    world_latitude_deg: float
    separation_from_lens1_deg: float

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class OrientationVerification:
    conventions: dict
    forward: dict
    stitcher_code_path: dict
    calibration_analysis: dict
    lens1: LensOrientationAudit
    lens2: LensOrientationAudit
    lens2_composition_candidates: list[Lens2CompositionCandidate] = field(default_factory=list)
    separation_lens1_lens2_world_deg: float = 0.0
    separation_lens1_lens2_output_lon_deg: float = 0.0
    separation_lens1_forward_deg: float = 0.0
    separation_lens2_forward_deg: float = 0.0
    findings: list[str] = field(default_factory=list)

    # Legacy fields for diagram / backward compat
    @property
    def lens1_axis(self) -> AxisReport:
        return AxisReport(
            lens_label="lens1",
            calibration_rot_deg=self.lens1.calibration_rot_deg,
            stitcher_yaw_offset_deg=self.lens1.stitcher_yaw_offset_deg,
            world_vector=self.lens1.world_vector_before_yaw_offset,
            longitude_deg=self.lens1.world_longitude_deg,
            latitude_deg=self.lens1.world_latitude_deg,
        )

    @property
    def lens2_axis(self) -> AxisReport:
        return AxisReport(
            lens_label="lens2",
            calibration_rot_deg=self.lens2.calibration_rot_deg,
            stitcher_yaw_offset_deg=self.lens2.stitcher_yaw_offset_deg,
            world_vector=self.lens2.world_vector_before_yaw_offset,
            longitude_deg=self.lens2.world_longitude_deg,
            latitude_deg=self.lens2.world_latitude_deg,
        )

    def as_dict(self) -> dict:
        return {
            "conventions": self.conventions,
            "forward": self.forward,
            "stitcher_code_path": self.stitcher_code_path,
            "calibration_analysis": self.calibration_analysis,
            "lens1": self.lens1.as_dict(),
            "lens2": self.lens2.as_dict(),
            "lens2_composition_candidates": [c.as_dict() for c in self.lens2_composition_candidates],
            "separation_lens1_lens2_world_deg": self.separation_lens1_lens2_world_deg,
            "separation_lens1_lens2_output_lon_deg": self.separation_lens1_lens2_output_lon_deg,
            "separation_lens1_forward_deg": self.separation_lens1_forward_deg,
            "separation_lens2_forward_deg": self.separation_lens2_forward_deg,
            "findings": self.findings,
        }


def world_vector_to_lonlat(x: float, y: float, z: float) -> tuple[float, float]:
    """Inverse of the stitcher equirect mapping in ``_hemisphere_map``."""
    lat = float(np.degrees(np.arcsin(np.clip(y, -1.0, 1.0))))
    lon = float(np.degrees(np.arctan2(x, z)))
    return lon, lat


def _wrap_lon_deg(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def lonlat_to_pixel(lon_deg: float, lat_deg: float, width: int, height: int) -> tuple[int, int]:
    """GPano layout: row 0 = lat +90°, lon −180° at x=0."""
    lon = np.radians(lon_deg)
    lat = np.radians(lat_deg)
    px = int(round((lon / (2.0 * np.pi) + 0.5) * (width - 1)))
    py = int(round((0.5 - lat / np.pi) * (height - 1)))
    return px, py


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        return v
    return v / n


def rotation_matrix_array(
    rot_deg: tuple[float, float, float],
    *,
    body_flip: bool = False,
) -> np.ndarray:
    return _lens_rot_matrix(rot_deg, body_flip=body_flip)


def ry_pi_matrix() -> np.ndarray:
    """Ry(π) using the same Ry definition as ``_rot_matrix`` (first arg = ra)."""
    return rotation_matrix_array((180.0, 0.0, 0.0))


def optical_axis_from_R(R: np.ndarray) -> np.ndarray:
    """World unit vector where lens +Z points: ``v_world = R.T @ e_z``."""
    return _unit(R.T @ np.array(LENS_OPTICAL_AXIS, dtype=np.float64))


def optical_axis_world(
    rot_deg: tuple[float, float, float],
    *,
    body_flip: bool = False,
) -> np.ndarray:
    return optical_axis_from_R(rotation_matrix_array(rot_deg, body_flip=body_flip))


def _vec_tuple(v: np.ndarray) -> tuple[float, float, float]:
    return (float(v[0]), float(v[1]), float(v[2]))


def _matrix_list(R: np.ndarray) -> list[list[float]]:
    return [[float(R[i, j]) for j in range(3)] for i in range(3)]


def audit_lens(
    lens_label: str,
    rot_deg: tuple[float, float, float],
    yaw_offset_rad: float,
    *,
    body_flip: bool = False,
) -> LensOrientationAudit:
    ra, rb, rc = rot_deg
    if body_flip:
        formula = f"Rz({rc}) @ Rx({rb}) @ Ry({ra}) @ Ry(π)"
    else:
        formula = f"Rz({rc}) @ Rx({rb}) @ Ry({ra})"
    R = rotation_matrix_array(rot_deg, body_flip=body_flip)
    v = optical_axis_from_R(R)
    lon_w, lat_w = world_vector_to_lonlat(float(v[0]), float(v[1]), float(v[2]))
    yaw_deg = float(np.degrees(yaw_offset_rad))
    lon_out = _wrap_lon_deg(lon_w - yaw_deg)
    return LensOrientationAudit(
        lens_label=lens_label,
        calibration_rot_deg=rot_deg,
        rotation_formula=formula,
        body_flip_applied=body_flip,
        rotation_matrix=_matrix_list(R),
        world_vector_before_yaw_offset=_vec_tuple(v),
        world_longitude_deg=lon_w,
        world_latitude_deg=lat_w,
        stitcher_yaw_offset_deg=yaw_deg,
        output_equirect_longitude_deg=lon_out,
        output_equirect_latitude_deg=lat_w,
    )


def _composition_candidate(
    name: str,
    formula: str,
    R: np.ndarray,
    lens1_vector: tuple[float, float, float],
) -> Lens2CompositionCandidate:
    v = optical_axis_from_R(R)
    lon, lat = world_vector_to_lonlat(float(v[0]), float(v[1]), float(v[2]))
    return Lens2CompositionCandidate(
        name=name,
        formula=formula,
        world_vector=_vec_tuple(v),
        world_longitude_deg=lon,
        world_latitude_deg=lat,
        separation_from_lens1_deg=angular_separation_deg(_vec_tuple(v), lens1_vector),
    )


def angular_separation_deg(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> float:
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)
    dot = float(np.clip(np.dot(_unit(va), _unit(vb)), -1.0, 1.0))
    return float(np.degrees(np.arccos(dot)))


def _lon_separation_deg(a: float, b: float) -> float:
    return abs(_wrap_lon_deg(a - b))


def verify_orientation(calib: DualFisheyeCalibration) -> OrientationVerification:
    r1 = calib.lens1.rot
    r2 = calib.lens2.rot
    lens1 = audit_lens("lens1", r1, 0.0, body_flip=False)
    lens2 = audit_lens("lens2", r2, 0.0, body_flip=True)
    v1 = lens1.world_vector_before_yaw_offset
    v2 = lens2.world_vector_before_yaw_offset
    sep_world = angular_separation_deg(v1, v2)

    R1 = rotation_matrix_array(r1, body_flip=False)
    R2 = rotation_matrix_array(r2, body_flip=False)
    Ry_pi = ry_pi_matrix()

    candidates = [
        _composition_candidate("lens2_R_only", "R2 (no body flip)", R2, v1),
        _composition_candidate("lens2_R2_at_Ry_pi", "R2 @ Ry(π) [stitcher]", R2 @ Ry_pi, v1),
        _composition_candidate("lens2_Ry_pi_at_R2", "Ry(π) @ R2", Ry_pi @ R2, v1),
    ]

    rc_delta = r1[2] - r2[2]
    findings = [
        (
            "Lens1 uses R1 = Rz(rc) @ Rx(rb) @ Ry(ra). "
            "Lens2 uses R2 @ Ry(π) with the same Ry axis as calibration ra."
        ),
        (
            "yaw_offset is applied BEFORE R: `lon = lon_output + yaw_offset`, "
            "then `v_lens = R_eff @ v_world`. It does not replace the body flip."
        ),
        (
            f"World boresight separation lens1 ↔ lens2: {sep_world:.2f}° "
            f"(expected ≈180° for back-to-back fisheyes)."
        ),
        (
            f"Lens1 boresight near +Z: z={v1[2]:+.4f}, sep from forward={angular_separation_deg(v1, STITCHER_FORWARD):.2f}°."
        ),
        (
            f"Lens2 boresight near −Z: z={v2[2]:+.4f}, sep from forward={angular_separation_deg(v2, STITCHER_FORWARD):.2f}°."
        ),
        (
            f"Calibration Δrc={rc_delta:.3f}° alone did not flip lens2; "
            f"R2 @ Ry(π) was required (audit candidate sep={candidates[1].separation_from_lens1_deg:.2f}°)."
        ),
    ]
    if abs(sep_world - 180.0) > 15.0:
        findings.append(
            f"WARNING: boresight separation {sep_world:.1f}° is still far from 180°."
        )

    fwd = STITCHER_FORWARD
    return OrientationVerification(
        conventions={
            "equirect_world_frame": "X=cos(lat)*sin(lon), Y=sin(lat), Z=cos(lat)*cos(lon)",
            "forward_at_lon0_lat0": STITCHER_FORWARD,
            "zenith_at_lat90": STITCHER_ZENITH,
            "lens_optical_axis_lens_frame": LENS_OPTICAL_AXIS,
            "world_to_lens": "v_lens = R_eff @ v_world",
            "rotation_matrix_lens1": "R1 = Rz(rc) @ Rx(rb) @ Ry(ra)",
            "rotation_matrix_lens2": "R2 @ Ry(π)  (body-frame flip after calibration)",
            "calibration_frame": "per-lens (ra,rb,rc); lens2 body flip applied in stitcher only",
        },
        forward={
            "world_vector": fwd,
            "longitude_deg": 0.0,
            "latitude_deg": 0.0,
        },
        stitcher_code_path={
            "file": "fisheye_stitch.py::_hemisphere_map",
            "order": [
                "1. lon_output, lat from equirect grid",
                "2. lon = lon_output + yaw_offset   # lens2: 0",
                "3. v_world = sphere_dirs(lon, lat)",
                "4. v_lens = R_eff @ v_world   # lens2: R2 @ Ry(π)",
                "5. theta = acos(Z_lens), fisheye UV",
            ],
            "yaw_offset_composes_with_R": False,
            "lens2_body_flip": "R2 @ Ry(π)",
            "lens1_yaw_offset_rad": 0.0,
            "lens2_yaw_offset_rad": 0.0,
        },
        calibration_analysis={
            "lens1_rot_deg": r1,
            "lens2_rot_deg": r2,
            "delta_ra_deg": r1[0] - r2[0],
            "delta_rb_deg": r1[1] - r2[1],
            "delta_rc_deg": r1[2] - r2[2],
            "rc_sum_near_180": abs(abs(rc_delta) - 180.0) < 5.0,
        },
        lens1=lens1,
        lens2=lens2,
        lens2_composition_candidates=candidates,
        separation_lens1_lens2_world_deg=sep_world,
        separation_lens1_lens2_output_lon_deg=_lon_separation_deg(
            lens1.output_equirect_longitude_deg, lens2.output_equirect_longitude_deg
        ),
        separation_lens1_forward_deg=angular_separation_deg(v1, fwd),
        separation_lens2_forward_deg=angular_separation_deg(v2, fwd),
        findings=findings,
    )


def format_orientation_report(report: OrientationVerification) -> str:
    l1, l2 = report.lens1, report.lens2
    lines = [
        "── Stitcher orientation audit (matches current stitcher) ──",
        "",
        "── Code path (_hemisphere_map) ──",
    ]
    for step in report.stitcher_code_path["order"]:
        lines.append(f"  {step}")
    lines.append(f"  yaw_offset composes with R: {report.stitcher_code_path['yaw_offset_composes_with_R']}")
    lines.append("")
    lines.append("── Calibration (per-lens, from blob) ──")
    ca = report.calibration_analysis
    lines.append(f"  lens1 rot (ra,rb,rc) = {ca['lens1_rot_deg']}")
    lines.append(f"  lens2 rot (ra,rb,rc) = {ca['lens2_rot_deg']}")
    lines.append(
        f"  Δra={ca['delta_ra_deg']:.3f}°  Δrb={ca['delta_rb_deg']:.3f}°  "
        f"Δrc={ca['delta_rc_deg']:.3f}°  (|Δrc|≈180°: {ca['rc_sum_near_180']})"
    )
    lines.append("")
    lines.append("── Lens 1 ──")
    lines.append(f"  {l1.rotation_formula}")
    lines.append(f"  body_flip = {l1.body_flip_applied}")
    lines.append("  rotation matrix R:")
    for row in l1.rotation_matrix:
        lines.append(f"    [{row[0]:+.8f}, {row[1]:+.8f}, {row[2]:+.8f}]")
    lines.append("  optical axis BEFORE yaw_offset (world boresight R.T @ [0,0,1]):")
    v1 = l1.world_vector_before_yaw_offset
    lines.append(f"    world vector = ({v1[0]:+.6f}, {v1[1]:+.6f}, {v1[2]:+.6f})")
    lines.append(f"    longitude = {l1.world_longitude_deg:+.2f}°")
    lines.append(f"    latitude  = {l1.world_latitude_deg:+.2f}°")
    lines.append(f"  yaw_offset = {l1.stitcher_yaw_offset_deg:.1f}° (applied to equirect lon, not R)")
    lines.append("  optical axis AFTER yaw_offset (output equirect assignment only — world vector unchanged):")
    lines.append(f"    output equirect longitude = {l1.output_equirect_longitude_deg:+.2f}°")
    lines.append(f"    output equirect latitude  = {l1.output_equirect_latitude_deg:+.2f}°")
    lines.append("")
    lines.append("── Lens 2 ──")
    lines.append(f"  {l2.rotation_formula}")
    lines.append(f"  body_flip = {l2.body_flip_applied}")
    lines.append("  rotation matrix R:")
    for row in l2.rotation_matrix:
        lines.append(f"    [{row[0]:+.8f}, {row[1]:+.8f}, {row[2]:+.8f}]")
    lines.append("  optical axis BEFORE yaw_offset (world boresight R.T @ [0,0,1]):")
    v2 = l2.world_vector_before_yaw_offset
    lines.append(f"    world vector = ({v2[0]:+.6f}, {v2[1]:+.6f}, {v2[2]:+.6f})")
    lines.append(f"    longitude = {l2.world_longitude_deg:+.2f}°")
    lines.append(f"    latitude  = {l2.world_latitude_deg:+.2f}°")
    lines.append(f"  yaw_offset = {l2.stitcher_yaw_offset_deg:.1f}° (applied to equirect lon, not R)")
    lines.append("  optical axis AFTER yaw_offset (output equirect assignment only — world vector unchanged):")
    lines.append(f"    output equirect longitude = {l2.output_equirect_longitude_deg:+.2f}°")
    lines.append(f"    output equirect latitude  = {l2.output_equirect_latitude_deg:+.2f}°")
    lines.append("")
    lines.append("── Lens 2 composition reference (lens2 now uses R2 @ Ry(π)) ──")
    for c in report.lens2_composition_candidates:
        lines.append(
            f"  {c.formula}: world=({c.world_vector[0]:+.4f},{c.world_vector[1]:+.4f},{c.world_vector[2]:+.4f}) "
            f"lon={c.world_longitude_deg:+.2f}° lat={c.world_latitude_deg:+.2f}° "
            f"sep from lens1={c.separation_from_lens1_deg:.2f}°"
        )
    lines.append("")
    lines.append("── Separations ──")
    lines.append(
        f"  lens1 ↔ lens2 world boresight: {report.separation_lens1_lens2_world_deg:.2f}°  (expected ≈180°)"
    )
    lines.append(
        f"  lens1 ↔ lens2 output equirect lon: {report.separation_lens1_lens2_output_lon_deg:.2f}°  "
        f"(yaw_offset-only hemisphere split)"
    )
    lines.append(f"  lens1 ↔ forward +Z: {report.separation_lens1_forward_deg:.2f}°")
    lines.append(f"  lens2 ↔ forward +Z: {report.separation_lens2_forward_deg:.2f}°")
    lines.append("")
    lines.append("── Findings ──")
    for i, finding in enumerate(report.findings, 1):
        lines.append(f"  {i}. {finding}")
    return "\n".join(lines)


def _circular_mean_lon_deg(lon_deg: np.ndarray) -> float:
    r = np.radians(lon_deg.astype(np.float64))
    return float(np.degrees(np.arctan2(np.mean(np.sin(r)), np.mean(np.cos(r)))))


def compute_seam_longitudes(
    v1: np.ndarray,
    v2: np.ndarray,
    out_w: int,
    out_h: int,
    lens1_longitude_deg: float,
) -> dict:
    """Expected ±90° seams from lens1 boresight; actual overlap longitude from masks."""
    lons_rad = np.linspace(-np.pi, np.pi, out_w, endpoint=False)
    lons_deg = np.degrees(lons_rad)
    lats_rad = np.linspace(np.pi / 2, -np.pi / 2, out_h)
    lon_g, _ = np.meshgrid(lons_rad, lats_rad)

    overlap = v1.astype(bool) & v2.astype(bool)
    expected_a = _wrap_lon_deg(lens1_longitude_deg + 90.0)
    expected_b = _wrap_lon_deg(lens1_longitude_deg - 90.0)

    result: dict = {
        "expected_seam_longitude_deg": [expected_a, expected_b],
        "expected_seam_note": "±90° from lens1 optical-axis longitude (dual-fisheye hemisphere boundary)",
    }

    if overlap.any():
        result["actual_overlap_longitude_centroid_deg"] = _circular_mean_lon_deg(
            np.degrees(lon_g[overlap])
        )
    else:
        result["actual_overlap_longitude_centroid_deg"] = None

    h = out_h
    row0, row1 = int(h * 0.45), int(h * 0.55)
    ov_band = overlap[row0:row1, :]
    lon_band = lon_g[row0:row1, :]
    if ov_band.any():
        result["actual_overlap_longitude_equator_deg"] = _circular_mean_lon_deg(
            np.degrees(lon_band[ov_band])
        )
        cols = np.where(ov_band.any(axis=0))[0]
        if cols.size:
            result["actual_overlap_longitude_range_deg"] = [
                float(lons_deg[cols[0]]),
                float(lons_deg[cols[-1]]),
            ]
        else:
            result["actual_overlap_longitude_range_deg"] = None
    else:
        result["actual_overlap_longitude_equator_deg"] = None
        result["actual_overlap_longitude_range_deg"] = None

    return result


def build_world_frame_measurements(
    report: OrientationVerification,
    v1: np.ndarray,
    v2: np.ndarray,
    out_w: int,
    out_h: int,
) -> dict:
    """Measurements for world-frame verification on the stitched equirect."""
    l1, l2 = report.lens1, report.lens2
    axes = []
    for label, vec, _color in WORLD_AXIS_MARKERS:
        lon, lat = world_vector_to_lonlat(vec[0], vec[1], vec[2])
        axes.append({
            "label": label,
            "world_vector": vec,
            "longitude_deg": lon,
            "latitude_deg": lat,
        })

    seam = compute_seam_longitudes(
        v1, v2, out_w, out_h, l1.world_longitude_deg,
    )

    return {
        "world_frame": "X=cos(lat)*sin(lon), Y=sin(lat), Z=cos(lat)*cos(lon)",
        "world_axes": axes,
        "lens1_optical_axis": {
            "world_vector": l1.world_vector_before_yaw_offset,
            "longitude_deg": l1.world_longitude_deg,
            "latitude_deg": l1.world_latitude_deg,
            "rotation": l1.rotation_formula,
            "yaw_offset_deg": l1.stitcher_yaw_offset_deg,
            "body_flip": l1.body_flip_applied,
        },
        "lens2_optical_axis": {
            "world_vector": l2.world_vector_before_yaw_offset,
            "longitude_deg": l2.world_longitude_deg,
            "latitude_deg": l2.world_latitude_deg,
            "rotation": l2.rotation_formula,
            "yaw_offset_deg": l2.stitcher_yaw_offset_deg,
            "body_flip": l2.body_flip_applied,
        },
        "seam": seam,
        "body_flip_axis": LENS2_BODY_FLIP_AXIS,
        "body_flip_detail": LENS2_BODY_FLIP_DETAIL,
    }


def format_world_frame_measurements(m: dict) -> str:
    l1 = m["lens1_optical_axis"]
    l2 = m["lens2_optical_axis"]
    seam = m["seam"]
    exp = seam["expected_seam_longitude_deg"]
    actual = seam.get("actual_overlap_longitude_equator_deg")
    if actual is None:
        actual = seam.get("actual_overlap_longitude_centroid_deg")

    lines = [
        "── World frame on stitched equirect ──",
        "",
        "Lens1 optical axis",
        f"  lon = {l1['longitude_deg']:+.2f}°",
        f"  lat = {l1['latitude_deg']:+.2f}°",
        "",
        "Lens2 optical axis",
        f"  lon = {l2['longitude_deg']:+.2f}°",
        f"  lat = {l2['latitude_deg']:+.2f}°",
        "",
        f"Expected seam longitude = {exp[0]:+.2f}°, {exp[1]:+.2f}°",
        f"Actual overlap longitude = {actual:+.2f}°" if actual is not None else "Actual overlap longitude = (no overlap)",
    ]
    lon_range = seam.get("actual_overlap_longitude_range_deg")
    if lon_range:
        lines.append(f"Actual overlap longitude range (equator band) = {lon_range[0]:+.2f}° to {lon_range[1]:+.2f}°")
    lines.extend([
        "",
        "Current body flip axis",
        f"  {m['body_flip_axis']}  (not Rx, not Rz)",
        f"  {m['body_flip_detail']}",
        "",
        "World axis markers (stitcher frame):",
    ])
    for ax in m["world_axes"]:
        lines.append(
            f"  {ax['label']}: lon={ax['longitude_deg']:+.2f}° lat={ax['latitude_deg']:+.2f}°"
        )
    return "\n".join(lines)


def render_world_frame_on_blend(
    blended_bgr: np.ndarray,
    measurements: dict,
) -> np.ndarray:
    """Draw ±X/±Y/±Z and lens optical axes on the stitched equirect."""
    import cv2

    img = blended_bgr.copy()
    h, w = img.shape[:2]
    equator_y = h // 2
    meridian_x = w // 2
    cv2.line(img, (0, equator_y), (w - 1, equator_y), (200, 200, 200), 1, cv2.LINE_AA)
    cv2.line(img, (meridian_x, 0), (meridian_x, h - 1), (200, 200, 200), 1, cv2.LINE_AA)

    for label, _vec, color in WORLD_AXIS_MARKERS:
        ax = next(a for a in measurements["world_axes"] if a["label"] == label)
        _draw_axis_marker(
            img, ax["longitude_deg"], ax["latitude_deg"], color, label, radius=11,
        )

    l1 = measurements["lens1_optical_axis"]
    l2 = measurements["lens2_optical_axis"]
    _draw_axis_marker(
        img, l1["longitude_deg"], l1["latitude_deg"], (255, 255, 0), "L1 axis", radius=13,
    )
    _draw_axis_marker(
        img, l2["longitude_deg"], l2["latitude_deg"], (0, 165, 255), "L2 axis", radius=13,
    )

    for lon in measurements["seam"]["expected_seam_longitude_deg"]:
        px, _ = lonlat_to_pixel(lon, 0.0, w, h)
        cv2.line(img, (px, equator_y - 30), (px, equator_y + 30), (0, 255, 255), 2, cv2.LINE_AA)

    actual = measurements["seam"].get("actual_overlap_longitude_equator_deg")
    if actual is not None:
        px, _ = lonlat_to_pixel(actual, 0.0, w, h)
        cv2.line(img, (px, equator_y - 50), (px, equator_y + 50), (0, 255, 255), 3, cv2.LINE_AA)
        cv2.putText(img, "overlap", (px + 6, equator_y - 54), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)

    cv2.putText(
        img, "world frame markers", (10, h - 12),
        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 2, cv2.LINE_AA,
    )
    return img


def render_equirect_latlon_grid(
    blended_bgr: np.ndarray,
    *,
    step_deg: int = 30,
) -> np.ndarray:
    """Overlay 30° lon/lat grid on blended equirect (GPano layout, visualization only)."""
    import cv2

    img = blended_bgr.copy()
    h, w = img.shape[:2]

    for lon in range(-180, 181, step_deg):
        px, _ = lonlat_to_pixel(float(lon), 0.0, w, h)
        is_prime = lon == 0
        is_antimeridian = abs(lon) == 180
        color = (255, 0, 255) if is_prime else (255, 255, 0)
        thickness = 2 if is_prime else 1
        cv2.line(img, (px, 0), (px, h - 1), color, thickness, cv2.LINE_AA)
        label = "lon 0" if is_prime else f"lon {lon:+d}"
        tx = min(max(px + 4, 2), w - 90)
        cv2.putText(
            img, label, (tx, 22 if not is_antimeridian else h - 8),
            cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA,
        )

    for lat in range(-90, 91, step_deg):
        _, py = lonlat_to_pixel(0.0, float(lat), w, h)
        is_equator = lat == 0
        color = (0, 255, 255) if is_equator else (180, 255, 180)
        thickness = 2 if is_equator else 1
        cv2.line(img, (0, py), (w - 1, py), color, thickness, cv2.LINE_AA)
        label = "lat 0" if is_equator else f"lat {lat:+d}"
        ty = min(max(py - 6, 14), h - 4)
        cv2.putText(
            img, label, (6, ty),
            cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA,
        )

    cx, cy = lonlat_to_pixel(0.0, 0.0, w, h)
    cv2.drawMarker(img, (cx, cy), (255, 255, 255), cv2.MARKER_CROSS, 28, 2, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), 10, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(
        img, "center lon 0 lat 0", (min(cx + 12, w - 160), max(cy - 10, 20)),
        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA,
    )

    cv2.putText(
        img, f"lat/lon grid every {step_deg} deg (GPano)", (10, h - 10),
        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1, cv2.LINE_AA,
    )
    return img


def _draw_axis_marker(
    img,
    lon_deg: float,
    lat_deg: float,
    color: tuple[int, int, int],
    label: str,
    *,
    radius: int = 14,
) -> None:
    import cv2

    h, w = img.shape[:2]
    px, py = lonlat_to_pixel(lon_deg, lat_deg, w, h)
    cv2.circle(img, (px, py), radius, color, 3, cv2.LINE_AA)
    cv2.drawMarker(img, (px, py), color, cv2.MARKER_CROSS, radius * 2, 2, cv2.LINE_AA)
    tx = min(max(px + 12, 4), w - 220)
    ty = min(max(py - 8, 20), h - 8)
    cv2.putText(img, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)


def render_orientation_map(
    report: OrientationVerification,
    width: int = 2048,
    height: int = 1024,
    background_bgr: Optional[np.ndarray] = None,
) -> np.ndarray:
    """Equirect diagram on OUTPUT longitude: equator, meridian, axes."""
    import cv2

    if background_bgr is not None:
        img = cv2.resize(background_bgr, (width, height), interpolation=cv2.INTER_AREA)
    else:
        img = np.full((height, width, 3), 32, dtype=np.uint8)

    equator_y = height // 2
    meridian_x = width // 2
    cv2.line(img, (0, equator_y), (width - 1, equator_y), (255, 255, 0), 2, cv2.LINE_AA)
    cv2.line(img, (meridian_x, 0), (meridian_x, height - 1), (255, 0, 255), 2, cv2.LINE_AA)
    cv2.putText(img, "equator", (10, equator_y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    cv2.putText(img, "prime meridian (lon=0)", (meridian_x + 8, height // 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 0, 255), 2)

    _draw_axis_marker(img, 0.0, 0.0, (0, 255, 0), "forward +Z")

    # World boresights (both near lon≈0 — overlap shows the collapse).
    _draw_axis_marker(
        img, report.lens1.world_longitude_deg, report.lens1.world_latitude_deg,
        (0, 0, 255), "L1 world axis",
        radius=12,
    )
    # Lens2 effective boresight (R2 @ Ry(π)).
    _draw_axis_marker(
        img, report.lens2.world_longitude_deg, report.lens2.world_latitude_deg,
        (255, 0, 0), "L2 axis",
        radius=12,
    )

    sep_w = report.separation_lens1_lens2_world_deg
    cv2.putText(
        img,
        f"world boresight sep: {sep_w:.1f} deg (expect 180)",
        (12, height - 36),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        img,
        f"output lon sep: {report.separation_lens1_lens2_output_lon_deg:.1f} deg (yaw_offset)",
        (12, height - 12),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        2,
        cv2.LINE_AA,
    )
    return img


def verify_from_raw_bytes(
    data: bytes,
    *,
    out_dir: Optional[Path] = None,
    map_width: int = 2048,
    map_height: int = 1024,
    background_bgr: Optional[np.ndarray] = None,
) -> Optional[OrientationVerification]:
    calib = parse_embedded_calibration(data)
    if calib is None:
        return None
    report = verify_orientation(calib)
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        text = format_orientation_report(report)
        (out_dir / "orientation_report.txt").write_text(text + "\n", encoding="utf-8")
        (out_dir / "orientation_report.json").write_text(
            json.dumps(report.as_dict(), indent=2), encoding="utf-8"
        )
        import cv2

        diagram = render_orientation_map(
            report, map_width, map_height, background_bgr=background_bgr
        )
        cv2.imwrite(str(out_dir / "orientation_axes.png"), diagram)
    return report
