"""Unit tests for equirect → perspective reprojection (T1)."""
from __future__ import annotations

import numpy as np
import pytest

from app.services.panorama_views import (
    DEFAULT_RIG,
    VIEW_SIZE,
    ViewSpec,
    contact_sheet,
    equirect_to_perspective,
    render_rig,
)


def _synthetic_equirect(width: int = 2048, height: int = 1024) -> np.ndarray:
    """2:1 equirect with a vertical coloured band at longitude ≈ 0° (image centre)."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    # Dark grey base so blank-detection helpers aren't triggered later.
    img[:] = (40, 40, 40)
    # Bright green vertical band centred at lon=0 (x = width/2).
    band_w = max(8, width // 64)
    cx = width // 2
    img[:, cx - band_w : cx + band_w] = (0, 255, 0)
    # Red band at lon=+90° (x = 3/4 width) for wall_90 checks.
    rx = int(width * 0.75)
    img[:, rx - band_w : rx + band_w] = (0, 0, 255)
    # Blue stripe near the top (ceiling / +lat) and bottom (floor / -lat).
    img[: height // 16, :] = (255, 0, 0)           # BGR blue near north pole
    img[height - height // 16 :, :] = (0, 255, 255)  # yellow near south pole
    return img


def test_equirect_to_perspective_shape_and_dtype():
    eq = _synthetic_equirect()
    out = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=0.0, hfov_deg=90.0)
    assert out.shape == (VIEW_SIZE, VIEW_SIZE, 3)
    assert out.dtype == np.uint8


def test_wall_0_contains_green_band_at_lon_0():
    eq = _synthetic_equirect()
    wall0 = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=0.0, hfov_deg=90.0)
    # Centre of wall_0 should be looking at lon=0 → green band.
    cy, cx = VIEW_SIZE // 2, VIEW_SIZE // 2
    patch = wall0[cy - 20 : cy + 20, cx - 40 : cx + 40]
    assert patch[:, :, 1].mean() > 100, "expected green band in wall_0 centre"


def test_wall_90_contains_red_band_at_lon_90():
    eq = _synthetic_equirect()
    wall90 = equirect_to_perspective(eq, yaw_deg=90.0, pitch_deg=0.0, hfov_deg=90.0)
    cy, cx = VIEW_SIZE // 2, VIEW_SIZE // 2
    patch = wall90[cy - 20 : cy + 20, cx - 40 : cx + 40]
    # Red in BGR is channel 2
    assert patch[:, :, 2].mean() > 100, "expected red band in wall_90 centre"


def test_yaw_0_matches_yaw_360_seam_wrap():
    eq = _synthetic_equirect()
    a = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=0.0, hfov_deg=90.0)
    b = equirect_to_perspective(eq, yaw_deg=360.0, pitch_deg=0.0, hfov_deg=90.0)
    # Remap + float math can differ by a pixel; mean abs error should be tiny.
    mae = np.abs(a.astype(np.float32) - b.astype(np.float32)).mean()
    assert mae < 2.0, f"yaw 0 vs 360 MAE too high: {mae}"


def test_positive_pitch_shows_ceiling_blue():
    eq = _synthetic_equirect()
    ceiling = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=75.0, hfov_deg=100.0)
    # Looking up → more blue (north-pole stripe) than yellow.
    assert ceiling[:, :, 0].mean() > ceiling[:, :, 1].mean()


def test_negative_pitch_shows_floor_yellow():
    eq = _synthetic_equirect()
    floor = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=-75.0, hfov_deg=100.0)
    # Looking down → yellow stripe (B≈0,G≈255,R≈255) dominates over blue.
    assert floor[:, :, 1].mean() > floor[:, :, 0].mean()
    assert floor[:, :, 2].mean() > floor[:, :, 0].mean()


def test_render_rig_returns_all_default_views():
    eq = _synthetic_equirect()
    views = render_rig(eq)
    assert len(views) == len(DEFAULT_RIG)
    names = [spec.name for spec, _ in views]
    assert names == [s.name for s in DEFAULT_RIG]
    for _, img in views:
        assert img.shape == (VIEW_SIZE, VIEW_SIZE, 3)


def test_contact_sheet_layout():
    eq = _synthetic_equirect(width=1024, height=512)
    views = render_rig(eq)
    # Smaller tiles for a fast test.
    small = [
        (spec, equirect_to_perspective(
            eq, yaw_deg=spec.yaw_deg, pitch_deg=spec.pitch_deg, hfov_deg=spec.hfov_deg,
            out_w=128, out_h=128,
        ))
        for spec, _ in views
    ]
    sheet = contact_sheet(small, cols=3, tile=64)
    assert sheet.shape == (2 * 64, 3 * 64, 3)
    assert sheet.dtype == np.uint8
    assert sheet.sum() > 0


def test_vertical_lines_stay_vertical_in_wall_view():
    """A vertical coloured column in equirect stays roughly vertical in wall_0."""
    w, h = 2048, 1024
    eq = np.full((h, w, 3), 40, dtype=np.uint8)
    cx = w // 2
    eq[:, cx - 2 : cx + 2] = (0, 255, 0)
    wall = equirect_to_perspective(eq, yaw_deg=0.0, pitch_deg=0.0, hfov_deg=90.0, out_w=256, out_h=256)
    # For each row, find the greenest column; std of those x positions should be small.
    xs = []
    for y in range(40, 216):
        row = wall[y, :, 1].astype(np.float32)
        xs.append(int(np.argmax(row)))
    assert np.std(xs) < 8.0, f"vertical band drifted too much: std={np.std(xs)}"
