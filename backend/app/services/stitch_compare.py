"""
Measure relative orientation between two equirectangular panoramas.

Finds yaw/pitch/roll (degrees) that best rotate `test` to match `reference`
(ground-truth Insta360 Studio export) by minimizing photometric error on the
unit sphere — no guessed heading offsets.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class OrientationDelta:
    """Rotation (degrees) to apply to *test* so it aligns with *reference*.

    Convention matches fisheye_stitch._rot_matrix: R = Rz(roll) @ Rx(pitch) @ Ry(yaw).
    Positive yaw rotates test content toward increasing longitude.
    """
    yaw_deg: float
    pitch_deg: float
    roll_deg: float
    mse: float
    correlation: float

    def as_dict(self) -> dict[str, float]:
        return {
            "yawDeg": self.yaw_deg,
            "pitchDeg": self.pitch_deg,
            "rollDeg": self.roll_deg,
            "mse": self.mse,
            "correlation": self.correlation,
        }


def _latlon_grid(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    lon = np.linspace(-np.pi, np.pi, w, dtype=np.float32)
    lat = np.linspace(np.pi / 2, -np.pi / 2, h, dtype=np.float32)
    return np.meshgrid(lon, lat)


def _vec_from_latlon(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    return np.stack(
        [
            np.cos(lat) * np.sin(lon),
            np.sin(lat),
            np.cos(lat) * np.cos(lon),
        ],
        axis=-1,
    )


def _rot_matrix(yaw: float, pitch: float, roll: float) -> np.ndarray:
    a, b, c = np.radians(yaw), np.radians(pitch), np.radians(roll)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    Rz = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    return Rz @ Rx @ Ry


def _sample_equirect(img: np.ndarray, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Bilinear sample BGR equirect (GPano: row0=zenith)."""
    import cv2

    h, w = img.shape[:2]
    mapx = ((lon / (2 * np.pi) + 0.5) * (w - 1)).astype(np.float32)
    mapy = ((0.5 - lat / np.pi) * (h - 1)).astype(np.float32)
    return cv2.remap(img, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def _prepare_gray(img_bgr: np.ndarray, tw: int = 1024, th: int = 512) -> np.ndarray:
    import cv2

    small = cv2.resize(img_bgr, (tw, th), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0


def _metrics(ref: np.ndarray, warped: np.ndarray) -> tuple[float, float]:
    diff = ref - warped
    mse = float(np.mean(diff * diff))
    corr = float(np.corrcoef(ref.ravel(), warped.ravel())[0, 1])
    return mse, corr


def _rotate_equirect(
    img: np.ndarray,
    yaw_deg: float,
    pitch_deg: float,
    roll_deg: float,
    lon: np.ndarray,
    lat: np.ndarray,
    vecs: np.ndarray,
) -> np.ndarray:
    R = _rot_matrix(yaw_deg, pitch_deg, roll_deg)
    vin = np.einsum("ij,hwj->hwi", R.T, vecs)
    lon_in = np.arctan2(vin[..., 0], vin[..., 2])
    lat_in = np.arcsin(np.clip(vin[..., 1], -1.0, 1.0))
    return _sample_equirect(img, lon_in, lat_in)


def _gray_rotate(test_img, yaw, pitch, roll, lon, lat, vecs):
    import cv2

    warped = _rotate_equirect(test_img, yaw, pitch, roll, lon, lat, vecs)
    return cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0


def _search_best(
    ref_gray: np.ndarray,
    test_img,
    lon: np.ndarray,
    lat: np.ndarray,
    vecs: np.ndarray,
    yaw_range: tuple[float, float, float],
    pitch_range: tuple[float, float, float],
    roll_range: tuple[float, float, float],
) -> tuple[float, float, float, float, float]:
    yaw0, yaw1, yaw_step = yaw_range
    p0, p1, pstep = pitch_range
    r0, r1, rstep = roll_range
    best = (1e9, 0.0, 0.0, 0.0, 0.0)
    yaw_vals = np.arange(yaw0, yaw1 + 0.01, yaw_step)
    pitch_vals = np.arange(p0, p1 + 0.01, pstep)
    roll_vals = np.arange(r0, r1 + 0.01, rstep)
    for yaw in yaw_vals:
        for pitch in pitch_vals:
            for roll in roll_vals:
                gray = _gray_rotate(test_img, float(yaw), float(pitch), float(roll), lon, lat, vecs)
                mse, corr = _metrics(ref_gray, gray)
                if mse < best[0]:
                    best = (mse, float(yaw), float(pitch), float(roll), corr)
    return best


def estimate_orientation_delta(
    reference_bgr: np.ndarray,
    test_bgr: np.ndarray,
    *,
    coarse_yaw_step: float = 5.0,
    fine_step: float = 0.5,
) -> OrientationDelta:
    """
    Three-stage search: yaw-only coarse, local 3D coarse, local 3D fine.

    `reference_bgr` is ground truth (Insta360 Studio). `test_bgr` is our stitch.
    Returns rotation to apply to *test* toward *reference*.
    """
    import cv2

    th, tw = 384, 768
    ref = _prepare_gray(reference_bgr, tw, th)
    test_img = cv2.resize(test_bgr, (tw, th), interpolation=cv2.INTER_AREA)
    lon, lat = _latlon_grid(th, tw)
    vecs = _vec_from_latlon(lat, lon)

    # Stage 1 — yaw only (pitch=roll=0)
    best = (1e9, 0.0, 0.0, 0.0, 0.0)
    for yaw in np.arange(-180.0, 180.0, coarse_yaw_step):
        gray = _gray_rotate(test_img, float(yaw), 0.0, 0.0, lon, lat, vecs)
        mse, corr = _metrics(ref, gray)
        if mse < best[0]:
            best = (mse, float(yaw), 0.0, 0.0, corr)
    yaw = best[1]

    # Stage 2 — local 3D (coarse)
    mse, yaw, pitch, roll, corr = _search_best(
        ref, test_img, lon, lat, vecs,
        (yaw - 15.0, yaw + 15.0, coarse_yaw_step),
        (-15.0, 15.0, coarse_yaw_step),
        (-15.0, 15.0, coarse_yaw_step),
    )

    # Stage 3 — local 3D (fine)
    mse, yaw, pitch, roll, corr = _search_best(
        ref, test_img, lon, lat, vecs,
        (yaw - coarse_yaw_step, yaw + coarse_yaw_step, fine_step),
        (pitch - coarse_yaw_step, pitch + coarse_yaw_step, fine_step),
        (roll - coarse_yaw_step, roll + coarse_yaw_step, fine_step),
    )
    yaw = ((yaw + 180.0) % 360.0) - 180.0
    return OrientationDelta(yaw_deg=yaw, pitch_deg=pitch, roll_deg=roll, mse=mse, correlation=corr)


def render_aligned_preview(
    reference_bgr: np.ndarray,
    test_bgr: np.ndarray,
    delta: OrientationDelta,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (test_aligned, abs_diff) at reference resolution."""
    import cv2

    h, w = reference_bgr.shape[:2]
    test_rs = cv2.resize(test_bgr, (w, h), interpolation=cv2.INTER_AREA)
    lon, lat = _latlon_grid(h, w)
    vecs = _vec_from_latlon(lat, lon)
    aligned = _rotate_equirect(test_rs, delta.yaw_deg, delta.pitch_deg, delta.roll_deg, lon, lat, vecs)
    diff = cv2.absdiff(reference_bgr, aligned)
    return aligned, diff
