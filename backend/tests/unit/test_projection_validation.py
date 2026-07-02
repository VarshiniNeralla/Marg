"""Tests for fisheye projection validation diagnostic."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.services.projection_validation import (
    DEFAULT_SAMPLE_COUNT,
    build_lens_projection_validation,
    project_world_rays,
    sample_world_rays_uniform_fov,
    theta_deg_to_bgr,
)


_META = {
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


def test_theta_colormap_endpoints():
    assert theta_deg_to_bgr(0.0, 102.0) == (255, 0, 0)
    assert theta_deg_to_bgr(102.0, 102.0) == (0, 0, 255)


def test_sample_count_and_all_valid_in_fov():
    fov = 204.0
    rot = (0.0, 0.0, 0.0)
    world = sample_world_rays_uniform_fov(DEFAULT_SAMPLE_COUNT, fov, rot)
    assert world.shape == (DEFAULT_SAMPLE_COUNT, 3)
    samples = project_world_rays(world, 500.0, 500.0, 400.0, fov, rot)
    assert len(samples) == DEFAULT_SAMPLE_COUNT
    assert all(s["valid"] for s in samples)
    assert all(s["theta_deg"] <= fov / 2.0 + 1e-6 for s in samples)


def test_boresight_at_center_with_identity_rotation():
    world = np.array([[0.0, 0.0, 1.0]])
    samples = project_world_rays(world, 500.0, 500.0, 400.0, 204.0, (0.0, 0.0, 0.0))
    s = samples[0]
    assert s["theta_deg"] == pytest.approx(0.0, abs=0.01)
    assert s["pixel_u"] == pytest.approx(500.0, abs=0.1)
    assert s["pixel_v"] == pytest.approx(500.0, abs=0.1)
    assert s["radius_px"] == pytest.approx(0.0, abs=0.1)


def test_equidistant_radius_at_fov_edge():
    fov = 204.0
    radius = 400.0
    half = fov / 2.0
    world = np.array([[
        math.sin(math.radians(half)),
        0.0,
        math.cos(math.radians(half)),
    ]])
    samples = project_world_rays(world, 0.0, 0.0, radius, fov, (0.0, 0.0, 0.0))
    s = samples[0]
    assert s["theta_deg"] == pytest.approx(half, abs=0.01)
    assert s["radius_px"] == pytest.approx(radius, abs=0.5)


def test_build_lens_projection_validation_renders():
    import cv2

    blank = np.zeros((3040, 3040, 3), dtype=np.uint8)
    report, img = build_lens_projection_validation(_META, "lens1", blank)
    assert report["sample_count"] == DEFAULT_SAMPLE_COUNT
    assert img is not None
    assert img.shape == blank.shape
    assert int(img.sum()) > 0
