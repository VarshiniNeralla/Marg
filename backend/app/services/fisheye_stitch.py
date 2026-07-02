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
# marketing "200°") — 204° for the X2 is the documented sweet spot; X3/X4/X5
# use progressively wider lenses. Overridable via env/profile per model.
_PROFILES: dict[str, CameraProfile] = {
    "ONE X2": CameraProfile("ONE X2", 204.0),
    "X3": CameraProfile("X3", 204.0),
    "X4": CameraProfile("X4", 205.0),
    "X5": CameraProfile("X5", 205.0),
}
_DEFAULT_PROFILE = CameraProfile("generic", 204.0)


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
    X = np.cos(lat) * np.sin(lon)
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
        m1x, m1y, v1 = _hemisphere_map(
            out_w, out_h, l1.cx, l1.cy, l1.radius, fov, 0.0, l1.rot,
            src_h=top.shape[0], src_w=top.shape[1], lens_label="lens1",
        )
        m2x, m2y, v2 = _hemisphere_map(
            out_w, out_h, l2.cx, l2.cy, l2.radius, fov, 0.0, l2.rot,
            src_h=bot.shape[0], src_w=bot.shape[1], lens_label="lens2",
            body_flip=True,
        )
        front = cv2.remap(top, m1x, m1y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        back = cv2.remap(bot, m2x, m2y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        top_rot = _fisheye_remap_footprint(top, m1x, m1y, v1)
        bot_rot = _fisheye_remap_footprint(bot, m2x, m2y, v2)
    else:
        top = img[:, 0:W // 2].copy()
        bot = img[:, W // 2:W].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        l2_draw = LensCalibration(l2.cx - W // 2, l2.cy, l2.radius, l2.rot)
        m1x, m1y, v1 = _hemisphere_map(
            out_w, out_h, l1.cx, l1.cy, l1.radius, fov, 0.0, l1.rot,
            src_h=top.shape[0], src_w=top.shape[1], lens_label="lens1",
        )
        m2x, m2y, v2 = _hemisphere_map(
            out_w, out_h, l2_draw.cx, l2_draw.cy, l2_draw.radius, fov, 0.0, l2_draw.rot,
            src_h=bot.shape[0], src_w=bot.shape[1], lens_label="lens2",
            body_flip=True,
        )
        front = cv2.remap(top, m1x, m1y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        back = cv2.remap(bot, m2x, m2y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        top_rot = _fisheye_remap_footprint(top, m1x, m1y, v1)
        bot_rot = _fisheye_remap_footprint(bot, m2x, m2y, v2)

    sphere1 = front.copy()
    sphere2 = back.copy()
    sphere1[~v1] = 0
    sphere2[~v2] = 0

    overlap = v1 & v2
    if overlap.sum() > 1000:
        m_f = front[overlap].mean(axis=0) + 1e-6
        m_b = back[overlap].mean(axis=0) + 1e-6
        gain = (m_f / m_b).reshape(1, 1, 3)
        back = np.clip(back.astype(np.float32) * gain, 0, 255).astype(np.uint8)
        sphere2 = back.copy()
        sphere2[~v2] = 0

    d1 = cv2.distanceTransform(v1.astype(np.uint8), cv2.DIST_L2, 5)
    d2 = cv2.distanceTransform(v2.astype(np.uint8), cv2.DIST_L2, 5)
    w1 = d1 / (d1 + d2 + 1e-6)
    blended = (front.astype(np.float32) * w1[..., None] +
               back.astype(np.float32) * (1.0 - w1)[..., None])
    blended = np.clip(blended, 0, 255).astype(np.uint8)

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
