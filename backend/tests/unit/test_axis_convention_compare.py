"""Unit tests for axis_convention_compare enumeration and baseline parity."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

_BACKEND = Path(__file__).resolve().parents[2]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from tools.axis_convention_compare import (  # noqa: E402
    BASELINE_PERM,
    BASELINE_SIGNS,
    AxisConvention,
    enumerate_right_handed_conventions,
    hemisphere_map_axis_convention,
    world_vectors_from_lonlat,
)
from app.services.fisheye_stitch import _hemisphere_map  # noqa: E402


def test_right_handed_convention_count():
    convs = enumerate_right_handed_conventions()
    assert len(convs) == 24
    ids = {c.id for c in convs}
    assert len(ids) == 24


def test_baseline_in_enumeration():
    convs = enumerate_right_handed_conventions()
    baseline = AxisConvention(perm=BASELINE_PERM, signs=BASELINE_SIGNS)
    assert any(c.perm == baseline.perm and c.signs == baseline.signs for c in convs)
    assert baseline.is_baseline()


def test_baseline_world_vectors_match_production():
    conv = AxisConvention(perm=BASELINE_PERM, signs=BASELINE_SIGNS)
    lon = np.linspace(-np.pi, np.pi, 8)
    lat = np.linspace(np.pi / 2, -np.pi / 2, 4)
    lon_g, lat_g = np.meshgrid(lon, lat)
    X, Y, Z = world_vectors_from_lonlat(lon_g, lat_g, conv)
    assert np.allclose(X, np.cos(lat_g) * np.sin(lon_g))
    assert np.allclose(Y, np.sin(lat_g))
    assert np.allclose(Z, np.cos(lat_g) * np.cos(lon_g))


def test_baseline_hemisphere_map_matches_production():
    conv = AxisConvention(perm=BASELINE_PERM, signs=BASELINE_SIGNS)
    rot = (0.1, -0.2, 3.1)
    kwargs = dict(
        out_w=64, out_h=32, cx=100.0, cy=200.0, radius=150.0,
        fov_deg=204.0, yaw_offset=0.0, rot=rot, body_flip=False,
    )
    prod = _hemisphere_map(**kwargs)
    diag = hemisphere_map_axis_convention(**kwargs, conv=conv)
    for a, b in zip(prod, diag):
        assert np.allclose(a, b, equal_nan=True)
