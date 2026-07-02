"""Tests for ray pipeline trace diagnostic."""
from __future__ import annotations

import pytest

from app.services.orientation_verify import STITCHER_FORWARD, world_vector_to_lonlat as w2l
from app.services.ray_pipeline_trace import (
    build_ray_pipeline_trace,
    format_ray_pipeline_trace,
    lonlat_to_world_vector,
    trace_world_ray_for_lens,
)

_META = {
    "fisheye_fov_deg": 204.0,
    "layout": "top-bottom",
    "scale_x": 1.0,
    "scale_y": 1.0,
    "decoded_width": 3040,
    "decoded_height": 6080,
    "output_width": 5760,
    "output_height": 2880,
    "lens1": {
        "cx": 1480.16,
        "cy": 1524.46,
        "radius": 1513.26,
        "rot": [0.847, 0.044, -179.356],
    },
    "lens2": {
        "cx": 1480.61,
        "cy": 1514.34,
        "radius": 1513.26,
        "rot": [-0.936, -0.104, 0.012],
    },
}


def test_lonlat_world_round_trip():
    lon, lat = 0.0, 0.0
    xyz = lonlat_to_world_vector(lon, lat)
    assert xyz == pytest.approx((0.0, 0.0, 1.0), abs=1e-9)
    lon2, lat2 = w2l(*xyz)
    assert lon2 == pytest.approx(0.0, abs=1e-9)
    assert lat2 == pytest.approx(0.0, abs=1e-9)


def test_forward_plus_z_panorama_center():
    data = build_ray_pipeline_trace(_META, STITCHER_FORWARD)
    pan = data["lens1"]["step_8_panorama_pixel"]
    assert pan["x"] == pytest.approx(5760 // 2, abs=2)
    assert pan["y"] == pytest.approx(2880 // 2, abs=2)


def test_lens2_applies_ry_pi():
    t = trace_world_ray_for_lens(STITCHER_FORWARD, "lens2", _META, 5760, 2880, body_flip=True)
    assert t["step_3_after_Ry_pi"]["applied"] is True
    assert t["step_2_after_R_cal"]["vector_xyz"] != t["step_3_after_Ry_pi"]["vector_xyz"]


def test_boresight_low_theta_on_lens1():
    t = trace_world_ray_for_lens(STITCHER_FORWARD, "lens1", _META, 5760, 2880, body_flip=False)
    assert t["step_5_fisheye_angles"]["theta_deg"] < 5.0
    assert t["step_6_fisheye_pixel"]["valid_in_fov"] is True


def test_format_includes_all_steps():
    text = format_ray_pipeline_trace(build_ray_pipeline_trace(_META))
    for needle in (
        "World ray",
        "After R_cal",
        "After Ry",
        "Fisheye angles",
        "Fisheye pixel",
        "Panorama pixel",
        "LENS1",
        "LENS2",
    ):
        assert needle in text
