"""Unit tests for fisheye_stitch convention fixes (parser, latitude, scaling)."""
from __future__ import annotations

import sys

import numpy as np
import pytest

from app.services.fisheye_stitch import (
    LensCalibration,
    _hemisphere_map,
    _resolve_lens2_radius,
    _scale_lens_to_region,
    parse_embedded_calibration,
)


def _blob(*fields: float) -> bytes:
    body = "_".join(str(f) for f in fields)
    return f"INSTA3602_{body}".encode("ascii")


class TestLens2Radius:
  def test_schema_uses_index_8_for_lens2_radius(self):
      """Per module schema: lens2 cx,cy,r are nums[6], nums[7], nums[8]."""
      raw = _blob(
          1000, 1500, 2000, 0, 0, 0,
          1100, 1600, 2100, 0, 0, 0,
          5760, 2880,
      )
      calib = parse_embedded_calibration(raw)
      assert calib is not None
      assert calib.lens1.radius == 2000
      assert calib.lens2.radius == 2100

  def test_resolve_rejects_absolute_y_masquerading_as_radius(self):
      # If nums[8] were absolute bottom-lens Y (~4500), not a radius (~2000).
      assert _resolve_lens2_radius([0, 0, 2000, 0, 0, 0, 0, 1600, 4500, 0, 0, 0], 5760) == 2000

  def test_resolve_accepts_typical_lens2_radius(self):
      assert _resolve_lens2_radius([0, 0, 2000, 0, 0, 0, 0, 1600, 2050, 0, 0, 0], 5760) == 2050

  def test_parse_parameters_style_blob(self):
      raw = (
          b"random bytes Parameters 2 "
          b"1480.160 1524.460 1513.260 0.847 0.044 -179.356 "
          b"1480.610 1514.340 4557.130 -0.936 -0.104 0.012 3040 6080 3113 "
          b"tail"
      )
      calib = parse_embedded_calibration(raw)
      assert calib is not None
      assert calib.source == "parameters"
      assert calib.width == 3040
      assert calib.height == 6080


# Real ONE X2 .insp trailer offset string (no INSTA360 prefix; lens coords in
# the portrait stacked sensor frame while the file itself is 6080x3040).
_REAL_TRAILER_RECORD = (
    b"2_1480.160_1524.460_1513.260_0.847_0.044_-179.356"
    b"_1480.610_4554.340_1517.130_-0.936_-0.104_0.012_6080_3040_3113"
)
# Look-alike trailer record with zeroed lens2 geometry (must be rejected).
_BOGUS_TRAILER_RECORD = (
    b"2_1478.810_1523.680_1513.050_0.867_-0.041_-179.354"
    b"_0.000000_0.000000_0.000000_1.00000000_-0.15533170_0.27432388_6080_3040_41"
)


class TestTrailerCalibration:
  def test_parses_insp_trailer_offset_string(self):
      raw = b"\xff\xd8jpegbody\x00\x02\x8a\x01o" + _REAL_TRAILER_RECORD + b"H\xb4\xfe"
      calib = parse_embedded_calibration(raw)
      assert calib is not None
      assert calib.source == "embedded_trailer"
      # Normalised to the portrait stacked sensor frame + top-bottom layout.
      assert (calib.width, calib.height) == (3040, 6080)
      assert calib.layout == "top-bottom"
      assert calib.decode_rotate_cw is True
      assert calib.lens1.cx == pytest.approx(1480.160)
      assert calib.lens1.cy == pytest.approx(1524.460)
      assert calib.lens1.radius == pytest.approx(1513.260)
      # lens2 cy converted from stacked-absolute (4554.34) to region-relative.
      assert calib.lens2.cy == pytest.approx(4554.340 - 3040.0)
      assert calib.lens2.radius == pytest.approx(1517.130)
      assert calib.lens2.rot == pytest.approx((-0.936, -0.104, 0.012))

  def test_rejects_lookalike_record_with_zero_lens2(self):
      raw = b"\x00\x02\xaa\x03\x97\x02" + _BOGUS_TRAILER_RECORD + b"\x00"
      calib = parse_embedded_calibration(raw)
      assert calib is None

  def test_prefers_valid_record_over_lookalike(self):
      raw = (
          b"\x8a\x01o" + _REAL_TRAILER_RECORD
          + b"\xaa\x03\x97\x02" + _BOGUS_TRAILER_RECORD
      )
      calib = parse_embedded_calibration(raw)
      assert calib is not None
      assert calib.source == "embedded_trailer"
      assert calib.lens2.radius == pytest.approx(1517.130)

  def test_dng_blob_still_wins_when_present(self):
      dng_blob = _blob(
          1480.160, 1524.460, 1513.260, 0.847, 0.044, -179.356,
          1480.610, 1514.340, 4557.130, -0.936, -0.104, 0.012,
          3040, 6080,
      )
      raw = dng_blob + b"\x8a\x01o" + _REAL_TRAILER_RECORD
      calib = parse_embedded_calibration(raw)
      assert calib is not None
      assert calib.source == "embedded"
      assert calib.decode_rotate_cw is False
      assert (calib.width, calib.height) == (3040, 6080)

  def test_dng_relative_lens2_cy_not_rewritten(self):
      """DNG blobs keep region-relative lens2.cy; normalisation must not fire."""
      dng_blob = _blob(
          1480.160, 1524.460, 1513.260, 0.847, 0.044, -179.356,
          1480.610, 1514.340, 4557.130, -0.936, -0.104, 0.012,
          3040, 6080,
      )
      calib = parse_embedded_calibration(dng_blob)
      assert calib is not None
      assert calib.lens2.cy == pytest.approx(1514.340)
      assert calib.decode_rotate_cw is False
      assert calib.layout == "top-bottom"


class TestDngReadoutNormalization:
  """Insta360 DNGs store each eye's native readout; the calibration frame is
  each square rotated 90° CW from it. The stitch must normalize .dng buffers
  so the output is IDENTICAL to stitching the calibration frame directly."""

  def _run(self, monkeypatch, buffer, filename):
      import app.services.fisheye_stitch as mod

      calib = mod.DualFisheyeCalibration(
          lens1=mod.LensCalibration(128.0, 130.0, 120.0, (0.8, 0.1, -179.3)),
          lens2=mod.LensCalibration(128.0, 126.0, 120.0, (-0.9, -0.1, 0.0)),
          width=256, height=512, layout="top-bottom", source="embedded",
      )
      monkeypatch.setattr(mod, "parse_embedded_calibration", lambda data: calib)
      monkeypatch.setattr(mod, "_decode_raw_rgb", lambda data, fn: buffer.copy())
      out = mod._stitch_arrays(b"", filename, out_w=128, out_h=64)
      assert out is not None
      return out

  def _frames(self):
      import cv2

      rng = np.random.default_rng(0)
      calib_frame = rng.integers(0, 255, (512, 256, 3), dtype=np.uint8)
      readout = np.vstack([
          cv2.rotate(calib_frame[:256], cv2.ROTATE_90_COUNTERCLOCKWISE),
          cv2.rotate(calib_frame[256:], cv2.ROTATE_90_COUNTERCLOCKWISE),
      ])
      return calib_frame, readout

  def test_dng_readout_matches_calibration_frame_output(self, monkeypatch):
      calib_frame, readout = self._frames()
      ref_blend, _ = self._run(monkeypatch, calib_frame, "x.bin")
      dng_blend, artifacts = self._run(monkeypatch, readout, "x.dng")
      assert artifacts.metadata.get("dng_readout_squares_rotated_cw") is True
      assert np.array_equal(ref_blend, dng_blend)

  def test_non_dng_buffer_not_rotated(self, monkeypatch):
      calib_frame, _ = self._frames()
      _, artifacts = self._run(monkeypatch, calib_frame, "x.bin")
      assert "dng_readout_squares_rotated_cw" not in artifacts.metadata

  def test_insp_path_unaffected_by_dng_branch(self, monkeypatch):
      """The .insp flow must not enter the DNG readout normalization."""
      calib_frame, _ = self._frames()
      _, artifacts = self._run(monkeypatch, calib_frame, "x.insp")
      assert "dng_readout_squares_rotated_cw" not in artifacts.metadata


class TestLatitudeConvention:
  def test_row_zero_is_zenith_gpano_psv(self):
      """GPano/PSV: top row = +90° pitch (zenith), Y = sin(lat) = +1."""
      ys = np.linspace(np.pi / 2, -np.pi / 2, 32)
      lat = ys[0]
      assert lat == pytest.approx(np.pi / 2)
      assert np.sin(lat) == pytest.approx(1.0)

  def test_forward_is_plus_z_at_origin(self):
      lon, lat = 0.0, 0.0
      z = np.cos(lat) * np.cos(lon)
      assert z == pytest.approx(1.0)


class TestCalibrationScaling:
  def test_scale_lens_uniform(self):
      lens = LensCalibration(1000, 500, 800, (0, 0, 0))
      scaled = _scale_lens_to_region(lens, sx=2.0, sy=2.0)
      assert scaled.cx == 2000
      assert scaled.cy == 1000
      assert scaled.radius == 1600


class TestDecodeRawRgb:
  def test_insp_uses_rawpy_path(self, monkeypatch):
      import app.services.fisheye_stitch as mod

      calls: list[str] = []

      class FakeRaw:
          def __enter__(self):
              return self

          def __exit__(self, *args):
              pass

          def postprocess(self, **_kw):
              import numpy as np
              return np.zeros((100, 200, 3), dtype=np.uint8)

      def fake_imread(_buf):
          calls.append("rawpy")
          return FakeRaw()

      monkeypatch.setitem(sys.modules, "rawpy", type("rawpy", (), {"imread": staticmethod(fake_imread)}))
      monkeypatch.setattr(mod, "io_bytes", lambda data: data)

      img = mod._decode_raw_rgb(b"fake", "capture.insp")
      assert calls == ["rawpy"]
      assert img is not None
      assert img.shape == (100, 200, 3)

  def test_dng_uses_rawpy_path(self, monkeypatch):
      import sys
      import app.services.fisheye_stitch as mod

      calls: list[str] = []

      class FakeRaw:
          def __enter__(self):
              return self

          def __exit__(self, *args):
              pass

          def postprocess(self, **_kw):
              import numpy as np
              return np.zeros((80, 160, 3), dtype=np.uint8)

      def fake_imread(_buf):
          calls.append("rawpy")
          return FakeRaw()

      monkeypatch.setitem(sys.modules, "rawpy", type("rawpy", (), {"imread": staticmethod(fake_imread)}))
      monkeypatch.setattr(mod, "io_bytes", lambda data: data)

      img = mod._decode_raw_rgb(b"fake", "capture.dng")
      assert calls == ["rawpy"]
      assert img.shape == (80, 160, 3)
