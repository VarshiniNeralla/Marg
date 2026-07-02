"""Tests for hemisphere ownership diagnostics."""
from __future__ import annotations

import numpy as np
import pytest

from app.services.stitch_ownership import (
    ownership_summary,
    render_ownership_masks,
)


def test_ownership_summary_percentages():
    v1 = np.zeros((4, 8), dtype=bool)
    v2 = np.zeros((4, 8), dtype=bool)
    v1[:, :4] = True
    v2[:, 2:6] = True
    w1 = np.full((4, 8), 0.5, dtype=np.float32)

    s = ownership_summary(v1, v2, w1)
    assert s["total_pixels"] == 32
    assert s["lens1_exclusive"]["pixels"] == 8   # cols 0,1
    assert s["lens2_exclusive"]["pixels"] == 8   # cols 6,7
    assert s["overlap"]["pixels"] == 8           # cols 2,3
    assert s["overlap"]["percent"] == pytest.approx(25.0)


def test_render_ownership_masks_shapes():
    v1 = np.ones((16, 32), dtype=bool)
    v2 = np.zeros((16, 32), dtype=bool)
    v2[:, 16:] = True
    w1 = np.linspace(0, 1, 32, dtype=np.float32)[None, :].repeat(16, axis=0)
    imgs = render_ownership_masks(v1, v2, w1)
    assert set(imgs) == {
        "ownership_lens1.png",
        "ownership_lens2.png",
        "blend_weight_lens1.png",
        "ownership_composite.png",
    }
    for img in imgs.values():
        assert img.shape == (16, 32, 3)
