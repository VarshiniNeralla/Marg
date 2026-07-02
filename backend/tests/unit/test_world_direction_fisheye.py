"""Tests for world-direction fisheye projection diagnostic."""
from __future__ import annotations

import pytest

from app.services.world_direction_fisheye import (
    format_world_direction_fisheye_report,
    project_world_axes_to_both_lenses,
    world_direction_to_fisheye_pixel,
)


def test_plus_z_at_lens_center_with_identity_rotation():
    hit = world_direction_to_fisheye_pixel(
        (0.0, 0.0, 1.0),
        cx=500.0,
        cy=500.0,
        radius=400.0,
        fov_deg=204.0,
        rot=(0.0, 0.0, 0.0),
        body_flip=False,
    )
    assert hit["valid"] is True
    assert hit["pixel_x"] == pytest.approx(500.0, abs=1.0)
    assert hit["pixel_y"] == pytest.approx(500.0, abs=1.0)
    assert hit["theta_deg"] == pytest.approx(0.0, abs=0.01)


def test_user_calibration_plus_z_near_lens1_center():
    meta = {
        "fisheye_fov_deg": 204.0,
        "layout": "top-bottom",
        "scale_x": 1.0,
        "scale_y": 1.0,
        "decoded_width": 3040,
        "decoded_height": 6080,
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
    data = project_world_axes_to_both_lenses(meta)
    pz = next(r for r in data["projections"] if r["direction"] == "+Z")
    mz = next(r for r in data["projections"] if r["direction"] == "-Z")
    l1cx, l1cy = data["lens1_params"]["cx"], data["lens1_params"]["cy"]
    l2cx, l2cy = data["lens2_params"]["cx"], data["lens2_params"]["cy"]
    assert pz["lens1"]["valid"] is True
    assert mz["lens2"]["valid"] is True
    assert pz["lens1"]["pixel_x"] == pytest.approx(l1cx, abs=25.0)
    assert pz["lens1"]["pixel_y"] == pytest.approx(l1cy, abs=25.0)
    assert mz["lens2"]["pixel_x"] == pytest.approx(l2cx, abs=25.0)
    assert mz["lens2"]["pixel_y"] == pytest.approx(l2cy, abs=25.0)
    text = format_world_direction_fisheye_report(data)
    assert "+Z" in text
    assert "lens1:" in text
