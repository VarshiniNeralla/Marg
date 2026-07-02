"""
360 panorama validation + spherical-metadata injection.

Raw dual-fisheye camera files (.dng / .insp / .insv) are stitched server-side
into equirectangular panoramas (see fisheye_stitch.py + cloudinary_service.py).
This module validates dimensions and injects XMP GPano metadata for viewers.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

from loguru import logger

try:
    from PIL import Image
    _PIL_OK = True
except Exception:  # pragma: no cover - Pillow is a hard dep, but be safe
    _PIL_OK = False

# A true equirectangular panorama is 2:1. Allow a small tolerance for exports
# that round dimensions (e.g. 5760×2880 = 2.000, 6080×3040 = 2.000).
_MIN_RATIO = 1.9
_MAX_RATIO = 2.1
# Guard against absurd inputs.
_MIN_WIDTH = 1024

INSP_EXTENSIONS = {".insp"}
DNG_EXTENSIONS = {".dng"}
INSV_EXTENSIONS = {".insv"}
RAW_CAPTURE_EXTENSIONS = INSP_EXTENSIONS | DNG_EXTENSIONS | INSV_EXTENSIONS


class PanoramaValidationError(ValueError):
    """Raised when an uploaded image is not a valid equirectangular panorama."""


def is_insp(filename: str) -> bool:
    return Path(filename).suffix.lower() in INSP_EXTENSIONS


def is_dng(filename: str) -> bool:
    return Path(filename).suffix.lower() in DNG_EXTENSIONS


def is_insv(filename: str) -> bool:
    return Path(filename).suffix.lower() in INSV_EXTENSIONS


def is_raw_capture(filename: str) -> bool:
    """True for camera raw dual-fisheye files that require server-side stitching."""
    return Path(filename).suffix.lower() in RAW_CAPTURE_EXTENSIONS


def is_dual_fisheye_layout(width: int, height: int) -> bool:
    """
    Heuristic for unstitched Insta360 dual-fisheye frames (top-bottom or side-by-side).

    Equirectangular panoramas are ~2:1 (width > height). Raw dual-fisheye is often
  ~1:2 stacked (e.g. 3040×6080) or side-by-side with similar extreme aspect.
    """
    if width <= 0 or height <= 0:
        return False
    if is_equirectangular(width, height):
        return False
    ratio = width / height
    inv = height / width
    return (_MIN_RATIO <= ratio <= _MAX_RATIO) or (_MIN_RATIO <= inv <= _MAX_RATIO)


def validate_stitched_output(width: int, height: int, *, filename: str = "") -> None:
    """Raise PanoramaValidationError when stitch output is not a 2:1 equirectangular."""
    if is_dual_fisheye_layout(width, height):
        logger.error(
            f"Stitch output looks like raw dual-fisheye '{filename}': {width}x{height}"
        )
        raise PanoramaValidationError(
            "Stitching produced a raw dual-fisheye layout instead of an equirectangular panorama."
        )
    if not is_equirectangular(width, height):
        logger.error(
            f"Stitch output has invalid aspect '{filename}': {width}x{height} "
            f"(ratio {width / max(height, 1):.3f}, expected ~2.0)"
        )
        raise PanoramaValidationError(
            "Stitching did not produce a valid 2:1 equirectangular panorama."
        )


def classify_projection_bgr(img_bgr) -> Literal["flat", "dualfisheye", "equirectangular"]:
    """
    Backend analogue of the frontend projection classifier.

    Both raw dual-fisheye previews and true panoramas can be ~2:1, so we also
    inspect the four corners: dark corners imply dual-fisheye circles on a black
    canvas; filled corners imply a stitched equirectangular panorama.
    """
    import cv2
    import numpy as np

    if img_bgr is None or getattr(img_bgr, "shape", None) is None or len(img_bgr.shape) < 2:
        return "flat"
    h, w = img_bgr.shape[:2]
    if w <= 0 or h <= 0 or not is_equirectangular(w, h):
        return "flat"

    small = cv2.resize(img_bgr, (128, 64), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    patch = 12
    corners = [
        gray[0:patch, 0:patch],
        gray[0:patch, -patch:],
        gray[-patch:, 0:patch],
        gray[-patch:, -patch:],
    ]
    dark_corners = sum(float(np.mean(c)) < 18.0 for c in corners)
    return "dualfisheye" if dark_corners >= 3 else "equirectangular"


def measure_image(data: bytes) -> Optional[tuple[int, int]]:
    """Return (width, height) or None if the bytes aren't a decodable image."""
    if not _PIL_OK:
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            return img.width, img.height
    except Exception:
        return None


def is_equirectangular(width: int, height: int) -> bool:
    """True when the dimensions match a 2:1 equirectangular panorama."""
    if width < _MIN_WIDTH or height <= 0:
        return False
    ratio = width / height
    return _MIN_RATIO <= ratio <= _MAX_RATIO


def validate_panorama(data: bytes, *, filename: str) -> tuple[int, int]:
    """
    Validate that `data` is a usable equirectangular panorama.

    Returns (width, height) on success. Raises PanoramaValidationError with a
    user-facing message otherwise — the caller must NOT publish on failure.
    """
    dims = measure_image(data)
    if dims is None:
        raise PanoramaValidationError(
            "This panorama is invalid and could not be rendered."
        )
    width, height = dims
    if not is_equirectangular(width, height):
        logger.warning(
            f"Rejected non-equirectangular panorama '{filename}': {width}x{height} "
            f"(ratio {width / max(height, 1):.3f}, expected ~2.0)"
        )
        raise PanoramaValidationError(
            "This panorama is invalid and could not be rendered."
        )
    return width, height


# Standard XMP APP1 identifier per the XMP spec.
_XMP_NS = b"http://ns.adobe.com/xap/1.0/\x00"


@dataclass(frozen=True)
class GpanoPose:
    """Google Photo Sphere XMP pose + initial-view fields (degrees)."""
    pose_heading_degrees: float = 0.0
    pose_pitch_degrees: float = 0.0
    pose_roll_degrees: float = 0.0
    initial_view_heading_degrees: float = 0.0
    initial_view_pitch_degrees: float = 0.0
    initial_horizontal_fov_degrees: float = 72.0

    @classmethod
    def from_metadata(cls, data: Optional[dict]) -> "GpanoPose":
        if not data:
            return cls()
        return cls(
            pose_heading_degrees=float(data.get("poseHeadingDegrees", 0.0)),
            pose_pitch_degrees=float(data.get("posePitchDegrees", 0.0)),
            pose_roll_degrees=float(data.get("poseRollDegrees", 0.0)),
            initial_view_heading_degrees=float(data.get("initialViewHeadingDegrees", 0.0)),
            initial_view_pitch_degrees=float(data.get("initialViewPitchDegrees", 0.0)),
            initial_horizontal_fov_degrees=float(data.get("initialHorizontalFovDegrees", 72.0)),
        )


def _build_gpano_xmp(width: int, height: int, pose: Optional[GpanoPose] = None) -> bytes:
    p = pose or GpanoPose()
    packet = (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" '
        'xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" '
        'GPano:ProjectionType="equirectangular" '
        'GPano:UsePanoramaViewer="True" '
        f'GPano:FullPanoWidthPixels="{width}" '
        f'GPano:FullPanoHeightPixels="{height}" '
        f'GPano:CroppedAreaImageWidthPixels="{width}" '
        f'GPano:CroppedAreaImageHeightPixels="{height}" '
        'GPano:CroppedAreaLeftPixels="0" '
        'GPano:CroppedAreaTopPixels="0" '
        f'GPano:PoseHeadingDegrees="{p.pose_heading_degrees}" '
        f'GPano:PosePitchDegrees="{p.pose_pitch_degrees}" '
        f'GPano:PoseRollDegrees="{p.pose_roll_degrees}" '
        f'GPano:InitialViewHeadingDegrees="{p.initial_view_heading_degrees}" '
        f'GPano:InitialViewPitchDegrees="{p.initial_view_pitch_degrees}" '
        f'GPano:InitialHorizontalFOVDegrees="{p.initial_horizontal_fov_degrees}" />'
        '</rdf:RDF></x:xmpmeta>'
        '<?xpacket end="w"?>'
    )
    return packet.encode("utf-8")


def inject_gpano_xmp(
    data: bytes,
    width: int,
    height: int,
    pose: Optional[GpanoPose | dict] = None,
) -> bytes:
    """
    Inject XMP GPano spherical metadata so viewers recognise the JPEG as a full
    equirectangular 360 panorama.

    Pillow 10.x silently ignores the `xmp=` save kwarg for JPEG, so we write the
    APP1 XMP marker segment into the JPEG byte stream directly (right after SOI).
    Best-effort: returns the original bytes on any failure (the frontend also
    detects 360 by aspect ratio, so metadata is a belt-and-braces signal).
    """
    if not _PIL_OK:
        return data
    gpano_pose = pose if isinstance(pose, GpanoPose) else GpanoPose.from_metadata(pose)
    try:
        # Normalise to a clean baseline JPEG first (handles .png inputs too).
        with Image.open(io.BytesIO(data)) as img:
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=92)
            jpeg = buf.getvalue()

        # A JPEG starts with SOI (FF D8). Insert an APP1 (FF E1) XMP segment
        # immediately after it. Segment length is big-endian and includes the
        # 2 length bytes but not the FF E1 marker.
        if not jpeg.startswith(b"\xff\xd8"):
            return jpeg
        payload = _XMP_NS + _build_gpano_xmp(width, height, gpano_pose)
        seg_len = len(payload) + 2
        if seg_len > 0xFFFF:  # XMP too large for a single APP1 segment
            return jpeg
        app1 = b"\xff\xe1" + seg_len.to_bytes(2, "big") + payload
        return jpeg[:2] + app1 + jpeg[2:]
    except Exception as exc:
        logger.warning(f"GPano XMP injection failed (continuing): {exc}")
        return data
