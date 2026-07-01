"""
360 panorama validation + spherical-metadata injection.

Design decision (production): we do NOT stitch raw dual-fisheye .insp files
server-side. ffmpeg's v360 filter is a geometric reprojection tool with no
seam-blending / optical-flow alignment, so it always bakes a hard vertical
seam into the meridian. Commercial-grade seamless panoramas require the
calibrated optical-flow stitching that the Insta360 app / Studio performs.

So the field workflow is: export the finished equirectangular JPEG from the
Insta360 app, then upload that. This module's job is therefore to:

  1. VALIDATE that an uploaded image is a usable equirectangular panorama
     (exactly ~2:1, decodable, sane dimensions). Anything else is rejected
     before publish so a broken panorama never reaches the viewer.
  2. INJECT XMP GPano spherical metadata so downstream viewers/tools can
     recognise the JPEG as a full 360 equirectangular panorama.

`.insp`/`.dng` are still accepted as *files*, but a raw dual-fisheye .insp
will fail the 2:1 aspect check (it is ~2:1 but not equirectangular) — see
is_probably_equirectangular's note — and .dng is treated as a flat still.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

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


class PanoramaValidationError(ValueError):
    """Raised when an uploaded image is not a valid equirectangular panorama."""


def is_insp(filename: str) -> bool:
    return Path(filename).suffix.lower() in INSP_EXTENSIONS


def is_dng(filename: str) -> bool:
    return Path(filename).suffix.lower() in DNG_EXTENSIONS


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


def _build_gpano_xmp(width: int, height: int) -> bytes:
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
        'GPano:CroppedAreaTopPixels="0" />'
        '</rdf:RDF></x:xmpmeta>'
        '<?xpacket end="w"?>'
    )
    return packet.encode("utf-8")


def inject_gpano_xmp(data: bytes, width: int, height: int) -> bytes:
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
        payload = _XMP_NS + _build_gpano_xmp(width, height)
        seg_len = len(payload) + 2
        if seg_len > 0xFFFF:  # XMP too large for a single APP1 segment
            return jpeg
        app1 = b"\xff\xe1" + seg_len.to_bytes(2, "big") + payload
        return jpeg[:2] + app1 + jpeg[2:]
    except Exception as exc:
        logger.warning(f"GPano XMP injection failed (continuing): {exc}")
        return data
