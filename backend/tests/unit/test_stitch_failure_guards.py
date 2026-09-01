"""Unit tests for stitch blank/coverage gates and failure artifacts."""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.services.panorama_service import (
    MIN_SPHERE_COVERAGE,
    panorama_content_is_blank,
    save_stitch_failure_artifact,
    sphere_coverage_is_low,
    stitched_output_is_unusable,
    validate_stitched_content,
    PanoramaValidationError,
)


def _solid_jpeg(color: tuple[int, int, int], size=(256, 128)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_blank_mid_grey_detected():
    data = _solid_jpeg((128, 128, 128))
    assert panorama_content_is_blank(data) is True


def test_normal_scene_not_blank():
    # Varied content — not solid grey.
    img = Image.new("RGB", (256, 128))
    pixels = img.load()
    for y in range(128):
        for x in range(256):
            pixels[x, y] = ((x * 3) % 256, (y * 5) % 256, (x + y) % 256)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    assert panorama_content_is_blank(buf.getvalue()) is False


def test_sphere_coverage_gate():
    assert sphere_coverage_is_low(0.5) is True
    assert sphere_coverage_is_low(MIN_SPHERE_COVERAGE) is False
    assert sphere_coverage_is_low(0.99) is False
    assert sphere_coverage_is_low(None) is False


def test_stitched_output_is_unusable_reasons():
    grey = _solid_jpeg((128, 128, 128))
    bad, reason = stitched_output_is_unusable(grey, sphere_coverage=0.99)
    assert bad and reason == "blank_or_near_blank"

    colorful = _solid_jpeg((40, 180, 90))
    # Solid color still fails blank via low stdev — use varied image.
    img = Image.new("RGB", (256, 128))
    px = img.load()
    for y in range(128):
        for x in range(256):
            px[x, y] = (x % 255, 80, y % 255)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    data = buf.getvalue()
    bad2, reason2 = stitched_output_is_unusable(data, sphere_coverage=0.5)
    assert bad2 and reason2.startswith("low_sphere_coverage")


def test_save_stitch_failure_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()
    jpeg = _solid_jpeg((128, 128, 128))
    path = save_stitch_failure_artifact(
        jpeg=jpeg,
        filename="IMG_test.insp",
        reason="blank_or_near_blank",
        metadata={"sphere_coverage": 0.4},
    )
    assert path is not None
    assert path.exists()
    assert path.suffix == ".jpg"
    meta = path.with_suffix(".json")
    assert meta.exists()
    get_settings.cache_clear()


def test_validate_stitched_content_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(PanoramaValidationError):
        validate_stitched_content(
            _solid_jpeg((128, 128, 128)),
            filename="bad.insp",
            sphere_coverage=0.99,
        )
    get_settings.cache_clear()
