"""Unit tests for GPano XMP injection and panorama validation."""
import pytest

from app.services.panorama_service import (
    GpanoPose,
    PanoramaValidationError,
    _build_gpano_xmp,
    classify_projection_bgr,
    is_dual_fisheye_layout,
    is_equirectangular,
    is_insp,
    is_raw_capture,
    validate_stitched_output,
)


def test_gpano_xmp_includes_pose_and_initial_view():
    xmp = _build_gpano_xmp(5760, 2880, GpanoPose(
        pose_heading_degrees=12.5,
        initial_view_heading_degrees=0.0,
        initial_horizontal_fov_degrees=72.0,
    )).decode("utf-8")
    assert 'GPano:PoseHeadingDegrees="12.5"' in xmp
    assert 'GPano:InitialViewHeadingDegrees="0.0"' in xmp
    assert 'GPano:InitialHorizontalFOVDegrees="72.0"' in xmp
    assert 'GPano:PosePitchDegrees="0.0"' in xmp
    assert 'GPano:PoseRollDegrees="0.0"' in xmp


def test_is_raw_capture_extensions():
    assert is_raw_capture("photo.dng")
    assert is_raw_capture("photo.insp")
    assert is_raw_capture("clip.insv")
    assert not is_raw_capture("photo.jpg")


def test_is_insp():
    assert is_insp("capture.insp")
    assert not is_insp("capture.dng")


def test_is_equirectangular():
    assert is_equirectangular(5760, 2880)
    assert not is_equirectangular(3040, 6080)


def test_is_dual_fisheye_layout_stacked():
    assert is_dual_fisheye_layout(3040, 6080)
    assert not is_dual_fisheye_layout(5760, 2880)


def test_validate_stitched_output_accepts_equirect():
    validate_stitched_output(5760, 2880, filename="ok.jpg")


def test_validate_stitched_output_rejects_dual_fisheye():
    with pytest.raises(PanoramaValidationError):
        validate_stitched_output(3040, 6080, filename="raw.insp")


def test_validate_stitched_output_rejects_bad_ratio():
    with pytest.raises(PanoramaValidationError):
        validate_stitched_output(4000, 3000, filename="flat.jpg")


def test_classify_projection_bgr_detects_equirectangular():
    import numpy as np

    img = np.full((640, 1280, 3), 180, dtype=np.uint8)
    assert classify_projection_bgr(img) == "equirectangular"


def test_classify_projection_bgr_detects_dual_fisheye():
    import numpy as np

    img = np.full((640, 1280, 3), 180, dtype=np.uint8)
    img[:120, :120] = 0
    img[:120, -120:] = 0
    img[-120:, :120] = 0
    img[-120:, -120:] = 0
    assert classify_projection_bgr(img) == "dualfisheye"
