#!/usr/bin/env python3
"""
Temporary convention A/B test — does NOT modify production stitch code.

Renders four panoramas from one DNG, identical pipeline except one math change:
  1. baseline     — current v_lens = R @ v_world,  phi = atan2(Yr, Xr)
  2. r_transpose  — v_lens = R.T @ v_world
  3. phi_swap     — phi = atan2(Xr, Yr)
  4. phi_plus90   — phi = atan2(Yr, Xr) + 90°

Usage (from backend/):
  python tools/convention_stitch_compare.py \\
    --dng path/to/capture.dng \\
    --out convention_compare_01

  python tools/convention_stitch_compare.py \\
    --dng path/to/capture.dng \\
    --reference path/to/studio_export.jpg \\
    --out convention_compare_01
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


class Convention(str, Enum):
    BASELINE = "baseline"
    R_TRANSPOSE = "r_transpose"
    PHI_SWAP = "phi_swap"
    PHI_PLUS90 = "phi_plus90"


CONVENTION_LABELS = {
    Convention.BASELINE: "Baseline: R @ v, phi=atan2(Yr,Xr)",
    Convention.R_TRANSPOSE: "R.T @ v, phi=atan2(Yr,Xr)",
    Convention.PHI_SWAP: "R @ v, phi=atan2(Xr,Yr)",
    Convention.PHI_PLUS90: "R @ v, phi=atan2(Yr,Xr)+90deg",
}


@dataclass(frozen=True)
class ConventionSpec:
    use_r_transpose: bool = False
    phi_swap_xy: bool = False
    phi_offset_deg: float = 0.0


SPECS: dict[Convention, ConventionSpec] = {
    Convention.BASELINE: ConventionSpec(),
    Convention.R_TRANSPOSE: ConventionSpec(use_r_transpose=True),
    Convention.PHI_SWAP: ConventionSpec(phi_swap_xy=True),
    Convention.PHI_PLUS90: ConventionSpec(phi_offset_deg=90.0),
}


def hemisphere_map_variant(
    out_w: int,
    out_h: int,
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    yaw_offset: float,
    rot: tuple[float, float, float],
    spec: ConventionSpec,
    *,
    body_flip: bool = False,
):
    """Copy of fisheye_stitch._hemisphere_map with one convention changed."""
    import numpy as np
    from app.services.fisheye_stitch import _lens_rot_matrix

    fov = np.radians(fov_deg)
    xs = np.linspace(-np.pi, np.pi, out_w)
    ys = np.linspace(np.pi / 2, -np.pi / 2, out_h)
    lon, lat = np.meshgrid(xs, ys)
    lon = lon + yaw_offset
    X = np.cos(lat) * np.sin(lon)
    Y = np.sin(lat)
    Z = np.cos(lat) * np.cos(lon)
    R = _lens_rot_matrix(rot, body_flip=body_flip)
    vec = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=0)
    if spec.use_r_transpose:
        vr = R.T @ vec
    else:
        vr = R @ vec
    Xr, Yr, Zr = (vr[i].reshape(X.shape) for i in range(3))
    theta = np.arccos(np.clip(Zr, -1, 1))
    if spec.phi_swap_xy:
        phi = np.arctan2(Xr, Yr)
    else:
        phi = np.arctan2(Yr, Xr)
    if spec.phi_offset_deg:
        phi = phi + np.radians(spec.phi_offset_deg)
    r = radius * (theta / (fov / 2.0))
    mapx = (cx + r * np.cos(phi)).astype(np.float32)
    mapy = (cy + r * np.sin(phi)).astype(np.float32)
    valid = theta <= (fov / 2.0)
    return mapx, mapy, valid


def stitch_with_convention(
    data: bytes,
    filename: str,
    convention: Convention,
    *,
    out_w: int = 5760,
    out_h: int = 2880,
):
    """Minimal stitch path (decode, remap, blend) — no debug artifacts."""
    import cv2
    import numpy as np
    from app.services.fisheye_stitch import (
        LensCalibration,
        _decode_raw_rgb,
        _scale_lens_to_region,
        detect_model,
        parse_embedded_calibration,
        profile_for,
    )

    spec = SPECS[convention]
    calib = parse_embedded_calibration(data)
    if calib is None or calib.source != "embedded":
        raise RuntimeError("No embedded calibration in file")

    img = _decode_raw_rgb(data, filename)
    if img is None:
        raise RuntimeError(f"Could not decode {filename}")

    prof = profile_for(detect_model(data))
    fov = prof.fisheye_fov_deg
    H, W = img.shape[:2]
    sx_full = W / calib.width if calib.width else 1.0
    sy_full = H / calib.height if calib.height else 1.0

    def map_lens(cx, cy, radius, rot, body_flip, src_h, src_w):
        return hemisphere_map_variant(
            out_w, out_h, cx, cy, radius, fov, 0.0, rot, spec,
            body_flip=body_flip,
        )

    if calib.layout == "top-bottom":
        top = img[0 : H // 2, :].copy()
        bot = img[H // 2 : H, :].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        m1x, m1y, v1 = map_lens(l1.cx, l1.cy, l1.radius, l1.rot, False, top.shape[0], top.shape[1])
        m2x, m2y, v2 = map_lens(l2.cx, l2.cy, l2.radius, l2.rot, True, bot.shape[0], bot.shape[1])
    else:
        top = img[:, 0 : W // 2].copy()
        bot = img[:, W // 2 : W].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        l2_draw = LensCalibration(l2.cx - W // 2, l2.cy, l2.radius, l2.rot)
        m1x, m1y, v1 = map_lens(l1.cx, l1.cy, l1.radius, l1.rot, False, top.shape[0], top.shape[1])
        m2x, m2y, v2 = map_lens(
            l2_draw.cx, l2_draw.cy, l2_draw.radius, l2_draw.rot, True, bot.shape[0], bot.shape[1],
        )

    front = cv2.remap(top, m1x, m1y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    back = cv2.remap(bot, m2x, m2y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

    overlap = v1 & v2
    if overlap.sum() > 1000:
        m_f = front[overlap].mean(axis=0) + 1e-6
        m_b = back[overlap].mean(axis=0) + 1e-6
        gain = (m_f / m_b).reshape(1, 1, 3)
        back = np.clip(back.astype(np.float32) * gain, 0, 255).astype(np.uint8)

    d1 = cv2.distanceTransform(v1.astype(np.uint8), cv2.DIST_L2, 5)
    d2 = cv2.distanceTransform(v2.astype(np.uint8), cv2.DIST_L2, 5)
    w1 = d1 / (d1 + d2 + 1e-6)
    blended = (
        front.astype(np.float32) * w1[..., None]
        + back.astype(np.float32) * (1.0 - w1)[..., None]
    )
    return np.clip(blended, 0, 255).astype(np.uint8)


def _load_bgr(path: Path):
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"Could not read image: {path}")
    return img


def _save_png(path: Path, img) -> None:
    import cv2

    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), img):
        raise RuntimeError(f"Failed to write {path}")


def _label_bar(width: int, text: str, bar_h: int = 36):
    import cv2
    import numpy as np

    bar = np.zeros((bar_h, width, 3), dtype=np.uint8)
    bar[:] = (32, 32, 32)
    cv2.putText(bar, text, (8, bar_h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1, cv2.LINE_AA)
    return bar


def build_side_by_side(panoramas: dict[Convention, object], thumb_h: int = 720):
    import cv2
    import numpy as np

    panels: list = []
    for conv in Convention:
        img = panoramas[conv]
        h, w = img.shape[:2]
        thumb_w = int(round(w * (thumb_h / h)))
        thumb = cv2.resize(img, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        bar = _label_bar(thumb_w, CONVENTION_LABELS[conv])
        panels.append(np.vstack([bar, thumb]))
    max_h = max(p.shape[0] for p in panels)
    padded = []
    for p in panels:
        if p.shape[0] < max_h:
            pad = np.zeros((max_h - p.shape[0], p.shape[1], 3), dtype=np.uint8)
            p = np.vstack([p, pad])
        padded.append(p)
    return np.hstack(padded)


def _delta_dict(delta) -> dict:
    return {
        "yaw_deg": delta.yaw_deg,
        "pitch_deg": delta.pitch_deg,
        "roll_deg": delta.roll_deg,
        "mse": delta.mse,
        "correlation": delta.correlation,
        "abs_sum_deg": abs(delta.yaw_deg) + abs(delta.pitch_deg) + abs(delta.roll_deg),
    }


def format_report(report: dict) -> str:
    lines = [
        "Convention stitch comparison (temporary analysis)",
        "",
        f"DNG: {report['dng']}",
        f"Output size: {report['output_width']}x{report['output_height']}",
        "",
        "Orientation delta = rotation (yaw, pitch, roll) to apply to COLUMN panorama",
        "so it matches the ROW reference (same convention as stitch_compare).",
        "",
        "── vs baseline ──",
    ]
    for conv in Convention:
        if conv == Convention.BASELINE:
            continue
        d = report["vs_baseline"][conv.value]
        lines.append(
            f"  {conv.value:12s}  yaw={d['yaw_deg']:+7.2f}  pitch={d['pitch_deg']:+7.2f}  "
            f"roll={d['roll_deg']:+7.2f}  |sum|={d['abs_sum_deg']:.2f}  corr={d['correlation']:.4f}"
        )
    if report.get("vs_studio"):
        lines.extend(["", "── vs Insta360 Studio reference ──"])
        for conv in Convention:
            d = report["vs_studio"][conv.value]
            lines.append(
                f"  {conv.value:12s}  yaw={d['yaw_deg']:+7.2f}  pitch={d['pitch_deg']:+7.2f}  "
                f"roll={d['roll_deg']:+7.2f}  |sum|={d['abs_sum_deg']:.2f}  "
                f"mse={d['mse']:.6f}  corr={d['correlation']:.4f}"
            )
        best = report.get("best_match_studio")
        if best:
            lines.extend([
                "",
                f"Closest to Studio (smallest |yaw|+|pitch|+|roll|): {best['convention']}",
                f"  yaw={best['yaw_deg']:+.2f}  pitch={best['pitch_deg']:+.2f}  "
                f"roll={best['roll_deg']:+.2f}  corr={best['correlation']:.4f}",
            ])
    lines.append("")
    return "\n".join(lines)


def _resize_for_compare(img, max_w: int = 1920):
    import cv2

    h, w = img.shape[:2]
    if w <= max_w:
        return img
    nh = int(round(h * (max_w / w)))
    return cv2.resize(img, (max_w, nh), interpolation=cv2.INTER_AREA)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare stitch math conventions (temporary)")
    parser.add_argument("--dng", type=Path, required=True, help="Input DNG path")
    parser.add_argument("--reference", type=Path, default=None, help="Insta360 Studio export (JPG/PNG)")
    parser.add_argument("--out", type=Path, required=True, help="Output directory")
    parser.add_argument("--width", type=int, default=2880, help="Equirect width (default 2880 for speed)")
    parser.add_argument("--height", type=int, default=1440, help="Equirect height (default 1440 for speed)")
    args = parser.parse_args()

    if not args.dng.is_file():
        raise SystemExit(f"DNG not found: {args.dng}")

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = args.dng.read_bytes()

    print(f"Rendering 4 conventions from {args.dng.name} ...", flush=True)
    panoramas: dict[Convention, object] = {}
    for conv in Convention:
        print(f"  {conv.value} ...", flush=True)
        pano = stitch_with_convention(
            raw, args.dng.name, conv, out_w=args.width, out_h=args.height,
        )
        panoramas[conv] = pano
        _save_png(out_dir / f"convention_{conv.value}.png", pano)

    grid = build_side_by_side(panoramas)
    _save_png(out_dir / "convention_side_by_side.png", grid)

    from app.services.stitch_compare import estimate_orientation_delta

    baseline = _resize_for_compare(panoramas[Convention.BASELINE])
    compare_set = {c: _resize_for_compare(panoramas[c]) for c in Convention}
    report: dict = {
        "dng": str(args.dng.resolve()),
        "output_width": args.width,
        "output_height": args.height,
        "conventions": {c.value: CONVENTION_LABELS[c] for c in Convention},
        "vs_baseline": {},
    }

    print("Computing orientation delta vs baseline ...", flush=True)
    for conv in Convention:
        if conv == Convention.BASELINE:
            report["vs_baseline"][conv.value] = {
                "yaw_deg": 0.0, "pitch_deg": 0.0, "roll_deg": 0.0,
                "mse": 0.0, "correlation": 1.0, "abs_sum_deg": 0.0,
            }
            continue
        delta = estimate_orientation_delta(
            baseline, compare_set[conv],
            coarse_yaw_step=10.0,
            fine_step=2.0,
        )
        report["vs_baseline"][conv.value] = _delta_dict(delta)

    if args.reference is not None:
        if not args.reference.is_file():
            raise SystemExit(f"Reference not found: {args.reference}")
        ref = _load_bgr(args.reference)
        _save_png(out_dir / "reference_studio.png", ref)
        report["reference"] = str(args.reference.resolve())
        report["vs_studio"] = {}
        print(f"Computing orientation delta vs Studio: {args.reference.name} ...", flush=True)
        ref_cmp = _resize_for_compare(ref)
        best_name = None
        best_sum = 1e9
        best_entry = None
        for conv in Convention:
            delta = estimate_orientation_delta(
                ref_cmp, compare_set[conv],
                coarse_yaw_step=10.0,
                fine_step=2.0,
            )
            entry = _delta_dict(delta)
            report["vs_studio"][conv.value] = entry
            if entry["abs_sum_deg"] < best_sum:
                best_sum = entry["abs_sum_deg"]
                best_name = conv.value
                best_entry = {"convention": conv.value, **entry}
        report["best_match_studio"] = best_entry

    txt = format_report(report)
    (out_dir / "convention_compare_report.txt").write_text(txt + "\n", encoding="utf-8")
    (out_dir / "convention_compare_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("")
    print(txt)
    print(f"\nWrote {out_dir / 'convention_side_by_side.png'}")


if __name__ == "__main__":
    main()
