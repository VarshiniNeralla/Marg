"""The production stitch path (no debug artifacts) must give the SAME panorama and metadata as the full path."""
import os

import numpy as np
import pytest

import app.services.fisheye_stitch as mod


def _frame():
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, (512, 256, 3), dtype=np.uint8)


def _stitch(monkeypatch, **kw):
    calib = mod.DualFisheyeCalibration(
        lens1=mod.LensCalibration(128.0, 130.0, 120.0, (0.8, 0.1, -179.3)),
        lens2=mod.LensCalibration(128.0, 126.0, 120.0, (-0.9, -0.1, 0.0)),
        width=256, height=512, layout="top-bottom", source="embedded",
    )
    monkeypatch.setattr(mod, "parse_embedded_calibration", lambda data: calib)
    monkeypatch.setattr(mod, "_decode_raw_rgb", lambda data, fn: _frame())
    return mod._stitch_arrays(b"", "x.insp", out_w=128, out_h=64, **kw)


def test_production_path_matches_full_path_and_drops_only_debug_images(monkeypatch):
    full_blend, full = _stitch(monkeypatch)
    fast_blend, fast = _stitch(monkeypatch, build_debug_artifacts=False)

    assert np.array_equal(full_blend, fast_blend)
    assert fast.metadata == full.metadata                       # what gets stored with the capture
    assert np.array_equal(fast.blended, full.blended)
    assert full.sphere_lens1 is not None and full.top_fisheye_after_rotation is not None   # debug path unchanged
    for name in ("raw_decoded", "top_fisheye", "bottom_fisheye", "sphere_lens1", "sphere_lens2",
                 "sphere_lens1_grid", "blended_grid"):
        assert getattr(fast, name) is None


def test_public_stitch_skips_debug_artifacts_unless_a_debug_dir_is_given(monkeypatch, tmp_path):
    seen = []
    real = mod._stitch_arrays

    def spy(*a, **kw):
        seen.append(kw.get("build_debug_artifacts"))
        return real(*a, **kw)

    monkeypatch.setattr(mod, "_stitch_arrays", spy)
    calib = mod.DualFisheyeCalibration(
        lens1=mod.LensCalibration(128.0, 130.0, 120.0, (0.8, 0.1, -179.3)),
        lens2=mod.LensCalibration(128.0, 126.0, 120.0, (-0.9, -0.1, 0.0)),
        width=256, height=512, layout="top-bottom", source="embedded",
    )
    monkeypatch.setattr(mod, "parse_embedded_calibration", lambda data: calib)
    monkeypatch.setattr(mod, "_decode_raw_rgb", lambda data, fn: _frame())

    assert mod.stitch_equirectangular(b"", "x.insp", out_w=128, out_h=64) is not None
    assert seen == [False]


class TestRunConcurrently:
    def test_results_keep_task_order(self, monkeypatch):
        monkeypatch.setattr(os, "sched_getaffinity", lambda pid: set(range(8)), raising=False)
        assert mod._run_concurrently([lambda: "a", lambda: "b", lambda: "c"]) == ["a", "b", "c"]

    def test_single_cpu_runs_inline_in_order(self, monkeypatch):
        monkeypatch.setattr(os, "sched_getaffinity", lambda pid: {0, 1}, raising=False)
        order = []
        assert mod._run_concurrently([lambda: order.append(1) or 1, lambda: order.append(2) or 2]) == [1, 2]
        assert order == [1, 2]

    def test_exception_is_raised_like_a_plain_loop(self, monkeypatch):
        monkeypatch.setattr(os, "sched_getaffinity", lambda pid: set(range(8)), raising=False)

        def boom():
            raise RuntimeError("stitch strip failed")

        with pytest.raises(RuntimeError, match="stitch strip failed"):
            mod._run_concurrently([lambda: 1, boom])

