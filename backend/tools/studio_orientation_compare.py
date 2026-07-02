"""Compare a production stitch against an Insta360 Studio equirectangular export.

Usage:
    python tools/studio_orientation_compare.py <raw .dng/.insp> <studio_export.jpg> <out_prefix>

Reports the rigid rotation (yaw / pitch / roll) between the two panoramas via
ORB features -> unit direction vectors -> RANSAC + Kabsch, then rotation-aligns
our output, exposure-normalizes it, and reports SSIM / PSNR / correlation.

NOTE: the Studio file must be a STITCHED equirectangular export (~2:1 with
filled corners), not the raw dual-fisheye. The script refuses dual-fisheye
inputs (dark corners) since a rigid-rotation comparison is meaningless there.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.fisheye_stitch import stitch_equirectangular  # noqa: E402
from app.services.panorama_service import classify_projection_bgr  # noqa: E402

W, H = 2880, 1440


def to_dirs(pts: np.ndarray, w: int, h: int) -> np.ndarray:
    lon = pts[:, 0] / (w - 1) * 2 * np.pi - np.pi
    lat = np.pi / 2 - pts[:, 1] / (h - 1) * np.pi
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], 1)


def kabsch(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    Hm = src.T @ dst
    U, _, Vt = np.linalg.svd(Hm)
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    return Vt.T @ D @ U.T


def decompose_zxy(R: np.ndarray) -> tuple[float, float, float, float]:
    """R = Rz(roll) @ Rx(pitch) @ Ry(yaw) — the calibration convention."""
    pitch = np.degrees(np.arcsin(np.clip(R[2, 1], -1, 1)))
    yaw = np.degrees(np.arctan2(-R[2, 0], R[2, 2]))
    roll = np.degrees(np.arctan2(-R[0, 1], R[1, 1]))
    ang = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
    return yaw, pitch, roll, ang


def main() -> None:
    raw_path, studio_path, out_prefix = sys.argv[1:4]

    res = stitch_equirectangular(Path(raw_path).read_bytes(), Path(raw_path).name)
    if res is None:
        raise SystemExit("stitch failed for " + raw_path)
    ours = cv2.imdecode(np.frombuffer(res.processed_image, np.uint8), cv2.IMREAD_COLOR)
    ours = cv2.resize(ours, (W, H), interpolation=cv2.INTER_AREA)

    studio_full = cv2.imread(studio_path)
    if studio_full is None:
        raise SystemExit("could not read " + studio_path)
    if classify_projection_bgr(studio_full) != "equirectangular":
        raise SystemExit(
            f"{studio_path} does not look like a stitched equirectangular export "
            "(dual-fisheye or non-2:1). Export the stitched panorama from "
            "Insta360 Studio and retry."
        )
    studio = cv2.resize(studio_full, (W, H), interpolation=cv2.INTER_AREA)

    orb = cv2.ORB_create(nfeatures=6000)
    k1, d1 = orb.detectAndCompute(cv2.cvtColor(ours, cv2.COLOR_BGR2GRAY), None)
    k2, d2 = orb.detectAndCompute(cv2.cvtColor(studio, cv2.COLOR_BGR2GRAY), None)
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
    matches = sorted(matches, key=lambda m: m.distance)[:1500]
    v1 = to_dirs(np.float32([k1[m.queryIdx].pt for m in matches]), W, H)
    v2 = to_dirs(np.float32([k2[m.trainIdx].pt for m in matches]), W, H)
    print(f"features: ours={len(k1)} studio={len(k2)} matches={len(matches)}")

    rng = np.random.default_rng(3)
    best_inl, thr = None, np.cos(np.radians(1.0))
    for _ in range(4000):
        idx = rng.choice(len(v1), 3, replace=False)
        R = kabsch(v1[idx], v2[idx])
        inl = np.sum((v1 @ R.T) * v2, axis=1) > thr
        if best_inl is None or inl.sum() > best_inl.sum():
            best_inl = inl
    R = kabsch(v1[best_inl], v2[best_inl])
    inl = np.sum((v1 @ R.T) * v2, axis=1) > np.cos(np.radians(0.75))
    if inl.sum() < 20:
        print(f"WARNING: only {int(inl.sum())} inliers — rotation estimate unreliable "
              "(images may not share a rigid-rotation relation).")
    R = kabsch(v1[inl], v2[inl])
    resid = np.degrees(np.arccos(np.clip(np.sum((v1[inl] @ R.T) * v2[inl], 1), -1, 1)))
    yaw, pitch, roll, ang = decompose_zxy(R)
    print(f"RANSAC inliers={int(inl.sum())}/{len(v1)}  mean residual={resid.mean():.3f} deg")
    print(f"rotation ours->studio: yaw={yaw:+.3f}  pitch={pitch:+.3f}  roll={roll:+.3f}  total={ang:.3f} deg")

    lon = np.linspace(-np.pi, np.pi, W)
    lat = np.linspace(np.pi / 2, -np.pi / 2, H)
    lon, lat = np.meshgrid(lon, lat)
    d = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], 0).reshape(3, -1)
    Xs, Ys, Zs = (R.T @ d).reshape(3, H, W)
    mx = ((np.arctan2(Xs, Zs) + np.pi) / (2 * np.pi) * (W - 1)).astype(np.float32)
    my = ((np.pi / 2 - np.arcsin(np.clip(Ys, -1, 1))) / np.pi * (H - 1)).astype(np.float32)
    aligned = cv2.remap(ours, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)

    a = aligned.astype(np.float64)
    b = studio.astype(np.float64)
    for c in range(3):
        a[..., c] = (a[..., c] - a[..., c].mean()) / (a[..., c].std() + 1e-9) * b[..., c].std() + b[..., c].mean()
    a = np.clip(a, 0, 255)

    mse = np.mean((a - b) ** 2)
    psnr = 10 * np.log10(255 ** 2 / mse) if mse else float("inf")
    corr = np.corrcoef(a.ravel(), b.ravel())[0, 1]
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ssims = []
    for c in range(3):
        x, y = a[..., c], b[..., c]
        mux = cv2.GaussianBlur(x, (11, 11), 1.5)
        muy = cv2.GaussianBlur(y, (11, 11), 1.5)
        sxx = cv2.GaussianBlur(x * x, (11, 11), 1.5) - mux ** 2
        syy = cv2.GaussianBlur(y * y, (11, 11), 1.5) - muy ** 2
        sxy = cv2.GaussianBlur(x * y, (11, 11), 1.5) - mux * muy
        s = ((2 * mux * muy + C1) * (2 * sxy + C2)) / ((mux ** 2 + muy ** 2 + C1) * (sxx + syy + C2))
        ssims.append(float(s.mean()))
    print(f"after alignment + exposure normalization: PSNR={psnr:.2f} dB  "
          f"SSIM={np.mean(ssims):.4f}  corr={corr:.5f}")

    cv2.imwrite(out_prefix + "_ours_aligned.jpg", a.astype(np.uint8))
    cv2.imwrite(out_prefix + "_studio.jpg", studio)


if __name__ == "__main__":
    main()
