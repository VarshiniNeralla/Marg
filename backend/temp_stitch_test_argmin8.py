"""
Calibrated dual-fisheye → equirectangular stitching for Insta360 raw files.

Why this exists (design rationale)
-----------------------------------
Generic reprojectors (ffmpeg `v360`, PSV `DualFisheyeAdapter`) use a FIXED lens
model with no per-camera calibration input, so they render Insta360 frames
misaligned (wrong FOV / lens-centre / rotation) — verified on real files. But an
Insta360 media file EMBEDS its own lens calibration as an ASCII blob, e.g.:

    INSTA360 2_ cx cy r  ra rb rc   cx cy r  ra rb rc   W H extra
             └── lens 1 ──────────┘ └── lens 2 ──────────┘

We parse that blob, map each fisheye circle to a hemisphere with the equidistant
model (r = R·θ/(FOV/2)) via cv2.remap, apply the per-lens rotation, and blend
with exposure compensation + a distance-transform feather.

Honest limit: the ONE stage we can't reproduce is Insta360 Studio's per-frame
OPTICAL-FLOW seam warp, which locally aligns near-camera objects across the ~2cm
lens parallax. A static geometric remap can't align objects at different depths
simultaneously, so a soft seam remains on close objects. Distant geometry aligns
well. This yields a genuine navigable 360 — not pixel-identical to Studio.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Log hemisphere remap stats for the first stitch frame only (lens1 + lens2).
_hemisphere_map_log_count = 0
_HEMISPHERE_MAP_LOG_LIMIT = 2

from loguru import logger

# Heavy deps (opencv, numpy) are imported lazily inside functions so the module
# imports cleanly even in environments where they aren't installed (tests, etc).


# ── Camera profiles (req: configurable per model, no hardcoded pixels) ────────
@dataclass(frozen=True)
class CameraProfile:
    """Per-model defaults. The embedded calibration overrides these when present."""
    model: str
    fisheye_fov_deg: float          # per-lens coverage angle
    # Fallback fractional geometry if no embedded calibration and detection fails.
    # (Values are fractions of the per-lens square region, not absolute pixels.)
    default_center_frac: tuple[float, float] = (0.5, 0.5)
    default_radius_frac: float = 0.5


# FOV values are the practical stitching angles (empirically better than the
# marketing "200°"). ONE X2: measured by per-capture rim auto-calibration on
# 11 real captures from two units — estimates cluster at 205.1–207.1°, so the
# old "documented sweet spot" of 204° left a systematic 20–200 px seam offset
# on every capture. _autocal_fov fine-tunes ±1.5° around these per capture.
_PROFILES: dict[str, CameraProfile] = {
    "ONE X2": CameraProfile("ONE X2", 206.3),
    "X3": CameraProfile("X3", 204.0),
    "X4": CameraProfile("X4", 205.0),
    "X5": CameraProfile("X5", 205.0),
}
_DEFAULT_PROFILE = CameraProfile("generic", 205.5)


def profile_for(model: Optional[str]) -> CameraProfile:
    if not model:
        return _DEFAULT_PROFILE
    for key, prof in _PROFILES.items():
        if key in model:
            return prof
    return _DEFAULT_PROFILE


# ── Embedded calibration parsing ──────────────────────────────────────────────
@dataclass
class LensCalibration:
    cx: float
    cy: float          # centre y RELATIVE to the lens's own region
    radius: float
    rot: tuple[float, float, float]  # yaw, pitch, roll degrees


@dataclass
class DualFisheyeCalibration:
    lens1: LensCalibration
    lens2: LensCalibration
    width: int
    height: int
    layout: str = "top-bottom"       # or "side-by-side"
    source: str = "embedded"         # "embedded" | "embedded_trailer" | "detected" | "profile"
    raw: str = ""
    # True when the file stores the frame rotated 90° CCW relative to the
    # calibrated portrait sensor frame (Insta360 .insp JPEGs: 6080x3040 file,
    # 3040x6080 sensor coords). The decoder must rotate the image 90° CW back.
    decode_rotate_cw: bool = False


# The blob: "INSTA360" + "<n>_" + numeric fields separated by "_".
_INSTA_RE = re.compile(rb"INSTA360(\d+)_([0-9_.\-]+)")
_PARAMETERS_RE = re.compile(
    rb"Parameters[^0-9\-]*((?:[0-9.\-]+\s+){13,}[0-9.\-]+)",
    re.IGNORECASE,
)
# Insta360 .insp/.insv trailer "offset" string: the SAME 15-field schema as the
# DNG blob but WITHOUT the "INSTA360" ASCII prefix (it lives inside a protobuf
# record of the trailer), e.g.:
#   2_1480.160_1524.460_1513.260_0.847_0.044_-179.356_1480.610_4554.340_
#   1517.130_-0.936_-0.104_0.012_6080_3040_3113
# Structure: <lens count>_ then 12 floats (cx cy r ra rb rc per lens) then
# W_H_extra as integers. The trailer also holds richer records that happen to
# start the same way but carry zeroed lens2 fields — candidates are validated
# in parse_embedded_calibration before acceptance.
_TRAILER_OFFSET_RE = re.compile(
    rb"(?<![0-9._\-])(\d)_((?:-?\d+\.\d+_){12}\d+_\d+_\d+)(?![0-9.])"
)
# Only scan the tail of the file for trailer records (they sit at the very end).
_TRAILER_SCAN_BYTES = 128 * 1024
# Minimum plausible sensor dimension for a trailer calibration record.
_MIN_CALIB_DIM = 1024


def _resolve_lens2_radius(nums: list[float], full_height: int) -> float:
    """Return lens-2 radius from calibration field nums[8].

    The blob schema (see module header) is two 6-tuples per lens:
        cx, cy, r, ra, rb, rc
    so lens-2 radius is nums[8], not nums[2].  Older code reused nums[2],
    which only works when both fisheye circles share the same radius.

    On some files nums[8] can look like an absolute Y coordinate in the full
    frame (often > half the image height).  That value is not a plausible
    radius when lens-1 radius is ~O(1000–2500 px), so we fall back to nums[2].
    """
    r1 = nums[2]
    r2 = nums[8]
    if r2 <= 0:
        logger.warning("Lens2 radius nums[8]=%s invalid; using lens1 radius %s", r2, r1)
        return r1
    if full_height > 0 and r2 > full_height * 0.5 and r2 > r1 * 1.5:
        logger.warning(
            "nums[8]=%s looks like absolute Y (full H=%s), not radius; using shared r=%s",
            r2, full_height, r1,
        )
        return r1
    return r2


def _scale_lens_to_region(lens: LensCalibration, sx: float, sy: float) -> LensCalibration:
    """Scale embedded lens geometry from calibration resolution to decoded crop size."""
    sr = (sx + sy) / 2.0
    return LensCalibration(
        lens.cx * sx,
        lens.cy * sy,
        lens.radius * sr,
        lens.rot,
    )


def _calibration_from_numbers(
    nums: list[float],
    *,
    source: str,
    raw_text: str,
) -> Optional[DualFisheyeCalibration]:
    """Build calibration from the canonical 14+ numeric fields."""
    if len(nums) >= 15 and int(nums[0]) in {1, 2, 3}:
        # Some INSP `Parameters` records prefix the payload with a small format/version id.
        nums = nums[1:]
    if len(nums) < 14:
        logger.warning(f"INSTA360 calibration blob too short ({len(nums)} fields)")
        return None

    width = int(nums[12])
    height = int(nums[13])
    r2 = _resolve_lens2_radius(nums, height)
    l1 = LensCalibration(nums[0], nums[1], nums[2], (nums[3], nums[4], nums[5]))
    l2 = LensCalibration(nums[6], nums[7], r2, (nums[9], nums[10], nums[11]))
    layout = "top-bottom" if height > width else "side-by-side"
    decode_rotate_cw = False

    # Insta360 .insp: the blob dims describe the LANDSCAPE file (e.g. 6080x3040)
    # but the lens coordinates live in the PORTRAIT stacked sensor frame
    # (3040x6080) — betrayed by lens2.cy exceeding the file height (4554 > 3040).
    # Verified on real X2 files: the JPEG is the sensor frame rotated 90° CCW
    # (right fisheye's vignette is clipped at the bottom edge with a ~40px gap
    # at the top, matching the calibrated centres only under that rotation).
    # Normalise to the stacked frame: swap dims, make lens2.cy region-relative,
    # and flag that the decoded image must be rotated 90° CW before stitching.
    if width > height > 0 and l2.cy > height:
        width, height = height, width
        l2 = LensCalibration(l2.cx, l2.cy - height / 2.0, l2.radius, l2.rot)
        layout = "top-bottom"
        decode_rotate_cw = True
        logger.info(
            f"[calibration] stacked-frame coords detected: normalized to "
            f"{width}x{height} top-bottom, lens2.cy_rel={l2.cy:.2f}, "
            f"decode_rotate_cw=True"
        )

    return DualFisheyeCalibration(
        lens1=l1,
        lens2=l2,
        width=width,
        height=height,
        layout=layout,
        source=source,
        raw=raw_text,
        decode_rotate_cw=decode_rotate_cw,
    )


def _gpano_pose_from_stitch() -> dict[str, float]:
    """Pose / initial-view defaults for a level GPano equirectangular export.

    The stitch places lens-1 forward at the image centre (longitude 0) with the
    horizon on the equator row (latitude 0) once the GPano latitude convention
    is applied.  Without external compass/GPS data the panorama pose is identity.
    """
    return {
        "poseHeadingDegrees": 0.0,
        "posePitchDegrees": 0.0,
        "poseRollDegrees": 0.0,
        "initialViewHeadingDegrees": 0.0,
        "initialViewPitchDegrees": 0.0,
        # Matches PSV defaultZoomLvl=30 with minFov=30, maxFov=90 → 72°.
        "initialHorizontalFovDegrees": 72.0,
    }


def _try_pose_heading_from_exif(data: bytes) -> Optional[float]:
    """Return GPS image direction (degrees) when present in the raw file."""
    try:
        import exifread
        tags = exifread.process_file(io_bytes(data), details=False)
        tag = tags.get("GPS GPSImgDirection")
        if tag is None:
            return None
        val = tag.values[0]
        return float(val.num) / float(val.den) if hasattr(val, "num") else float(val)
    except Exception:
        return None


def parse_embedded_calibration(data: bytes) -> Optional[DualFisheyeCalibration]:
    """Find and parse the INSTA360 calibration blob in the raw file bytes."""
    logger.info("[calibration] search_start strategies=embedded_blob,parameters_blob,exif_parameters")

    m = _INSTA_RE.search(data)
    if m:
        logger.info(f"[calibration] embedded_blob found bytes={len(m.group(0))}")
        try:
            nums = [float(x) for x in m.group(2).split(b"_") if x not in (b"", b".")]
        except ValueError:
            nums = []
            logger.warning("[calibration] embedded_blob parse failed: non-numeric fields")
        calib = _calibration_from_numbers(
            nums,
            source="embedded",
            raw_text=m.group(0).decode("ascii", "replace"),
        )
        if calib is not None:
            logger.info(
                f"[calibration] accepted source={calib.source} "
                f"layout={calib.layout} dims={calib.width}x{calib.height}"
            )
            return calib
        logger.warning("[calibration] embedded_blob rejected")
    else:
        logger.info("[calibration] embedded_blob not found")

    # .insp/.insv trailer offset string (same schema, no "INSTA360" prefix).
    tail = data[-_TRAILER_SCAN_BYTES:]
    trailer_candidates = list(_TRAILER_OFFSET_RE.finditer(tail))
    if trailer_candidates:
        logger.info(f"[calibration] trailer_offset candidates={len(trailer_candidates)}")
        for tm in trailer_candidates:
            try:
                nums = [float(x) for x in tm.group(2).split(b"_") if x not in (b"", b".")]
            except ValueError:
                continue
            # Reject look-alike trailer records BEFORE building: they carry
            # zeroed lens2 fields, which _resolve_lens2_radius would otherwise
            # silently paper over with lens1's radius.
            if len(nums) < 14 or not (
                all(100.0 < nums[i] < 8000.0 for i in (0, 1, 2, 6, 8))
                and nums[12] >= _MIN_CALIB_DIM
                and nums[13] >= _MIN_CALIB_DIM
            ):
                logger.info("[calibration] trailer_offset candidate rejected (implausible geometry)")
                continue
            calib = _calibration_from_numbers(
                nums,
                source="embedded_trailer",
                raw_text=tm.group(0).decode("ascii", "replace"),
            )
            if calib is None:
                continue
            logger.info(
                f"[calibration] accepted source={calib.source} "
                f"layout={calib.layout} dims={calib.width}x{calib.height} "
                f"decode_rotate_cw={calib.decode_rotate_cw}"
            )
            return calib
        logger.warning("[calibration] trailer_offset all candidates rejected")
    else:
        logger.info("[calibration] trailer_offset not found")

    pm = _PARAMETERS_RE.search(data)
    if pm:
        logger.info(f"[calibration] parameters_blob found bytes={len(pm.group(0))}")
        try:
            nums = [float(x) for x in pm.group(1).split()]
        except ValueError:
            nums = []
            logger.warning("[calibration] parameters_blob parse failed: non-numeric fields")
        calib = _calibration_from_numbers(
            nums,
            source="parameters",
            raw_text=pm.group(0).decode("ascii", "replace"),
        )
        if calib is not None:
            logger.info(
                f"[calibration] accepted source={calib.source} "
                f"layout={calib.layout} dims={calib.width}x{calib.height}"
            )
            return calib
        logger.warning("[calibration] parameters_blob rejected")
    else:
        logger.info("[calibration] parameters_blob not found")

    try:
        import exifread

        tags = exifread.process_file(io_bytes(data), details=False)
        seen_parameters = False
        for key, tag in tags.items():
            if "Parameters" not in key:
                continue
            seen_parameters = True
            text = str(tag)
            logger.info(f"[calibration] exif_parameters found key={key}")
            try:
                nums = [float(x) for x in text.replace(",", " ").split()]
            except ValueError:
                logger.warning(f"[calibration] exif_parameters parse failed key={key}")
                continue
            calib = _calibration_from_numbers(nums, source="exif_parameters", raw_text=text)
            if calib is not None:
                logger.info(
                    f"[calibration] accepted source={calib.source} "
                    f"layout={calib.layout} dims={calib.width}x{calib.height}"
                )
                return calib
            logger.warning(f"[calibration] exif_parameters rejected key={key}")
        if not seen_parameters:
            logger.info("[calibration] exif_parameters not found")
    except Exception:
        logger.warning("[calibration] exif_parameters scan failed")

    logger.warning("[calibration] no_usable_source")
    return None


def detect_model(data: bytes) -> Optional[str]:
    """Best-effort camera model from the file's ASCII strings (e.g. 'ONE X2')."""
    for pat in (rb"Insta360 ONE X2", rb"Insta360 X3", rb"Insta360 X4",
                rb"Insta360 X5", rb"ONE X2", rb"X3", rb"X4", rb"X5"):
        if pat in data:
            return pat.decode("ascii", "replace").replace("Insta360 ", "")
    return None


# ── Decode + stitch ───────────────────────────────────────────────────────────
def _decode_raw_rgb(data: bytes, filename: str):
    """Decode a raw DNG/INSP (or JPEG) to an 8-bit BGR numpy array (OpenCV order).

    DNG and INSP → rawpy (proper demosaic + white balance). Others → OpenCV imdecode.
    Insta360 .insp files are DNG-based containers with embedded calibration.
    """
    import numpy as np
    import cv2

    lower = filename.lower()
    if lower.endswith((".dng", ".insp")):
        try:
            import rawpy
            logger.info(f"Decoding {filename} with rawpy ({len(data)} bytes)")
            with rawpy.imread(io_bytes(data)) as raw:
                rgb = raw.postprocess(use_camera_wb=True, output_bps=8, no_auto_bright=False)
            img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            h, w = img.shape[:2]
            logger.info(f"rawpy decode OK for {filename}: {w}x{h}")
            return img
        except Exception as exc:
            logger.warning(f"rawpy decode failed for {filename} ({exc!r}); falling back to imdecode")

    logger.info(f"Decoding {filename} with cv2.imdecode ({len(data)} bytes)")
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is not None:
        h, w = img.shape[:2]
        logger.info(f"imdecode OK for {filename}: {w}x{h}")
    else:
        logger.error(f"imdecode failed for {filename}")
    return img


def io_bytes(data: bytes):
    import io as _io
    return _io.BytesIO(data)


def _rot_matrix(a: float, b: float, c: float):
    import numpy as np

    a, b, c = np.radians(a), np.radians(b), np.radians(c)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    Rz = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    return Rz @ Rx @ Ry


def _ry_pi_matrix():
    """Ry(π): bottom fisheye body-frame flip (same Ry axis as ``_rot_matrix`` ra)."""
    return _rot_matrix(180.0, 0.0, 0.0)


def _lens_rot_matrix(rot: tuple[float, float, float], *, body_flip: bool = False):
    """Effective world→lens rotation. Lens2 applies calibration R then Ry(π)."""
    R = _rot_matrix(*rot)
    if body_flip:
        R = R @ _ry_pi_matrix()
    return R


def _log_hemisphere_map_stats(
    *,
    lens_label: str,
    yaw_offset: float,
    rot: tuple[float, float, float],
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    src_h: int | None,
    src_w: int | None,
    theta,
    phi,
    mapx,
    mapy,
    valid,
) -> None:
    import numpy as np

    n = int(valid.size)
    inside_fov = int(valid.sum())
    pct_inside_fov = 100.0 * inside_fov / n if n else 0.0
    theta_deg = np.degrees(theta)
    phi_deg = np.degrees(phi)
    msg = (
        f"hemisphere_map stats ({lens_label}): yaw_offset={yaw_offset:.4f} rot={rot} "
        f"cx={cx:.1f} cy={cy:.1f} r={radius:.1f} fov={fov_deg:.1f}° src={src_w}x{src_h}\n"
        f"  rays inside fisheye cone (theta <= fov/2): {pct_inside_fov:.1f}% ({inside_fov} / {n})\n"
        f"  theta_deg: min={float(theta_deg.min()):.2f} max={float(theta_deg.max()):.2f} "
        f"(fov/2={fov_deg / 2.0:.2f})\n"
        f"  phi_deg: min={float(phi_deg.min()):.2f} max={float(phi_deg.max()):.2f}"
    )

    if src_h is not None and src_w is not None and src_h > 0 and src_w > 0:
        in_bounds = (
            (mapx >= 0) & (mapx < src_w) & (mapy >= 0) & (mapy < src_h)
        )
        sample_ok = valid & in_bounds
        pct_uv_all = 100.0 * int(in_bounds.sum()) / n
        pct_uv_fov = 100.0 * int((valid & in_bounds).sum()) / inside_fov if inside_fov else 0.0
        pct_sampled = 100.0 * int(sample_ok.sum()) / n
        msg += (
            f"\n  UV in source bounds [0,{src_w})×[0,{src_h}): "
            f"{pct_uv_all:.1f}% all rays, {pct_uv_fov:.1f}% of in-fov rays"
            f"\n  sampleable (in-fov AND in-bounds): {pct_sampled:.1f}%"
        )
        if pct_sampled < 90.0:
            if pct_inside_fov < 90.0:
                msg += (
                    f"\n  DIAG: only {pct_inside_fov:.1f}% inside fisheye cone — "
                    "rotation may point the lens away from most equirect rays, "
                    "or yaw_offset/hemisphere assignment may be wrong."
                )
            elif pct_uv_fov < 90.0:
                msg += (
                    f"\n  DIAG: {pct_inside_fov:.1f}% in cone but only {pct_uv_fov:.1f}% "
                    "of those land in-bounds — (cx,cy,radius) or theta/phi→UV mapping "
                    "likely wrong for this source size."
                )
            else:
                msg += (
                    f"\n  DIAG: cone and UV look OK individually but only "
                    f"{pct_sampled:.1f}% sampleable — check valid mask usage in remap."
                )
    else:
        msg += "\n  UV / sample stats: skipped (src_w/src_h not provided)"

    logger.info(msg)


def _hemisphere_map(
    out_w,
    out_h,
    cx,
    cy,
    radius,
    fov_deg,
    yaw_offset,
    rot,
    *,
    src_h: int | None = None,
    src_w: int | None = None,
    lens_label: str = "",
    body_flip: bool = False,
):
    import numpy as np

    global _hemisphere_map_log_count

    fov = np.radians(fov_deg)
    xs = np.linspace(-np.pi, np.pi, out_w)
    # GPano / PSV / Street View: row 0 = +90° (zenith), row H-1 = -90° (nadir).
    ys = np.linspace(np.pi / 2, -np.pi / 2, out_h)
    lon, lat = np.meshgrid(xs, ys)
    lon = lon + yaw_offset
    # Heading convention (mirror fix): GPano/PSV display heading increasing
    # CLOCKWISE viewed from above — turning right in the viewer moves toward
    # image-right. With Y up and Z forward, the direction seen when turning
    # right by +lon is (-sin(lon), 0, cos(lon)): scene-right is the NEGATIVE X
    # axis of this right-handed frame. The previous X = +sin(lon) made
    # displayed longitude increase counter-clockwise (toward the camera's
    # left), which rendered every panorama as a left-right mirror of the real
    # scene — verified by ray trace: pano lon=+2° sampled fisheye x < cx,
    # i.e. scene-LEFT content for a rightward view (camera images are not
    # mirrored: scene-right sits at image x > cx).
    X = -np.cos(lat) * np.sin(lon)
    Y = np.sin(lat)
    Z = np.cos(lat) * np.cos(lon)
    R = _lens_rot_matrix(rot, body_flip=body_flip)
    vec = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=0)
    vr = R @ vec
    Xr, Yr, Zr = (vr[i].reshape(X.shape) for i in range(3))
    theta = np.arccos(np.clip(Zr, -1, 1))
    phi = np.arctan2(Yr, Xr)
    r = radius * (theta / (fov / 2.0))
    mapx = (cx + r * np.cos(phi)).astype(np.float32)
    mapy = (cy + r * np.sin(phi)).astype(np.float32)
    valid = theta <= (fov / 2.0)

    if _hemisphere_map_log_count < _HEMISPHERE_MAP_LOG_LIMIT:
        _log_hemisphere_map_stats(
            lens_label=lens_label or f"lens{_hemisphere_map_log_count + 1}",
            yaw_offset=float(yaw_offset),
            rot=tuple(rot),
            cx=float(cx),
            cy=float(cy),
            radius=float(radius),
            fov_deg=float(fov_deg),
            src_h=src_h,
            src_w=src_w,
            theta=theta,
            phi=phi,
            mapx=mapx,
            mapy=mapy,
            valid=valid,
        )
        _hemisphere_map_log_count += 1

    return mapx, mapy, valid


def _estimate_clean_theta(front, back, overlap, theta1_deg, theta2_deg, fov_deg):
    """Largest lens angle (degrees) still at >=90% relative illumination.

    The outer few degrees of each fisheye are strongly vignetted (measured
    ~-65% luminance at theta=102° on real X2 files). This measures each lens's
    rim illumination from the OVERLAP: at an output pixel where lens k sits at
    angle theta, the mirror lens sits at ~180°-theta (unvignetted when
    theta > 96°), so the luminance ratio isolates lens k's falloff. The
    per-lens exposure factor is cancelled using the symmetric theta≈90° ring,
    where both lenses are equally vignetted.

    Returns fov/2 (i.e. no behaviour change) when the signal is unmeasurable.
    The result is clamped to [92°, fov/2]; since theta1 + theta2 ≈ 180°, any
    pixel with theta_k > 92° has the mirror lens below 90°, so restricting the
    feather to theta <= clean angle can never leave a pixel uncovered.
    """
    import cv2
    import numpy as np

    half = fov_deg / 2.0
    lf = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY).astype(np.float32) + 1e-3
    lb = cv2.cvtColor(back, cv2.COLOR_BGR2GRAY).astype(np.float32) + 1e-3
    ok = overlap & (lf > 8) & (lb > 8)
    ring = ok & (np.abs(theta1_deg - 90.0) <= 2.0) & (np.abs(theta2_deg - 90.0) <= 2.0)
    if ring.sum() < 500:
        return half
    k = float(np.median(lf[ring] / lb[ring]))
    if not np.isfinite(k) or k <= 0:
        return half

    theta_clean = half
    lo = 91.0
    while lo < half:
        hi = lo + 1.0
        rel_illum = []
        b1 = ok & (theta1_deg >= lo) & (theta1_deg < hi)
        if b1.sum() >= 200:
            rel_illum.append(float(np.median(lf[b1] / lb[b1])) / k)
        b2 = ok & (theta2_deg >= lo) & (theta2_deg < hi)
        if b2.sum() >= 200:
            rel_illum.append(float(np.median(lb[b2] / lf[b2])) * k)
        if rel_illum and min(rel_illum) < 0.9:
            theta_clean = lo
            break
        lo = hi
    return float(max(92.0, min(theta_clean, half)))


def _correct_rim_illumination(front, back, overlap, theta1_deg, theta2_deg, fov_deg):
    """Measure and correct each lens's rim vignetting from the overlap.

    The outer degrees of the fisheye collapse to ~35% illumination; cutting
    them off (theta_clean) protected the blend but AMPUTATED the front lens
    exactly where it matters most: a doorway at a seam longitude is seen wide
    open by the near lens and mostly occluded by the far one — Insta360
    Studio renders the near lens's view (door open); we rendered the far
    lens's (door half-hidden) because the near lens's rim was declared
    unusable. Same principle as _estimate_clean_theta: at theta_k > 91° the
    mirror lens sits below 89° (flat plateau), so the overlap luminance
    ratio, exposure-normalized on the symmetric 90° ring, IS lens k's
    relative illumination. Fit a per-degree gain curve, clamp to 3.5x, and
    multiply it back — after this the clean-theta estimator naturally
    extends the usable zone and the seam corridor widens to the true mutual
    field of view.

    Returns (front, back) — corrected copies, or the originals when the
    signal is unmeasurable.
    """
    import cv2
    import numpy as np

    half = fov_deg / 2.0
    lf = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY).astype(np.float32) + 1e-3
    lb = cv2.cvtColor(back, cv2.COLOR_BGR2GRAY).astype(np.float32) + 1e-3
    ok = overlap & (lf > 8) & (lb > 8) & (lf < 250) & (lb < 250)
    ring = ok & (np.abs(theta1_deg - 90.0) <= 2.0) & (np.abs(theta2_deg - 90.0) <= 2.0)
    if ring.sum() < 500:
        return front, back
    k = float(np.median(lf[ring] / lb[ring]))
    if not np.isfinite(k) or k <= 0:
        return front, back

    step = 0.5
    bins = np.arange(91.0, half + step, step)

    def _gain_curve(theta_deg, lum_self, lum_other, norm):
        gains, centers = [], []
        for lo in bins:
            b = ok & (theta_deg >= lo) & (theta_deg < lo + step)
            if b.sum() >= 200:
                rel = float(np.median(lum_self[b] / lum_other[b])) / norm
                if np.isfinite(rel) and rel > 0.05:
                    gains.append(np.clip(1.0 / rel, 1.0, 3.5))
                    centers.append(lo + step / 2.0)
        if len(gains) < 3:
            return None
        g = np.array(gains, np.float32)
        # enforce monotone non-decreasing with angle (vignetting only grows)
        g = np.maximum.accumulate(g)
        # light smoothing
        if len(g) >= 3:
            g = np.convolve(np.pad(g, 1, mode='edge'), [0.25, 0.5, 0.25], 'valid')
        return np.array(centers, np.float32), g.astype(np.float32)

    c1 = _gain_curve(theta1_deg, lf, lb, k)
    c2 = _gain_curve(theta2_deg, lb, lf, 1.0 / k)
    if c1 is None and c2 is None:
        return front, back

    def _apply(img, theta_deg, curve):
        if curve is None:
            return img
        centers, g = curve
        gain = np.interp(theta_deg.ravel(), centers, g,
                         left=1.0, right=float(g[-1])).reshape(theta_deg.shape)
        out = img.astype(np.float32) * gain[..., None]
        return np.clip(out, 0, 255).astype(np.uint8)

    return _apply(front, theta1_deg, c1), _apply(back, theta2_deg, c2)


def _make_dis_flow():
    """DIS optical flow tuned for the seam strips.

    Farneback's smooth quadratic expansion cannot represent the discontinuous
    disparity at depth edges (measured: post-align edge mismatch p90 was within
    1-3% of pre-align on real captures — the warp did nothing exactly where the
    ghosts are). DIS is patch-based with variational refinement: it follows
    thin structures (window/door frames, railings, stair nosings) and preserves
    the disparity discontinuity at depth boundaries instead of smearing it.
    """
    import cv2

    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    dis.setUseSpatialPropagation(True)
    dis.setFinestScale(1)              # track structure down to 1/2 resolution
    dis.setPatchSize(8)
    dis.setPatchStride(3)
    dis.setGradientDescentIterations(16)
    dis.setVariationalRefinementIterations(5)
    return dis


def _strip_flow_with_confidence(a, b, max_flow: float, fb_tau: float):
    """Dense flow a→b plus forward/backward-consistency confidence in [0,1]."""
    import cv2
    import numpy as np

    # DIS asserts contiguity; corridor column slices are strided views.
    a = np.ascontiguousarray(a)
    b = np.ascontiguousarray(b)
    dis = _make_dis_flow()
    fwd = dis.calc(a, b, None)
    bwd = dis.calc(b, a, None)
    fx = np.clip(fwd[..., 0], -max_flow, max_flow)
    fy = np.clip(fwd[..., 1], -max_flow, max_flow)
    h, w = a.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    bx = cv2.remap(bwd[..., 0], gx + fx, gy + fy,
                   cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    by = cv2.remap(bwd[..., 1], gx + fx, gy + fy,
                   cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    fb_err = np.hypot(fx + bx, fy + by)
    conf = np.exp(-((fb_err / fb_tau) ** 2)).astype(np.float32)
    return fx, fy, conf, fb_err


def _directional_measurability(a, tau: float = 2500.0, sigma: float = 8.0):
    """Per-axis flow measurability from the local structure tensor.

    Forward/backward consistency CANNOT detect the aperture problem: a thin
    horizontal scaffold pipe against blown-out sky matches itself under ANY
    shift along its own axis, so DIS confidently reports zero horizontal flow
    while the true seam parallax (which at seam longitudes is exactly
    horizontal) is 20-40px — the pipe visibly snaps at every seam crossing.
    The structure tensor exposes this: flow along x is only measurable where
    the image varies along x (Jxx), and likewise for y. Returns (apx, apy) in
    [0,1]; isotropic texture and corners → 1 for both, a 1-D horizontal edge →
    apx≈0 (its ends/joints recover, becoming the anchors that the completion
    diffusion propagates from). tau keeps FLAT regions neutral (≈1) — their
    zero flow is fb-consistent and harmless, and penalising them would
    needlessly re-route walls through diffusion.
    """
    import cv2
    import numpy as np

    g = a.astype(np.float32)
    ix = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    iy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(ix * ix, (0, 0), sigma)
    jyy = cv2.GaussianBlur(iy * iy, (0, 0), sigma)
    den = jxx + jyy + 2.0 * tau
    apx = np.clip(2.0 * (jxx + tau) / den, 0.0, 1.0).astype(np.float32)
    apy = np.clip(2.0 * (jyy + tau) / den, 0.0, 1.0).astype(np.float32)
    return apx, apy


def _complete_unreliable_flow(fx, fy, conf, conf_x=None, conf_y=None):
    """Replace low-confidence flow with flow diffused from reliable neighbours.

    The previous strategy ATTENUATED unreliable flow toward zero, betting the
    seam optimizer could route around the untouched (still misaligned) pixels.
    Measured on real captures that bet loses: 45-68% of rows carried a visible
    residual through the whole mixing band because misaligned structure spanned
    the entire corridor (stair flights, window frames) and no clean path
    existed. Occluded/ambiguous pixels belong to SOME surface whose motion the
    reliable neighbourhood does measure, so normalized-convolution diffusion
    (finest support first, widening until every pixel has support) is the
    principled fill — the warp then moves whole structures coherently instead
    of leaving half-aligned double edges. Confidence only chooses between the
    measured and diffused vectors; it no longer silently disables alignment.
    """
    import cv2
    import numpy as np

    cx = conf if conf_x is None else conf_x
    cy = conf if conf_y is None else conf_y
    out = []
    for f, c in ((fx, cx), (fy, cy)):
        w = c * c  # emphasise trustworthy support
        dif = np.zeros_like(f)
        filled = np.zeros(f.shape, bool)
        for sigma in (12.0, 32.0, 80.0):
            nf = cv2.GaussianBlur(f * w, (0, 0), sigma)
            d = cv2.GaussianBlur(w, (0, 0), sigma)
            ok = (~filled) & (d > 0.05)
            dif[ok] = nf[ok] / d[ok]
            filled |= ok
        if not filled.all():
            tot = max(float(w.sum()), 1e-6)
            dif[~filled] = float((f * w).sum()) / tot
        # Smooth the mixing weight so the raw↔diffused transition cannot
        # itself introduce a warp discontinuity — but never let the blur
        # REDUCE trust in a thin confident structure: a beam edge measured
        # fb-consistently at conf≈1 in a ~30px-tall band was diluted to ~40%
        # of its true displacement because the blurred weight straddled the
        # zero-confidence surroundings (half the −18px vertical offset
        # vanished before regularization ever saw it).
        cs = np.maximum(c, cv2.GaussianBlur(c, (0, 0), 8.0))
        out.append(cs * f + (1.0 - cs) * dif)
    return out[0], out[1]


def _lowpass_field(field, sigma: float):
    """Large-sigma Gaussian low-pass via pyramid (direct kernels are huge)."""
    import cv2

    h, w = field.shape[:2]
    scale = max(1, int(sigma / 8.0))
    small = cv2.resize(field, (max(1, w // scale), max(1, h // scale)),
                       interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigma / scale)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def _weighted_guided_filter(p, guide, w, radius: int = 41, eps: float = 100.0):
    """Confidence-weighted guided filter (He et al. with sample weights).

    Filters `p` into a piecewise-smooth field whose discontinuities follow the
    GUIDE image's edges — the local linear model q = a·I + b means a straight
    beam (uniform intensity along its length) receives one coherent value
    while a genuine depth edge (intensity edge between lintel and room behind)
    stays sharp. `w` down-weights unreliable samples (occlusion boundaries,
    aperture-ambiguous flow) so their oscillation cannot bend the result;
    they inherit the model fitted to trustworthy neighbours instead.
    """
    import cv2
    import numpy as np

    k = 2 * radius + 1

    def box(x):
        return cv2.boxFilter(x, -1, (k, k), normalize=True)

    wb = box(w) + 1e-6
    m_i = box(guide * w) / wb
    m_p = box(p * w) / wb
    m_ii = box(guide * guide * w) / wb
    m_ip = box(guide * p * w) / wb
    var_i = np.maximum(m_ii - m_i * m_i, 0.0)
    cov_ip = m_ip - m_i * m_p
    a = cov_ip / (var_i + eps)
    b = m_p - a * m_i
    return box(a) * guide + box(b)


def _regularize_strip_flow(fx, fy, guide_gray, x0, out_w, out_h, conf=None,
                           conf_par=None):
    """Suppress physically implausible / image-unsupported flow components.

    The dual-fisheye baseline is (anti)parallel to the lens-1 forward axis, so
    in equirect coordinates the epipolar direction at pixel (lon, lat) is
    ∝ (−sin(lon)/cos(lat), sin(lat)·cos(lon)) — at the seam longitudes
    (lon = ±90°) it is exactly HORIZONTAL at every latitude. True parallax can
    therefore only displace content along that direction; the perpendicular
    flow component is measurement error plus (smooth) residual rotation
    calibration. Keeping only its low-frequency part straightens architecture
    that spurious flow would otherwise bend (measured: a doorway header dipped
    ~40 px where DIS chased flare from a bright opening).

    The parallax-parallel component keeps its high-frequency detail only where
    the image has gradient to support it: on textureless walls DIS flow is
    aperture-ambiguous, and its high-frequency component rubber-sheets faint
    edges (wall corners) without any alignment benefit.
    """
    import cv2
    import numpy as np

    h, w = fx.shape
    lon = (-np.pi + 2.0 * np.pi * (np.arange(x0, x0 + w, dtype=np.float32) + 0.5) / out_w)
    lat = (np.pi / 2 - np.pi * (np.arange(out_h, dtype=np.float32) + 0.5) / out_h)
    lon = np.tile(lon[None, :], (h, 1))
    lat = np.tile(lat[:, None], (1, w))
    ux = -np.sin(lon) / np.maximum(np.cos(lat), 0.05)
    uy = np.sin(lat) * np.cos(lon)
    norm = np.hypot(ux, uy) + 1e-6
    ux /= norm
    uy /= norm

    par = fx * ux + fy * uy
    perp_x = fx - par * ux
    perp_y = fy - par * uy

    grad = cv2.Sobel(guide_gray, cv2.CV_32F, 1, 0, ksize=3) ** 2
    grad += cv2.Sobel(guide_gray, cv2.CV_32F, 0, 1, ksize=3) ** 2
    grad = np.sqrt(grad)
    gate = np.clip((grad - 6.0) / 12.0, 0.0, 1.0).astype(np.float32)
    # Regional support, not per-stroke islands: sparse features (a wall
    # scribble, a faint corner) must warp coherently with their whole
    # neighbourhood — a gate that flips inside/outside each stroke shreds
    # them. Wide dilation + heavy smoothing makes the gate vary slower than
    # the flow's low-pass scale, so it selects REGIONS with alignable
    # structure rather than individual edges.
    gate = cv2.dilate(gate, np.ones((25, 25), np.uint8))
    gate = cv2.GaussianBlur(gate, (0, 0), 16.0)

    # Perpendicular flow: the epipolar model says only smooth residual
    # rotation-calibration error lives here, but real captures violate it —
    # a stair flight measured a CONFIDENT (fb-consistent, strongly textured)
    # −17px vertical disparity while the wall beside it measured 0
    # (rolling-shutter / inter-lens timing under camera motion behaves like
    # depth-dependent vertical parallax). Crushing that to a σ400 low-pass
    # left ~13px of vertical misregistration = staggered stair nosings.
    # Keep the smooth field as the backbone, but let locally-supported
    # (regional texture × squared confidence) deviations through, clamped to
    # ±20px so a flare-chase (low confidence, was a ~40px doorway-header dip)
    # can never bend architecture again.
    pw = gate if conf is None else gate * conf * conf
    pw_lp = _lowpass_field(pw, 400.0)
    eps = 0.02
    dc_x = (_lowpass_field(perp_x * pw, 400.0) + eps * _lowpass_field(perp_x, 400.0)) / (pw_lp + eps)
    dc_y = (_lowpass_field(perp_y * pw, 400.0) + eps * _lowpass_field(perp_y, 400.0)) / (pw_lp + eps)
    if conf is not None:
        # max() with the blur: a thin confident band (a beam edge a few tens
        # of px tall surrounded by blown-out zero-confidence sky) must keep
        # its own full confidence — the plain blur averaged it toward zero
        # and gated off a correctly-measured −18px vertical deviation.
        conf_s = np.maximum(conf, cv2.GaussianBlur(conf, (0, 0), 16.0))
        gate_perp = gate * conf_s * conf_s
    else:
        gate_perp = gate * 0.0
    perp_x = dc_x + np.clip(perp_x - dc_x, -20.0, 20.0) * gate_perp
    perp_y = dc_y + np.clip(perp_y - dc_y, -20.0, 20.0) * gate_perp

    # Parallel flow IS disparity (inverse depth along the epipolar direction).
    # Regularize it as depth: a confidence-weighted GUIDED filter makes it
    # piecewise-smooth with discontinuities aligned to image edges. This
    # replaces the low-pass+texture-gate blend, whose passed-through
    # high-frequency flow oscillated along aperture-ambiguous depth edges
    # (a doorway lintel's bottom edge waved by ~10-15px; the guided model
    # assigns the whole beam one coherent disparity because its intensity is
    # uniform along its length, while the lintel/room intensity edge keeps
    # the true depth discontinuity sharp).
    wpar = gate if conf_par is None else np.maximum(conf_par, 0.01)
    par = _weighted_guided_filter(
        par, guide_gray.astype(np.float32), wpar.astype(np.float32)
    )

    # No-evidence shrink: in regions with neither measured confidence nor any
    # image structure (blown-out doorway interiors, flare-washed walls) the
    # completed/filtered disparity is pure extrapolation. Warping featureless
    # content is invisible EXCEPT at its boundaries — a wall corner visible
    # only to one lens (the other lens's view flare-washed to uniform white)
    # was displaced ~35px by disparity diffused from unrelated content. With
    # no evidence the safest disparity is zero: the boundary then renders at
    # the owning lens's true position. Structures keep their flow: any texture
    # or confidence within ~2·σ keeps par intact (gate is already regionally
    # dilated; conf enters through its thin-band-preserving smooth).
    if conf is not None:
        # Texture is NOT evidence — only measured confidence is. A window
        # full of distant towers is richly textured yet an evidence desert
        # (DIS fails wholesale, conf≈0 for hundreds of px); its "completed"
        # disparity is diffused from unrelated near-field anchors (frame,
        # poles) whose values disagree, and letting texture vouch for that
        # invention liquified the facade. Even a density-of-measurements
        # gate failed: a few fb-lucky garbage speckles inside the desert
        # vouched for the whole window. Structures that need par to bridge
        # measurement gaps (pipe spans between confident joints) survive on
        # conf_s's thin-band smooth plus the σ24 reach below.
        ev = cv2.GaussianBlur(conf_s, (0, 0), 24.0)
        ev = np.clip(ev * 1.5, 0.0, 1.0)
        par = par * ev

    return par * ux + perp_x, par * uy + perp_y


def _autocal_fov(top, bot, l1, l2, fov, *, cal_w=1920, cal_h=960):
    """Per-capture fisheye-FOV self-calibration from seam-rim disparity.

    The embedded calibration provides (cx, cy, radius, rotation) but NOT the
    lens FOV — that comes from a per-model profile GUESS. A wrong FOV shifts
    every feature radially by ~θ·ΔFOV/FOV, which at the seams is a constant
    horizontal offset between the hemispheres affecting ALL depths (measured
    ~50 px at 5760 wide on real captures — even distant walls, which true
    parallax cannot displace). That systematic offset sat at the edge of what
    optical flow could absorb and polluted every downstream stage.

    Measure the dominant horizontal shift between the two rim renders with
    phase correlation (several windows per seam, median), at two FOV
    candidates; the shift is locally linear in FOV, so solve for the zero
    crossing and verify. Near-content parallax biases each measurement but
    not the root: parallax is depth-signed one way only, while the FOV term
    crosses zero.
    """
    import cv2
    import numpy as np

    def band_cost(F):
        """Robust overlap mismatch (median |Δgray| over the rim band) at FOV F."""
        m1x, m1y, v1 = _hemisphere_map(
            cal_w, cal_h, l1.cx, l1.cy, l1.radius, F, 0.0, l1.rot
        )
        m2x, m2y, v2 = _hemisphere_map(
            cal_w, cal_h, l2.cx, l2.cy, l2.radius, F, 0.0, l2.rot, body_flip=True
        )
        gf = cv2.cvtColor(
            cv2.remap(top, m1x, m1y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT),
            cv2.COLOR_BGR2GRAY,
        ).astype(np.float32)
        gb = cv2.cvtColor(
            cv2.remap(bot, m2x, m2y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT),
            cv2.COLOR_BGR2GRAY,
        ).astype(np.float32)
        band = v1 & v2 & (gf > 25) & (gb > 25)
        band[: int(0.15 * cal_h)] = False
        band[int(0.85 * cal_h):] = False
        if band.sum() < 5000:
            return None
        # Alignment error is only measurable at structure: flat wall pixels
        # differ by noise/exposure regardless of FOV (a plain median is
        # integer-flat across candidates). Score the gradient-weighted
        # mismatch after cancelling the global exposure offset.
        gb = gb * (float(gf[band].mean()) / max(float(gb[band].mean()), 1e-3))
        grad = np.abs(cv2.Sobel(gf, cv2.CV_32F, 1, 0, ksize=3)) \
            + np.abs(cv2.Sobel(gf, cv2.CV_32F, 0, 1, ksize=3))
        w = np.where(band, np.minimum(grad, 200.0), 0.0)
        ws = float(w.sum())
        if ws < 1e3:
            return None
        return float((np.abs(gf - gb) * w).sum() / ws)

    # FOV is a property of the CAMERA; the per-model profile carries the
    # measured value (X2: 206.3°, from 11 captures across two units). This
    # scan only FINE-TUNES ±1.5° around it per capture — wide solves from
    # per-capture measurements are unreliable because near content at the
    # seams (a railing at arm's length) dominates any shift/mismatch metric
    # (observed: an unconstrained solve hit its +6° clamp and staggered every
    # stair edge). If the cost curve is too flat to trust, the profile value
    # itself is already correct.
    deltas = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5]
    costs = [band_cost(fov + d) for d in deltas]
    if any(c is None for c in costs):
        logger.warning("[autocal] band too small; keeping profile fov")
        return fov, {"fov_delta_deg": 0.0, "rejected": "band_too_small"}
    i = int(np.argmin(costs))
    c_ref = costs[deltas.index(0.0)]
    if c_ref <= 0 or (c_ref - costs[i]) / c_ref < 0.02:
        logger.info(
            f"[autocal] no significant gain over profile ({c_ref:.2f} -> {costs[i]:.2f}); keeping fov={fov}"
        )
        return fov, {"fov_delta_deg": 0.0, "band_cost_at_profile": c_ref}
    # Parabolic refinement between grid neighbours (interior minima only).
    f_star = fov + deltas[i]
    if 0 < i < len(deltas) - 1:
        c0, c1, c2 = costs[i - 1], costs[i], costs[i + 1]
        denom = c0 - 2 * c1 + c2
        if denom > 1e-6:
            f_star += 0.5 * (deltas[i + 1] - deltas[i]) * (c0 - c2) / denom * 0.5
    logger.info(
        f"[autocal] fov {fov:.2f} -> {f_star:.2f} "
        f"(band mismatch {c_ref:.2f} -> {costs[i]:.2f} @ {cal_w}w)"
    )
    return float(f_star), {
        "fov_delta_deg": float(f_star - fov),
        "band_cost_at_profile": c_ref,
        "band_cost_at_best": costs[i],
    }


def _measure_seam_global_dy(lf, lb, ov, xc, out_h, win: int = 96):
    """Robust global vertical offset (back relative to front) at one seam.

    Multi-window phase correlation down the seam column, restricted to the
    true overlap: immune to the aperture problem (windows need 2-D texture to
    pass the std gate) and to DIS/fb-consistency failures in blown-out scenes
    — a handful of good windows anywhere along the seam is enough. Returns
    (median_dy, n_windows); (0, n) when fewer than 4 windows qualify.
    """
    import cv2
    import numpy as np

    han = cv2.createHanningWindow((win, win), cv2.CV_32F)
    vals = []
    for yc in range(int(0.12 * out_h), int(0.88 * out_h), 64):
        for xoff in (-40, 0, 40):
            y0, y1 = yc - win // 2, yc + win // 2
            x0, x1 = xc + xoff - win // 2, xc + xoff + win // 2
            if ov[y0:y1, x0:x1].mean() < 0.9:
                continue
            a = lf[y0:y1, x0:x1].astype(np.float32)
            b = lb[y0:y1, x0:x1].astype(np.float32)
            if a.std() < 4.0 or b.std() < 4.0:
                continue
            (dx, dy), resp = cv2.phaseCorrelate(a * han, b * han)
            if resp > 0.30 and abs(dy) < 40.0 and abs(dx) < 80.0:
                vals.append(dy)
    if len(vals) < 4:
        return 0.0, len(vals)
    return float(np.clip(np.median(vals), -30.0, 30.0)), len(vals)


def _parallax_align_hemispheres(front, back, w1, out_w, out_h, clean1=None, clean2=None,
                                theta1_deg=None, theta2_deg=None):
    """Locally align the hemispheres across the seam corridors (parallax).

    The ~2-3 cm lens baseline displaces near content by 30-80 px between the
    hemispheres. Seam routing removes ghosts where a low-parallax path exists,
    but a misaligned structure spanning the whole corridor (stair flights,
    railings, door frames) must be crossed, and its two offset copies cannot
    be composited into one. The standard solution (optical-flow seam, as in
    commercial stitchers) is to MEASURE the dense disparity front->back in the
    two seam strips and warp each hemisphere partially onto the other:

        front'(x) = front(x + (w1-1) * flow)      back'(x) = back(x + w1 * flow)

    At w1=1 the front is untouched (its exclusive zone keeps true geometry),
    at w1=0 the back is untouched, and at the seam (w1=0.5) both meet halfway —
    so along the entire corridor both images share one continuous intermediate
    geometry and the mismatch collapses. Flow is DIS (patch-based + variational
    refinement) on luminance, computed only in the two corridor strips, tapered
    to zero at strip borders, and clamped; far/aligned content measures ~zero
    flow and is unchanged.

    Reliability handling (measured on real captures): at occlusion boundaries
    and repeated texture the forward/backward flows disagree (fb-error 3-32+ px
    vs ~1 px elsewhere) — the measured vector there is untrustworthy. Those
    pixels are not left unwarped (that provably kept the double edges: post-
    align edge mismatch was within 1-3% of pre-align, and 45-68% of rows had a
    visible residual inside the seam mixing band); instead their flow is
    COMPLETED by diffusion from surrounding reliable measurements
    (_complete_unreliable_flow), so whole structures move coherently. A second
    pass measures the small residual between the aligned hemispheres and folds
    it into the field (single final resample). The (1-confidence) field is
    still returned so the seam optimizer keeps its cut away from unreliable
    correspondence.

    Returns (front', back', stats, flow_unreliability) — the last is a float32
    (out_h, out_w) field, 0 where flow is reliable/absent, →1 where measured
    correspondence is untrustworthy.
    """
    import cv2
    import numpy as np

    if out_w < 1024:  # degenerate sizes (unit tests): nothing meaningful to align
        return front, back, None, None

    # Measurement images: outside its clean region each hemisphere is BLACK
    # (invalid), and the corridor strips are ~3x wider than the true overlap.
    # DIS aggressively matches black-vs-content there and floods the strip
    # with saturated garbage vectors (measured: flow-magnitude p90 pinned at
    # the clamp on every capture, 87-99% low confidence), which the
    # completion fill then spreads INTO the overlap. Pre-filling each side
    # with the other (as the multiband already does) makes non-overlap zones
    # identical → measured flow 0 → only the true overlap carries disparity.
    # The warp itself still samples the REAL hemispheres.
    if clean1 is not None and clean2 is not None:
        lf = cv2.cvtColor(np.where(clean1[..., None], front, back), cv2.COLOR_BGR2GRAY)
        lb = cv2.cvtColor(np.where(clean2[..., None], back, front), cv2.COLOR_BGR2GRAY)
        # True-overlap mask: ONLY here do lf/lb compare different lenses. In
        # the pre-filled zones both strips are the same image by construction,
        # so DIS reports flow=0 at confidence 1.0 — fake "measurements" that
        # (a) anchored the completion diffusion to zero and (b) dominated the
        # regularizer's DC weighting (the pre-fill zones are most of the
        # strip), crushing a real, correctly-measured −20px vertical seam
        # offset to ~−2px (066: beam sheared at the seam, ceiling streaks
        # duplicated near the zenith). The mask keeps the pre-fill's warp
        # behaviour (flow→0 outside overlap is still correct) but excludes
        # the fake zones from every alignment STATISTIC.
        ov_meas = (clean1 & clean2).astype(np.float32)
        # Rim-MTF trust: past ~99° the fisheye optics go soft; DIS between a
        # mushy rim view and the other lens's sharp view produces flow that
        # is fb-CONSISTENT (mush matches mush under any shift) yet wrong —
        # with the rim-corrected wider overlap this liquified a tower facade
        # seen through a window (126). Measurements there get zero trust; the
        # completion diffuses coherent flow outward from the optically sound
        # zone instead.
        if theta1_deg is not None and theta2_deg is not None:
            rim = np.maximum(theta1_deg, theta2_deg)
            ov_meas = ov_meas * np.clip((100.0 - rim) / 1.5, 0.0, 1.0).astype(np.float32)
    else:
        lf = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY)
        lb = cv2.cvtColor(back, cv2.COLOR_BGR2GRAY)
        ov_meas = None
    # Dark scenes starve every measurement stage — DIS gradients, the texture
    # gate (grad−6/12), the structure tensor (τ=2500) and the phase-window
    # std gate are all scaled for normal exposure, but a dark ceiling carries
    # 5-10× weaker gradients (a ~20-gray conduit on a ~35-gray ceiling), so
    # alignment silently degrades exactly where the user cannot see well
    # either. Equalize the MEASUREMENT strips only (identical operator on
    # both sides; the warp still samples the real hemispheres).
    _clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(16, 16))
    lf = _clahe.apply(lf)
    lb = _clahe.apply(lb)
    map_x = np.tile(np.arange(out_w, dtype=np.float32), (out_h, 1))
    map_y = np.repeat(np.arange(out_h, dtype=np.float32)[:, None], out_w, axis=1)
    fx_full = np.zeros((out_h, out_w), np.float32)
    fy_full = np.zeros((out_h, out_w), np.float32)
    unrel_full = np.zeros((out_h, out_w), np.float32)

    half_strip = 560
    taper = 64
    max_flow = 100.0
    # Forward/backward consistency scale (px). fb-error stays ~0-1.5 px where
    # correspondence is trustworthy and jumps to 3.6-32+ px at occlusion
    # boundaries / repeated texture. tau=2 keeps confidence ~1 on the former
    # and collapses it on the latter, which routes those pixels to the
    # diffusion fill in _complete_unreliable_flow.
    fb_tau = 2.0
    # Pass-2 residual clamp: after the pass-1 warp both hemispheres already
    # share coarse geometry, so any genuine residual is small; a tight clamp
    # stops the refinement from ever undoing the first pass.
    max_residual_flow = 24.0
    strips = (("left", out_w // 4), ("right", 3 * out_w // 4))
    ramp = np.ones(2 * half_strip, np.float32)
    ramp[:taper] = np.linspace(0, 1, taper, dtype=np.float32)
    ramp[-taper:] = np.linspace(1, 0, taper, dtype=np.float32)
    # Global vertical seam offset: real captures carry a per-capture ~0-20px
    # UNIFORM vertical misregistration at a seam (bimodal across captures,
    # not explained by the shared factory calibration). Routing it through
    # the flow works positionally but the correction then rides the feather
    # weight w1, which transitions 0→1 across only the ~200px true-overlap
    # band — a ±10px vertical shift compressed into that band bends every
    # horizontal edge into a visible V-wave at the seam (066: beam soffit and
    # door header dipped ~10px). Instead: measure the offset robustly with
    # phase correlation, subtract it from the flow measurements, and apply it
    # in the same final warp as a raised-cosine profile spanning the FULL
    # strip (max slope ~0.03 px/px — invisible), so the seam meets exactly
    # while straight architecture stays straight.
    goff_full = np.zeros((1, out_w), np.float32)
    s_prof = (0.5 + 0.5 * np.cos(
        np.pi * np.abs(np.arange(2 * half_strip, dtype=np.float32) - half_strip) / half_strip
    )).astype(np.float32)
    stats = {}

    for name, xc in strips:
        x0, x1 = xc - half_strip, xc + half_strip
        fx, fy, conf, fb_err = _strip_flow_with_confidence(
            lf[:, x0:x1], lb[:, x0:x1], max_flow, fb_tau
        )
        g_dy, g_n = (0.0, 0)
        if ov_meas is not None:
            g_dy, g_n = _measure_seam_global_dy(lf, lb, ov_meas, xc, out_h)
        goff = g_dy * s_prof
        goff_full[0, x0:x1] = goff
        fy = fy - goff[None, :]
        apx, apy = _directional_measurability(lf[:, x0:x1])
        conf_m = conf if ov_meas is None else conf * ov_meas[:, x0:x1]
        fx, fy = _complete_unreliable_flow(
            fx, fy, conf_m, conf_x=conf_m * apx, conf_y=conf_m * apy
        )
        fx, fy = _regularize_strip_flow(
            fx, fy, lf[:, x0:x1], x0, out_w, out_h,
            conf=conf_m * apy, conf_par=conf_m * apx
        )
        fx_full[:, x0:x1] = fx * ramp[None, :]
        fy_full[:, x0:x1] = fy * ramp[None, :]
        unrel_full[:, x0:x1] = (1.0 - conf) * ramp[None, :]
        mag = np.hypot(fx, fy)
        stats[name] = {
            "median_px": float(np.median(mag)),
            "p95_px": float(np.percentile(mag, 95)),
            "fb_err_median_px": float(np.median(fb_err)),
            "fb_err_p95_px": float(np.percentile(fb_err, 95)),
            "low_confidence_pct": float(100.0 * (conf < 0.5).mean()),
            "global_dy_px": g_dy,
            "global_dy_windows": g_n,
        }

    wf = w1.astype(np.float32)

    def _warp(fxf, fyf):
        f = cv2.remap(
            front, map_x + (wf - 1.0) * fxf, map_y + (wf - 1.0) * fyf - 0.5 * goff_full,
            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT,
        )
        b = cv2.remap(
            back, map_x + wf * fxf, map_y + wf * fyf + 0.5 * goff_full,
            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT,
        )
        return f, b

    front_a, back_a = _warp(fx_full, fy_full)

    # Refinement pass: re-measure the small residual between the ALIGNED
    # hemispheres and fold it into the displacement field. The pass-1 warp
    # applies flow sampled at the destination grid (an inverse-warp
    # approximation), which under-corrects where the flow field itself varies
    # — exactly at depth edges. Composing the residual additively (second-order
    # error only, residual ≤ max_residual_flow px) and re-warping the ORIGINAL
    # hemispheres keeps single-resample sharpness.
    if clean1 is not None and clean2 is not None:
        laf = cv2.cvtColor(np.where(clean1[..., None], front_a, back_a), cv2.COLOR_BGR2GRAY)
        lab = cv2.cvtColor(np.where(clean2[..., None], back_a, front_a), cv2.COLOR_BGR2GRAY)
    else:
        laf = cv2.cvtColor(front_a, cv2.COLOR_BGR2GRAY)
        lab = cv2.cvtColor(back_a, cv2.COLOR_BGR2GRAY)
    laf = _clahe.apply(laf)
    lab = _clahe.apply(lab)
    for name, xc in strips:
        x0, x1 = xc - half_strip, xc + half_strip
        rx, ry, conf2, _ = _strip_flow_with_confidence(
            laf[:, x0:x1], lab[:, x0:x1], max_residual_flow, fb_tau
        )
        apx2, apy2 = _directional_measurability(laf[:, x0:x1])
        conf2_m = conf2 if ov_meas is None else conf2 * ov_meas[:, x0:x1]
        rx, ry = _complete_unreliable_flow(
            rx, ry, conf2_m, conf_x=conf2_m * apx2, conf_y=conf2_m * apy2
        )
        rx, ry = _regularize_strip_flow(
            rx, ry, laf[:, x0:x1], x0, out_w, out_h,
            conf=conf2_m * apy2, conf_par=conf2_m * apx2
        )
        fx_full[:, x0:x1] += rx * ramp[None, :]
        fy_full[:, x0:x1] += ry * ramp[None, :]
        unrel_full[:, x0:x1] = np.maximum(
            unrel_full[:, x0:x1], (1.0 - conf2) * ramp[None, :]
        )
        rmag = np.hypot(rx, ry)
        stats[name]["residual_median_px"] = float(np.median(rmag))
        stats[name]["residual_p95_px"] = float(np.percentile(rmag, 95))

    front_a, back_a = _warp(fx_full, fy_full)
    return front_a, back_a, stats, unrel_full


def _optimize_seam_mask(front, back, w1, out_w, out_h, flow_unreliability=None):
    """Route each seam through the lowest-mismatch path (parallax avoidance).

    Measured on real captures: hemisphere alignment is sub-pixel where scene
    content is distant, but near content carries 30-55 px of true stereo
    parallax (~2-3 cm lens baseline at arm's-length walls) — no calibration
    can remove it, and a straight seam through a near object double-cuts it.
    Commercial stitchers route the seam around such objects; this does the
    same with a minimum-cost vertical path (dynamic programming, |dx|<=2 per
    row) over the front/back mismatch inside the EXISTING feather corridor
    (0.15 <= w1 <= 0.85, each seam confined to its own half). A centering
    prior scaled by the median corridor mismatch keeps the path on the
    nominal w1=0.5 locus wherever the scene is already aligned, so
    well-aligned captures are effectively unchanged.

    ``flow_unreliability`` (optional, from _parallax_align_hemispheres) is an
    occlusion penalty: where forward/backward flow disagreed, the measured
    correspondence — and therefore the post-warp mismatch the DP sees — is not
    trustworthy (a textureless occlusion can look aligned while the two
    hemispheres show different content). Penalising those pixels makes the
    seam prefer one complete, confidently-matched edge over blending two
    unreliable observations. Zero everywhere on reliable captures → no change.

    Returns (mask, left_path, right_path): mask is 1.0 on the front-lens
    region between the two seam paths.
    """
    import cv2
    import numpy as np

    diff = np.abs(front.astype(np.int16) - back.astype(np.int16)).sum(axis=2).astype(np.float32)
    # Veiling flare can wash one hemisphere's view of real structure to
    # near-uniform white; the raw luminance mismatch is then SMALL exactly
    # where content disagrees most (one lens sees a door header, the other a
    # blank wall), and the seam happily routes through it — chopping the
    # structure out of the composite (039: doorway top-right corner vanished).
    # Price that disagreement with the GRADIENT-magnitude mismatch: high where
    # one side has an edge the other lacks, and — unlike a CLAHE-equalized
    # intensity diff, which amplified dark-scene noise into fake cost and sent
    # the path straight through a doorway (027) — near zero where both sides
    # are merely flat or noisy.
    gf = cv2.GaussianBlur(cv2.cvtColor(front, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.5)
    gb = cv2.GaussianBlur(cv2.cvtColor(back, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.5)
    def _gmag(g):
        return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3),
                             cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    
    diff = diff + 4.0 * np.abs(_gmag(gf) - _gmag(gb))
    
    # Pyramid-mixing clearance: level k of the multiband reconstruction mixes
    # both hemispheres within ~3*2^k px of the seam (measured on real captures:
    # the level-0 cut is perfectly binary; levels 1-4 transition over
    # ±6/14/24/48 px and carry ALL the residual double edges). A path that
    # merely avoids stepping ON a misaligned edge can still pass within that
    # mixing distance, duplicating the edge in mid-frequency bands. Adding a
    # Gaussian-spread copy of the mismatch (sigma = the level-2/3 mixing scale)
    # makes the DP prefer clearance from misaligned content while — unlike a
    # hard dilation — preserving narrow low-mismatch passages between close
    # features. Aligned edges (near-zero mismatch) stay freely crossable and
    # flat regions are unaffected.
    diff = diff + cv2.GaussianBlur(diff, (0, 0), 16.0)
    # Calculate dynamic programming seam mask
    # We give the DP seam the full valid overlap region (0.01 to 0.99)
    # to allow it to route around large near-field obstacles (like workers).
    corridor = (w1 >= 0.10) & (w1 <= 0.90)
    scale = float(np.median(diff[corridor])) if corridor.any() else 1.0

    gray_front = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY)
    grad_x = cv2.Sobel(gray_front, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray_front, cv2.CV_32F, 0, 1, ksize=3)
    edge_mag = np.hypot(grad_x, grad_y)
    edge_mag = edge_mag / (np.percentile(edge_mag[corridor_mask], 95) + 1e-6) * scale
    cost = diff + edge_mag * 5.0
 + ((w1 - 0.5) ** 2).astype(np.float32) * max(scale * 0.1, 1.0)
    if flow_unreliability is not None:
        # Spread with the same sigma as the mismatch term so the penalty also
        # buys clearance from the multiband mixing band, and scale it like the
        # centering prior so it stays subordinate to real content mismatch.
        occ = cv2.GaussianBlur(flow_unreliability.astype(np.float32), (0, 0), 16.0)
        cost = cost + occ * (2.0 * max(scale, 8.0))
    BIG = np.float32(1e9)

    # Ownership bias: the path cost above only prices what the cut CROSSES —
    # it is indifferent to handing a whole region to the lens that cannot see
    # it. With asymmetric veiling flare that is exactly what happened: the cut
    # drifted onto the flare-washed side of a doorway corner, so the corner
    # (crisp in the other lens) rendered as mush for the rows below the header
    # ("the door is being cut"). Per row, charge each candidate cut column for
    # the structure it gives away: gradient energy visible only in BACK that
    # lands on the FRONT side of the cut, plus the mirror term. Prefix/suffix
    # sums make it O(w) per row; T ignores noise-level asymmetry, the clip
    # keeps one huge edge from dominating the whole row.
    gmf = cv2.GaussianBlur(_gmag(gf), (0, 0), 3.0)
    gmb = cv2.GaussianBlur(_gmag(gb), (0, 0), 3.0)
    T = 6.0
    q_b_only = np.clip(gmb - gmf - T, 0.0, 25.0)   # structure only back sees
    q_f_only = np.clip(gmf - gmb - T, 0.0, 25.0)   # structure only front sees
    # Flare-only gate: one-sided structure comes from two very different
    # situations. FLARE-WASHING — both lenses see the same surface, one view
    # lifted to near-uniform white — has a LOW raw color mismatch, and there
    # the seeing lens should own the region. TRUE OCCLUSION — a shaft
    # interior one lens physically cannot see — has a HUGE raw mismatch, and
    # forcing ownership there smeared the occluder's crisp boundary into a
    # dark gradient (006 ceiling shaft). Fade the bias out as the raw
    # mismatch grows past what flare can explain.
    raw3 = cv2.GaussianBlur(
        np.abs(front.astype(np.int16) - back.astype(np.int16)).sum(axis=2).astype(np.float32),
        (0, 0), 3.0)
    flare_gate = np.clip((300.0 - raw3) / 150.0, 0.0, 1.0)
    # ... and flare is a BRIGHT phenomenon (scattered light lifts a surface
    # toward white). One-sided sharpness in DARK content is a different beast
    # — a shaft interior seen well by one lens and as vignetted murk by the
    # other (006) — and re-owning it drags the occluder's boundary along.
    # Require both views bright before trusting the flare interpretation.
    lum_gate = np.clip(
        (cv2.GaussianBlur(np.minimum(gf, gb), (0, 0), 3.0) - 120.0) / 50.0, 0.0, 1.0)
    flare_gate *= lum_gate
    q_b_only *= flare_gate
    q_f_only *= flare_gate
    LAMBDA_OWN = 1.0

    paths = []
    for xc, side_lo, side_hi in (
        (out_w // 4, 0, out_w // 2),
        (3 * out_w // 4, out_w // 2, out_w),
    ):
        x0 = max(side_lo, xc - 480)
        x1 = min(side_hi, xc + 480)
        Cw = np.where(corridor[:, x0:x1], cost[:, x0:x1], BIG)
        # Front owns x >= path at the LEFT seam and x < path at the RIGHT
        # seam (mask = left <= x < right). Charge accordingly.
        qb = q_b_only[:, x0:x1].astype(np.float64)
        qf = q_f_only[:, x0:x1].astype(np.float64)
        if xc == out_w // 4:
            give_b_to_front = np.cumsum(qb[:, ::-1], axis=1)[:, ::-1]  # x' >= path
            give_f_to_back = np.cumsum(qf, axis=1) - qf                # x' < path
        else:
            give_b_to_front = np.cumsum(qb, axis=1) - qb               # x' < path
            give_f_to_back = np.cumsum(qf[:, ::-1], axis=1)[:, ::-1]   # x' >= path
        Cw = Cw + LAMBDA_OWN * (give_b_to_front + give_f_to_back)
        D = Cw.astype(np.float64).copy()
        for y in range(1, out_h):
            prev = D[y - 1]
            m = prev.copy()
            m[:-1] = np.minimum(m[:-1], prev[1:])
            m[1:] = np.minimum(m[1:], prev[:-1])
            m2 = m.copy()
            m2[:-1] = np.minimum(m2[:-1], m[1:])
            m2[1:] = np.minimum(m2[1:], m[:-1])
            D[y] += m2
        path = np.empty(out_h, np.int32)
        path[-1] = int(np.argmin(D[-1]))
        for y in range(out_h - 2, -1, -1):
            lo = max(0, path[y + 1] - 2)
            hi = min(D.shape[1], path[y + 1] + 3)
            path[y] = lo + int(np.argmin(D[y, lo:hi]))

        raw_argmin = np.argmin(Cw, axis=1) + x0
        print('raw argmin at Y=1000:', raw_argmin[1000])
        print('raw argmin at Y=1500:', raw_argmin[1500])
        print('path at Y=1000:', path[1000] + x0)
        print('path at Y=1500:', path[1500] + x0)
        paths.append(path + x0)


    left, right = paths
    cols = np.arange(out_w)[None, :]
    mask = ((cols >= left[:, None]) & (cols < right[:, None])).astype(np.float32)
    return mask, left, right


def _multiband_blend(front, back, mask, clean1, clean2):
    """Burt–Adelson multi-band compositing of the two hemispheres.

    Linear alpha blending renders BOTH irreducible differences between the
    hemispheres directly: a direction-dependent radiance mismatch (lens flare /
    per-sensor auto-exposure, measured up to ~15% on real captures — no global
    gain can remove it) becomes a visible luminance ramp on smooth walls, and
    the ~2 cm lens parallax (tens of px on near surfaces) becomes a double
    image. Frequency-adaptive compositing fixes both: low frequencies
    transition over a very wide region (the mismatch gradient drops below
    perception) while high frequencies switch at the seam ``mask`` boundary
    (no ghosting). ``mask`` is 1.0 on the front-lens region — either the
    w1>=0.5 locus or the parallax-optimized path from _optimize_seam_mask.

    Each source is pre-filled with the other outside its clean region so that
    coarse pyramid levels diffuse scene content, not black borders. The pyramid
    depth is derived from the output size (coarsest level ~16 px).
    """
    import cv2
    import numpy as np

    h, w = mask.shape
    levels = max(2, int(np.floor(np.log2(max(16, min(h, w)) / 16.0))))

    mask = mask.astype(np.float32)
    f = np.where(clean1[..., None], front, back).astype(np.float32)
    b = np.where(clean2[..., None], back, front).astype(np.float32)

    gp_f, gp_b, gp_m = [f], [b], [mask]
    for _ in range(levels):
        gp_f.append(cv2.pyrDown(gp_f[-1]))
        gp_b.append(cv2.pyrDown(gp_b[-1]))
        gp_m.append(cv2.pyrDown(gp_m[-1]))

    out = None
    for k in range(levels, -1, -1):
        if k == levels:
            lap_f, lap_b = gp_f[k], gp_b[k]
        else:
            size = (gp_f[k].shape[1], gp_f[k].shape[0])
            lap_f = gp_f[k] - cv2.pyrUp(gp_f[k + 1], dstsize=size)
            lap_b = gp_b[k] - cv2.pyrUp(gp_b[k + 1], dstsize=size)
        m = gp_m[k][..., None]
        layer = lap_f * m + lap_b * (1.0 - m)
        if out is None:
            out = layer
        else:
            out = cv2.pyrUp(out, dstsize=(layer.shape[1], layer.shape[0])) + layer
    return np.clip(out, 0, 255).astype(np.uint8)


@dataclass
class StitchArtifacts:
    """Intermediate buffers for stitch debugging (BGR uint8 unless noted)."""
    raw_decoded: object
    top_fisheye: object
    bottom_fisheye: object
    top_fisheye_after_rotation: object
    bottom_fisheye_after_rotation: object
    sphere_lens1: object
    sphere_lens2: object
    sphere_lens1_grid: object
    sphere_lens2_grid: object
    blended: object
    blended_grid: object
    valid_lens1: object
    valid_lens2: object
    blend_weight_lens1: object = None
    metadata: dict = field(default_factory=dict)
    # ── Seam/flow diagnostics (held references only; no pipeline behavior change) ──
    front_pre_align: object = None   # post-gain front hemisphere BEFORE flow warp
    back_pre_align: object = None    # post-gain back hemisphere BEFORE flow warp
    front_aligned: object = None     # front after _parallax_align_hemispheres
    back_aligned: object = None      # back after _parallax_align_hemispheres
    seam_mask: object = None         # binary front-region mask from _optimize_seam_mask
    seam_left: object = None         # per-row x of left seam path
    seam_right: object = None        # per-row x of right seam path
    clean_lens1: object = None       # v1 ∧ (theta1 <= theta_clean)
    clean_lens2: object = None       # v2 ∧ (theta2 <= theta_clean)
    flow_unreliability: object = None  # (1-confidence) fwd/bwd flow field, 0=reliable


def _overlay_equirect_horizon_equator(img):
    """Draw equator (horizon) and prime meridian on an equirectangular image."""
    import cv2
    import numpy as np

    out = img.copy()
    h, w = out.shape[:2]
    equator_y = h // 2
    meridian_x = w // 2
    # Equator / horizon — cyan
    cv2.line(out, (0, equator_y), (w - 1, equator_y), (255, 255, 0), 2, cv2.LINE_AA)
    # Prime meridian (forward at lon=0) — magenta
    cv2.line(out, (meridian_x, 0), (meridian_x, h - 1), (255, 0, 255), 2, cv2.LINE_AA)
    # Zenith / nadir markers
    cv2.circle(out, (meridian_x, 0), 8, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.circle(out, (meridian_x, h - 1), 8, (0, 128, 255), 2, cv2.LINE_AA)
    cv2.putText(out, "zenith", (meridian_x + 10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    cv2.putText(out, "nadir", (meridian_x + 10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 128, 255), 2)
    cv2.putText(out, "equator", (10, equator_y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
    cv2.putText(out, "lon=0", (meridian_x + 8, h // 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
    return out


def _draw_fisheye_calibration(img, lens: LensCalibration, label: str):
    """Overlay lens centre, radius, and rotation tuple on a fisheye crop."""
    import cv2

    out = img.copy()
    cx, cy, r = int(round(lens.cx)), int(round(lens.cy)), int(round(lens.radius))
    cv2.circle(out, (cx, cy), max(1, r), (0, 255, 0), 2, cv2.LINE_AA)
    cv2.drawMarker(out, (cx, cy), (0, 0, 255), cv2.MARKER_CROSS, 24, 2)
    yaw, pitch, roll = lens.rot
    cv2.putText(
        out,
        f"{label}  r={r}  rot=({yaw:.2f},{pitch:.2f},{roll:.2f})",
        (12, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (0, 255, 255),
        2,
    )
    return out


def _fisheye_remap_footprint(img, mapx, mapy, valid_mask):
    """Show which fisheye pixels are sampled after 3D rotation (remap footprint)."""
    import cv2
    import numpy as np

    out = img.copy()
    ys, xs = np.where(valid_mask)
    if ys.size == 0:
        return out
    pts = np.stack([mapx[ys, xs], mapy[ys, xs]], axis=1).astype(np.float32)
    hull = cv2.convexHull(pts)
    overlay = out.copy()
    cv2.fillConvexPoly(overlay, hull.astype(np.int32), (0, 180, 255))
    cv2.addWeighted(overlay, 0.35, out, 0.65, 0, out)
    cv2.polylines(out, [hull.astype(np.int32)], True, (0, 220, 255), 2, cv2.LINE_AA)
    return out


def _save_png(path: Path, img) -> None:
    import cv2

    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), img):
        raise OSError(f"Failed to write {path}")


def save_stitch_debug_pngs(artifacts: StitchArtifacts, out_dir: Path) -> dict[str, str]:
    """Write all intermediate stitch images to ``out_dir``."""
    import json

    from app.services.stitch_ownership import format_ownership_report_text, render_ownership_masks
    from app.services.orientation_verify import (
        format_world_frame_measurements,
        render_equirect_latlon_grid,
        render_world_frame_on_blend,
    )

    from app.services.world_direction_fisheye import (
        build_world_direction_fisheye_debug,
        format_world_direction_fisheye_report,
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    meta = artifacts.metadata
    top_04 = artifacts.top_fisheye_after_rotation
    bot_05 = artifacts.bottom_fisheye_after_rotation
    if meta.get("lens1") and meta.get("lens2"):
        wd_data, top_annotated, bot_annotated = build_world_direction_fisheye_debug(
            meta,
            artifacts.top_fisheye_after_rotation,
            artifacts.bottom_fisheye_after_rotation,
        )
        if top_annotated is not None:
            top_04 = top_annotated
        if bot_annotated is not None:
            bot_05 = bot_annotated
        meta["world_direction_fisheye"] = wd_data
        wd_txt = out_dir / "world_direction_fisheye.txt"
        wd_txt.write_text(format_world_direction_fisheye_report(wd_data) + "\n", encoding="utf-8")
        written: dict[str, str] = {
            "world_direction_fisheye.txt": str(wd_txt),
        }
        wd_json = out_dir / "world_direction_fisheye.json"
        wd_json.write_text(json.dumps(wd_data, indent=2), encoding="utf-8")
        written["world_direction_fisheye.json"] = str(wd_json)
    else:
        written = {}

    mapping = {
        "01_raw_decoded.png": artifacts.raw_decoded,
        "02_top_fisheye.png": artifacts.top_fisheye,
        "03_bottom_fisheye.png": artifacts.bottom_fisheye,
        "04_top_fisheye_after_rotation.png": top_04,
        "05_bottom_fisheye_after_rotation.png": bot_05,
        "06_sphere_lens1_only.png": artifacts.sphere_lens1,
        "07_sphere_lens1_grid.png": artifacts.sphere_lens1_grid,
        "08_sphere_lens2_only.png": artifacts.sphere_lens2,
        "09_sphere_lens2_grid.png": artifacts.sphere_lens2_grid,
        "10_final_blended.png": artifacts.blended,
        "11_final_blended_grid.png": artifacts.blended_grid,
    }
    for name, img in mapping.items():
        path = out_dir / name
        _save_png(path, img)
        written[name] = str(path)

    if artifacts.valid_lens1 is not None and artifacts.valid_lens2 is not None:
        w1 = artifacts.blend_weight_lens1
        if w1 is not None:
            for name, img in render_ownership_masks(
                artifacts.valid_lens1, artifacts.valid_lens2, w1
            ).items():
                path = out_dir / name
                _save_png(path, img)
                written[name] = str(path)

    own = artifacts.metadata.get("ownership_diagnostics")
    if own:
        own_path = out_dir / "hemisphere_ownership.json"
        own_path.write_text(json.dumps(own, indent=2), encoding="utf-8")
        written["hemisphere_ownership.json"] = str(own_path)
        txt_path = out_dir / "hemisphere_ownership.txt"
        txt_path.write_text(format_ownership_report_text(own) + "\n", encoding="utf-8")
        written["hemisphere_ownership.txt"] = str(txt_path)

    wf = artifacts.metadata.get("world_frame_measurements")
    if wf and artifacts.blended is not None:
        wf_img = render_world_frame_on_blend(artifacts.blended, wf)
        wf_path = out_dir / "12_world_frame_on_blend.png"
        _save_png(wf_path, wf_img)
        written["12_world_frame_on_blend.png"] = str(wf_path)
        wf_txt = out_dir / "world_frame_measurements.txt"
        wf_txt.write_text(format_world_frame_measurements(wf) + "\n", encoding="utf-8")
        written["world_frame_measurements.txt"] = str(wf_txt)
        wf_json = out_dir / "world_frame_measurements.json"
        wf_json.write_text(json.dumps(wf, indent=2), encoding="utf-8")
        written["world_frame_measurements.json"] = str(wf_json)

    if artifacts.blended is not None:
        grid_path = out_dir / "13_final_blended_latlon_grid.png"
        _save_png(grid_path, render_equirect_latlon_grid(artifacts.blended))
        written["13_final_blended_latlon_grid.png"] = str(grid_path)

    if meta.get("lens1") and meta.get("lens2"):
        from app.services.projection_validation import build_projection_validation_debug

        pv_data, pv1, pv2 = build_projection_validation_debug(
            meta,
            artifacts.top_fisheye_after_rotation,
            artifacts.bottom_fisheye_after_rotation,
        )
        meta["projection_validation"] = {
            "lens1": {k: v for k, v in pv_data["lens1"].items() if k != "samples"},
            "lens2": {k: v for k, v in pv_data["lens2"].items() if k != "samples"},
            "lens1_valid_samples": sum(1 for s in pv_data["lens1"]["samples"] if s["valid"]),
            "lens2_valid_samples": sum(1 for s in pv_data["lens2"]["samples"] if s["valid"]),
        }
        if pv1 is not None:
            p = out_dir / "projection_validation_lens1.png"
            _save_png(p, pv1)
            written["projection_validation_lens1.png"] = str(p)
        if pv2 is not None:
            p = out_dir / "projection_validation_lens2.png"
            _save_png(p, pv2)
            written["projection_validation_lens2.png"] = str(p)

        from app.services.ray_pipeline_trace import (
            build_ray_pipeline_trace,
            format_ray_pipeline_trace,
        )

        ray_trace = build_ray_pipeline_trace(meta)
        ray_txt = out_dir / "ray_pipeline_trace.txt"
        ray_txt.write_text(format_ray_pipeline_trace(ray_trace) + "\n", encoding="utf-8")
        written["ray_pipeline_trace.txt"] = str(ray_txt)
        ray_json = out_dir / "ray_pipeline_trace.json"
        ray_json.write_text(json.dumps(ray_trace, indent=2), encoding="utf-8")
        written["ray_pipeline_trace.json"] = str(ray_json)
        meta["ray_pipeline_trace_sample"] = ray_trace["sample_ray"]

    meta_path = out_dir / "stitch_metadata.json"

    def _json_default(obj):
        if isinstance(obj, tuple):
            return list(obj)
        raise TypeError(f"Not JSON serializable: {type(obj)!r}")

    meta_path.write_text(json.dumps(artifacts.metadata, indent=2, default=_json_default), encoding="utf-8")
    written["stitch_metadata.json"] = str(meta_path)
    return written


def _stitch_arrays(
    data: bytes,
    filename: str,
    *,
    out_w: int = 5760,
    out_h: int = 2880,
) -> Optional[tuple[object, StitchArtifacts]]:
    """Core stitch pipeline returning (blended_bgr, debug artifacts)."""
    import numpy as np
    import cv2

    model = detect_model(data)
    prof = profile_for(model)
    calib = parse_embedded_calibration(data)

    img = _decode_raw_rgb(data, filename)
    if img is None:
        logger.error(f"Could not decode {filename} for stitching")
        return None

    H, W = img.shape[:2]
    logger.info(f"Stitch pipeline decode OK for {filename}: {W}x{H}")
    meta: dict = {
        "camera_model": model or prof.model,
        "decoded_width": W,
        "decoded_height": H,
        "output_width": out_w,
        "output_height": out_h,
    }

    # .insp JPEGs store the frame rotated 90° CCW relative to the calibrated
    # portrait sensor frame — rotate back so the existing top-bottom path
    # (identical to the DNG path) applies unchanged.
    if calib and calib.decode_rotate_cw and W > H:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        H, W = img.shape[:2]
        meta["decode_rotated_cw"] = True
        logger.info(
            f"Rotated decoded frame 90° CW to sensor stacked frame for {filename}: {W}x{H}"
        )

    # Insta360 .dng files store each eye's NATIVE sensor readout stacked
    # vertically; the embedded calibration (and the firmware JPEG pipeline)
    # describe the frame in which EACH SQUARE is rotated 90° CW from that
    # readout. Verified on real X2 files: the raw squares carry world-down at
    # the east (lens1) / west (lens2) rims instead of the calibrated
    # south/north convention, exactly one 90° CCW in-plane rotation per
    # square — which rendered whole panoramas rolled 90°. Rotating each
    # square 90° CW recovers the calibration frame; downstream math is
    # untouched and identical to the (Studio-verified) .insp path.
    if (
        filename.lower().endswith(".dng")
        and calib
        and calib.layout == "top-bottom"
        and H == 2 * W
    ):
        img = np.vstack([
            cv2.rotate(img[: H // 2], cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(img[H // 2 :], cv2.ROTATE_90_CLOCKWISE),
        ])
        meta["dng_readout_squares_rotated_cw"] = True
        logger.info(
            f"Rotated each DNG readout square 90° CW to calibration frame for {filename}"
        )

    if not (calib and calib.source in ("embedded", "embedded_trailer")):
        logger.warning(f"No embedded calibration for {filename}; cannot stitch reliably")
        return None

    fov = prof.fisheye_fov_deg
    sx_full = W / calib.width if calib.width else 1.0
    sy_full = H / calib.height if calib.height else 1.0
    meta.update({
        "calibration_source": calib.source,
        "layout": calib.layout,
        "fisheye_fov_deg": fov,
        "raw_calibration": calib.raw,
        "calibration_width": calib.width,
        "calibration_height": calib.height,
        "scale_x": sx_full,
        "scale_y": sy_full,
        "lens1": {
            "cx": calib.lens1.cx, "cy": calib.lens1.cy, "radius": calib.lens1.radius,
            "rot": calib.lens1.rot,
        },
        "lens2": {
            "cx": calib.lens2.cx, "cy": calib.lens2.cy, "radius": calib.lens2.radius,
            "rot": calib.lens2.rot,
        },
    })

    if calib.layout == "top-bottom":
        top = img[0:H // 2, :].copy()
        bot = img[H // 2:H, :].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        l2_draw = l2
    else:
        top = img[:, 0:W // 2].copy()
        bot = img[:, W // 2:W].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        l2_draw = LensCalibration(l2.cx - W // 2, l2.cy, l2.radius, l2.rot)

    fov, autocal = _autocal_fov(top, bot, l1, l2_draw, fov)
    meta["fisheye_fov_deg_effective"] = fov
    meta["fov_autocal"] = autocal

    m1x, m1y, v1 = _hemisphere_map(
        out_w, out_h, l1.cx, l1.cy, l1.radius, fov, 0.0, l1.rot,
        src_h=top.shape[0], src_w=top.shape[1], lens_label="lens1",
    )
    m2x, m2y, v2 = _hemisphere_map(
        out_w, out_h, l2_draw.cx, l2_draw.cy, l2_draw.radius, fov, 0.0, l2_draw.rot,
        src_h=bot.shape[0], src_w=bot.shape[1], lens_label="lens2",
        body_flip=True,
    )
    # Validity must include SAMPLING bounds, not just the FOV cone: the
    # fisheye circle can be clipped by the sensor edge (measured: lens1
    # cx−r < 0 on real X2 files), so θ-valid rays can still land outside the
    # source image and remap black. Without this, those black pixels enter
    # the feather, the clean masks, and the local gain ratio (which then
    # confidently darkens the other hemisphere into grey blobs).
    v1 &= (m1x >= 0) & (m1x < top.shape[1] - 1) & (m1y >= 0) & (m1y < top.shape[0] - 1)
    v2 &= (m2x >= 0) & (m2x < bot.shape[1] - 1) & (m2y >= 0) & (m2y < bot.shape[0] - 1)

    front = cv2.remap(top, m1x, m1y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    back = cv2.remap(bot, m2x, m2y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    top_rot = _fisheye_remap_footprint(top, m1x, m1y, v1)
    bot_rot = _fisheye_remap_footprint(bot, m2x, m2y, v2)

    sphere1 = front.copy()
    sphere2 = back.copy()
    sphere1[~v1] = 0
    sphere2[~v2] = 0

    overlap = v1 & v2

    # ── Vertical gradient-band fix (blend stage only) ────────────────────────
    # Two faint vertical bands appeared at the seam longitudes because the
    # vignetted outer rim of each fisheye (illumination collapses ~65% over the
    # last ~5° of FOV) entered the blend: it received up to ~30% feather weight
    # AND biased the global exposure gain (estimated over ALL overlap pixels,
    # dark rims included), which over-brightened the back hemisphere into
    # clipping. Both estimators now use the measured clean FOV. The angle is
    # measured per capture from the overlap itself (no fixed constants beyond
    # the 90%-illumination definition); validity/ownership masks (v1, v2) and
    # the projection are untouched, and the same clean angle is used for both
    # lenses so the w1=0.5 seam-centre locus is unchanged.
    theta1_deg = np.hypot(m1x - l1.cx, m1y - l1.cy) / max(l1.radius, 1e-6) * (fov / 2.0)
    theta2_deg = (
        np.hypot(m2x - l2_draw.cx, m2y - l2_draw.cy) / max(l2_draw.radius, 1e-6) * (fov / 2.0)
    )
    # Rim illumination correction first: with the vignetting gain restored,
    # the clean-theta estimate extends toward the true mutual FOV and the
    # seam corridor widens — a doorway/opening at a seam longitude can then
    # be owned entirely by the lens that sees it open (Studio parity) instead
    # of being sliced at the 90° meridian.
    front, back = _correct_rim_illumination(
        front, back, overlap, theta1_deg, theta2_deg, fov
    )
    sphere1 = front.copy()
    sphere2 = back.copy()
    sphere1[~v1] = 0
    sphere2[~v2] = 0
    theta_clean = _estimate_clean_theta(front, back, overlap, theta1_deg, theta2_deg, fov)
    # Even corrected, the last degree of the image circle carries demosaic
    # fringing and noise amplified by the ~3x gain — keep a safety margin.
    theta_clean = float(min(theta_clean, fov / 2.0 - 1.2))
    clean1 = v1 & (theta1_deg <= theta_clean)
    clean2 = v2 & (theta2_deg <= theta_clean)
    meta["blend_theta_clean_deg"] = theta_clean
    logger.info(
        f"Blend clean FOV: theta_clean={theta_clean:.1f}° (fov/2={fov / 2.0:.1f}°)"
    )

    # Exposure gain: per-channel MEDIAN of per-pixel front/back ratios over the
    # clean overlap. The previous mean-of-sums over the full overlap was biased
    # by the vignetted rims AND by close-range parallax content in the polar
    # caps (floor/ceiling), inflating the gain (measured 1.36x vs a true
    # same-surface ratio of ~1.05x on real captures) and clipping up to ~half
    # of the bright overlap — the wide component of the seam gradient bands.
    # The median over pixel-aligned clean pixels is robust to both.
    gain_region = clean1 & clean2
    if gain_region.sum() <= 1000:
        gain_region = overlap
    if gain_region.sum() > 1000:
        gains = []
        for c in range(3):
            fr = front[..., c][gain_region].astype(np.float32)
            bk = back[..., c][gain_region].astype(np.float32)
            m = (fr > 10) & (bk > 10)
            if m.sum() > 1000:
                gains.append(float(np.median(fr[m] / bk[m])))
            else:
                gains.append(float((fr.mean() + 1e-6) / (bk.mean() + 1e-6)))
        gain = np.array(gains, dtype=np.float32).reshape(1, 1, 3)
        meta["exposure_gain_bgr"] = [float(g) for g in gain.ravel()]
        back = np.clip(back.astype(np.float32) * gain, 0, 255).astype(np.uint8)
        sphere2 = back.copy()
        sphere2[~v2] = 0

    d1 = cv2.distanceTransform(clean1.astype(np.uint8), cv2.DIST_L2, 5)
    d2 = cv2.distanceTransform(clean2.astype(np.uint8), cv2.DIST_L2, 5)
    # Coverage safety net: theta1+theta2≈180° guarantees every valid pixel is
    # inside at least one clean mask; if a pathological calibration ever broke
    # that, fall back to the original full-validity feather rather than render
    # holes.
    if not bool(np.all((d1 + d2)[v1 | v2] > 0)):
        logger.warning("Clean-FOV feather left uncovered pixels; using full-validity feather")
        d1 = cv2.distanceTransform(v1.astype(np.uint8), cv2.DIST_L2, 5)
        d2 = cv2.distanceTransform(v2.astype(np.uint8), cv2.DIST_L2, 5)
    w1 = d1 / (d1 + d2 + 1e-6)
    # Keep pre-warp references for seam/flow diagnostics (remap returns new
    # arrays, so these stay untouched by the alignment below).
    front_pre_align, back_pre_align = front, back
    front, back, flow_stats, flow_unreliability = _parallax_align_hemispheres(
        front, back, w1, out_w, out_h, clean1, clean2,
        theta1_deg=theta1_deg, theta2_deg=theta2_deg,
    )
    if flow_stats is not None:
        meta["parallax_align"] = flow_stats
        logger.info(f"Parallax alignment: {flow_stats}")

    # Spatially-varying exposure/flare equalization (low-frequency only).
    # The global gain fixes overall exposure, but veiling flare near bright
    # openings is direction-dependent: the SAME wall can differ by a smooth
    # ±20% between hemispheres, which the multiband's wide low-frequency
    # transition renders as a soft smudge across the seam corridor. Measured
    # on the flow-ALIGNED hemispheres (pre-alignment ratios compare different
    # content at parallax edges and smear a false tint onto nearby surfaces),
    # heavily low-passed, and split symmetrically so neither side is globally
    # rebiased and high-frequency content is untouched.
    ratio_region = clean1 & clean2
    if ratio_region.sum() > 1000:
        fF = front.astype(np.float32)
        bF = back.astype(np.float32)
        # Erode the overlap and use a generous brightness floor so the dim
        # chromatic ring at each lens's validity boundary can never bias the
        # ratio (it reads as a consistent false darkening that the variance
        # gate cannot catch).
        m = cv2.erode(ratio_region.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool)
        m &= np.all(front > 30, axis=2) & np.all(back > 30, axis=2)
        mf = m.astype(np.float32)
        den = _lowpass_field(mf, 96.0)
        ok = den > 1e-3
        den_s = np.maximum(den, 1e-3)

        # Reliability: a low-frequency gain can only equalize a ratio that IS
        # low-frequency. Where the true ratio changes abruptly (a dark door
        # leaf against a flare-brightened wall) the smoothed field straddles
        # the transition and TINTS both sides. Measure the local ratio
        # variance on luminance and fade the correction out where the ratio
        # is not spatially consistent; the same weight applies to all
        # channels so no colour fringing is introduced.
        lum_f = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY).astype(np.float32)
        lum_b = cv2.cvtColor(back, cv2.COLOR_BGR2GRAY).astype(np.float32)
        rl = np.where(m, lum_f / np.maximum(lum_b, 1.0), 0.0)
        rl_low = np.where(ok, _lowpass_field(rl * mf, 96.0) / den_s, 1.0)
        dev = np.where(m, (rl - rl_low) ** 2, 0.0)
        var_low = np.where(ok, _lowpass_field(dev, 96.0) / den_s, 1.0)
        rel_var = var_low / (rl_low ** 2 + 1e-6)
        w = np.exp(-rel_var / 0.02).astype(np.float32)

        # Spatial support: the ratio is only MEASURED inside the overlap; the
        # gain is applied to the full hemispheres. Without a fade the smooth
        # field carries extrapolated values a few hundred px past the overlap
        # and then snaps to 1.0 at the support edge — on a plain wall/ceiling
        # that renders as a distinct vertical luminance band beside the seam
        # (visible on real captures ~400px right of the seam). Fade the
        # correction out with the measurement support so it is exactly 1.0
        # wherever the ratio was not measured nearby.
        sup = np.clip(den * 4.0, 0.0, 1.0)

        half = np.ones_like(fF)
        for c in range(3):
            r = np.where(m, fF[..., c] / np.maximum(bF[..., c], 1.0), 0.0)
            r_low = np.where(ok, _lowpass_field(r * mf, 96.0) / den_s, 1.0)
            r_eff = 1.0 + (np.clip(r_low, 0.7, 1.4) - 1.0) * w * sup
            half[..., c] = np.sqrt(r_eff)
        front = np.clip(fF / half, 0, 255).astype(np.uint8)
        back = np.clip(bF * half, 0, 255).astype(np.uint8)
        meta["local_gain_range"] = [float(half.min() ** 2), float(half.max() ** 2)]

    seam_mask, seam_left, seam_right = _optimize_seam_mask(
        front, back, w1, out_w, out_h, flow_unreliability
    )
    meta["seam_optimized"] = True
    meta["seam_offset_px"] = {
        "left_median_abs": float(np.median(np.abs(seam_left - out_w // 4))),
        "left_max_abs": float(np.max(np.abs(seam_left - out_w // 4))),
        "right_median_abs": float(np.median(np.abs(seam_right - 3 * out_w // 4))),
        "right_max_abs": float(np.max(np.abs(seam_right - 3 * out_w // 4))),
    }
    blended = _multiband_blend(front, back, seam_mask, clean1, clean2)
    meta["blend_method"] = "multiband+seam_dp"

    from app.services.stitch_ownership import build_full_ownership_report

    ownership_report = build_full_ownership_report(
        v1, v2, w1, out_w, out_h,
        fov_deg=fov,
        lens1_params=(l1.cx, l1.cy, l1.radius, l1.rot),
        lens2_params=(l2_draw.cx, l2_draw.cy, l2_draw.radius, l2_draw.rot),
        src_h=bot.shape[0],
        src_w=bot.shape[1],
    )
    meta["ownership_diagnostics"] = ownership_report

    from app.services.orientation_verify import (
        build_world_frame_measurements,
        verify_orientation,
    )

    orient = verify_orientation(calib)
    meta["world_frame_measurements"] = build_world_frame_measurements(
        orient, v1, v2, out_w, out_h,
    )

    artifacts = StitchArtifacts(
        raw_decoded=img,
        top_fisheye=_draw_fisheye_calibration(top, l1, "lens1"),
        bottom_fisheye=_draw_fisheye_calibration(bot, l2_draw, "lens2"),
        top_fisheye_after_rotation=top_rot,
        bottom_fisheye_after_rotation=bot_rot,
        sphere_lens1=sphere1,
        sphere_lens2=sphere2,
        sphere_lens1_grid=_overlay_equirect_horizon_equator(sphere1),
        sphere_lens2_grid=_overlay_equirect_horizon_equator(sphere2),
        blended=blended,
        blended_grid=_overlay_equirect_horizon_equator(blended),
        valid_lens1=v1,
        valid_lens2=v2,
        blend_weight_lens1=w1,
        metadata=meta,
        front_pre_align=front_pre_align,
        back_pre_align=back_pre_align,
        front_aligned=front,
        back_aligned=back,
        seam_mask=seam_mask,
        seam_left=seam_left,
        seam_right=seam_right,
        clean_lens1=clean1,
        clean_lens2=clean2,
        flow_unreliability=flow_unreliability,
    )
    return blended, artifacts


@dataclass
class StitchResult:
    """The reusable service output (req #6)."""
    processed_image: bytes          # equirectangular JPEG bytes
    projection: str                 # always "equirectangular"
    width: int
    height: int
    camera_model: str
    metadata: dict = field(default_factory=dict)


def stitch_equirectangular(
    data: bytes,
    filename: str,
    *,
    out_w: int = 5760,
    out_h: int = 2880,
    debug_dir: Optional[Path] = None,
) -> Optional[StitchResult]:
    """
    Stitch a raw dual-fisheye file into an equirectangular panorama.

    When ``debug_dir`` is set, intermediate PNGs are written for inspection.
    """
    import cv2

    result = _stitch_arrays(data, filename, out_w=out_w, out_h=out_h)
    if result is None:
        return None
    out, artifacts = result

    if debug_dir is not None:
        debug_path = Path(debug_dir)
        save_stitch_debug_pngs(artifacts, debug_path)
        logger.info(f"Stitch debug PNGs written to {debug_path}")
        from app.services.orientation_verify import verify_from_raw_bytes

        verify_from_raw_bytes(
            data,
            out_dir=debug_path,
            background_bgr=artifacts.blended,
        )

    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return None

    gpano = _gpano_pose_from_stitch()
    gps_heading = _try_pose_heading_from_exif(data)
    if gps_heading is not None:
        gpano["poseHeadingDegrees"] = gps_heading

    return StitchResult(
        processed_image=buf.tobytes(),
        projection="equirectangular",
        width=out_w,
        height=out_h,
        camera_model=str(artifacts.metadata.get("camera_model", "generic")),
        metadata={**artifacts.metadata, "gpano": gpano},
    )


def stitch_equirectangular_debug(
    data: bytes,
    filename: str,
    out_dir: Path,
    *,
    out_w: int = 5760,
    out_h: int = 2880,
) -> Optional[StitchArtifacts]:
    """Run stitch and write intermediate PNGs to ``out_dir``."""
    result = _stitch_arrays(data, filename, out_w=out_w, out_h=out_h)
    if result is None:
        return None
    _, artifacts = result
    save_stitch_debug_pngs(artifacts, out_dir)
    from app.services.orientation_verify import verify_from_raw_bytes

    verify_from_raw_bytes(
        data,
        out_dir=out_dir,
        background_bgr=artifacts.blended,
    )
    return artifacts
