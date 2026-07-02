"""Tests for sphere-space orientation comparison."""
from __future__ import annotations

import numpy as np
import pytest

from app.services.stitch_compare import estimate_orientation_delta, _rotate_equirect, _latlon_grid, _vec_from_latlon


def _marker_equirect(h: int = 256, w: int = 512) -> np.ndarray:
    """Equirect with a single coloured marker for unambiguous yaw recovery."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[ h // 2, w // 4] = (0, 0, 255)   # blue dot at lon=-90°
    img[h // 2, w // 2] = (0, 255, 0)    # green at forward
    return img


def test_recovers_known_yaw():
    ref = _marker_equirect()
    lon, lat = _latlon_grid(ref.shape[0], ref.shape[1])
    vecs = _vec_from_latlon(lat, lon)
    known_yaw = 20.0
    test = _rotate_equirect(ref, -known_yaw, 0.0, 0.0, lon, lat, vecs)
    delta = estimate_orientation_delta(ref, test, coarse_yaw_step=5.0, fine_step=1.0)
    assert delta.yaw_deg == pytest.approx(known_yaw, abs=2.0)
    assert delta.pitch_deg == pytest.approx(0.0, abs=2.0)
    assert delta.roll_deg == pytest.approx(0.0, abs=2.0)
