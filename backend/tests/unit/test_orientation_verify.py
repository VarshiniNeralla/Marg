"""Tests for orientation verification (measurement helpers only)."""
from __future__ import annotations

import numpy as np
import pytest

from app.services.orientation_verify import (
    STITCHER_FORWARD,
    angular_separation_deg,
    optical_axis_world,
    world_vector_to_lonlat,
)


def test_forward_roundtrip_lonlat():
    lon, lat = world_vector_to_lonlat(*STITCHER_FORWARD)
    assert lon == pytest.approx(0.0, abs=1e-6)
    assert lat == pytest.approx(0.0, abs=1e-6)


def test_zero_rotation_optical_axis_is_plus_z():
    v = optical_axis_world((0.0, 0.0, 0.0))
    assert v[0] == pytest.approx(0.0, abs=1e-9)
    assert v[1] == pytest.approx(0.0, abs=1e-9)
    assert v[2] == pytest.approx(1.0, abs=1e-9)


def test_opposing_unit_vectors_separation_180():
    a = (0.0, 0.0, 1.0)
    b = (0.0, 0.0, -1.0)
    assert angular_separation_deg(a, b) == pytest.approx(180.0, abs=1e-6)


def test_yaw_offset_shifts_output_lon_not_world_vector():
    from app.services.orientation_verify import audit_lens

    rot = (1.0, 2.0, 3.0)
    a0 = audit_lens("lens", rot, 0.0)
    a180 = audit_lens("lens", rot, np.pi)
    assert a0.world_vector_before_yaw_offset == a180.world_vector_before_yaw_offset
    from app.services.orientation_verify import _lon_separation_deg
    assert _lon_separation_deg(a0.output_equirect_longitude_deg, a180.output_equirect_longitude_deg) == pytest.approx(
        180.0, abs=0.01
    )


def test_rc_180_gap_does_not_flip_boresight_with_real_calibration():
    """Reproduce user capture: Δrc≈180° but world boresights still ~parallel."""
    from app.services.orientation_verify import verify_orientation
    from app.services.fisheye_stitch import DualFisheyeCalibration, LensCalibration

    calib = DualFisheyeCalibration(
        lens1=LensCalibration(0, 0, 2000, (0.847, 0.044, -179.356)),
        lens2=LensCalibration(0, 0, 2000, (-0.936, -0.104, 0.012)),
        width=5760,
        height=2880,
    )
    report = verify_orientation(calib)
    assert report.separation_lens1_lens2_world_deg == pytest.approx(178.2, abs=1.0)
    assert report.lens1.world_vector_before_yaw_offset[2] == pytest.approx(1.0, abs=0.01)
    assert report.lens2.world_vector_before_yaw_offset[2] == pytest.approx(-1.0, abs=0.01)
    r2_stitcher = next(
        c for c in report.lens2_composition_candidates if c.name == "lens2_R2_at_Ry_pi"
    )
    assert r2_stitcher.separation_from_lens1_deg == pytest.approx(178.2, abs=1.0)


def test_world_axis_directions_in_stitcher_frame():
    cases = [
        ("+X", (1, 0, 0), 90.0, 0.0),
        ("-X", (-1, 0, 0), -90.0, 0.0),
        ("+Y", (0, 1, 0), 0.0, 90.0),
        ("-Y", (0, -1, 0), 0.0, -90.0),
        ("+Z", (0, 0, 1), 0.0, 0.0),
        ("-Z", (0, 0, -1), 180.0, 0.0),
    ]
    for _name, vec, elon, elat in cases:
        lon, lat = world_vector_to_lonlat(*vec)
        assert lon == pytest.approx(elon, abs=0.01)
        assert lat == pytest.approx(elat, abs=0.01)


def test_format_world_frame_measurements_contains_seam_fields():
    from app.services.fisheye_stitch import DualFisheyeCalibration, LensCalibration
    from app.services.orientation_verify import (
        build_world_frame_measurements,
        format_world_frame_measurements,
        verify_orientation,
    )

    calib = DualFisheyeCalibration(
        lens1=LensCalibration(0, 0, 2000, (0.847, 0.044, -179.356)),
        lens2=LensCalibration(0, 0, 2000, (-0.936, -0.104, 0.012)),
        width=5760, height=2880,
    )
    report = verify_orientation(calib)
    v1 = np.zeros((32, 64), dtype=bool)
    v2 = np.zeros((32, 64), dtype=bool)
    v1[:, :40] = True
    v2[:, 24:] = True
    m = build_world_frame_measurements(report, v1, v2, 64, 32)
    text = format_world_frame_measurements(m)
    assert "Lens1 optical axis" in text
    assert "Ry (π)" in text
    assert "Expected seam longitude" in text
    assert "Actual overlap longitude" in text


def test_lonlat_grid_center_pixel():
    from app.services.orientation_verify import lonlat_to_pixel, render_equirect_latlon_grid

    w, h = 3601, 1801
    cx, cy = lonlat_to_pixel(0.0, 0.0, w, h)
    assert cx == (w - 1) // 2
    assert cy == (h - 1) // 2
    img = render_equirect_latlon_grid(np.zeros((h, w, 3), dtype=np.uint8))
    assert img.shape == (h, w, 3)


def test_world_vector_to_lonlat_matches_stitcher_mapping():
    lon = np.radians(45.0)
    lat = np.radians(30.0)
    x = float(np.cos(lat) * np.sin(lon))
    y = float(np.sin(lat))
    z = float(np.cos(lat) * np.cos(lon))
    lon_out, lat_out = world_vector_to_lonlat(x, y, z)
    assert lon_out == pytest.approx(45.0, abs=1e-5)
    assert lat_out == pytest.approx(30.0, abs=1e-5)
