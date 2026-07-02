#!/usr/bin/env python3
"""
Temporary axis-convention sweep — does NOT modify production stitch code.

Identical to fisheye_stitch._hemisphere_map except world-vector construction
before R_eff. Tests all right-handed (X,Y,Z) permutations with sign flips.

Usage (from backend/):
  python tools/axis_convention_compare.py \\
    --dng path/to/capture.dng \\
    --reference path/to/studio_export.jpg \\
    --out axis_convention_compare_01
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
from dataclasses import dataclass
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# Standard GPano sphere components (production _hemisphere_map, before permutation).
COMP_NAMES = ("sin_lon_cos_lat", "sin_lat", "cos_lon_cos_lat")
AXIS_NAMES = ("X", "Y", "Z")

# Production baseline: X=c0, Y=c1, Z=c2, all positive.
BASELINE_PERM = (0, 1, 2)
BASELINE_SIGNS = (1, 1, 1)


@dataclass(frozen=True)
class AxisConvention:
    """Assign sphere components to world (X,Y,Z) with per-axis sign."""

    perm: tuple[int, int, int]  # perm[axis] = component index for X,Y,Z
    signs: tuple[int, int, int]  # +1 or -1 per axis

    @property
    def id(self) -> str:
        parts = []
        for ax, name in enumerate(AXIS_NAMES):
            comp = COMP_NAMES[self.perm[ax]]
            sign = "+" if self.signs[ax] > 0 else "-"
            parts.append(f"{name}={sign}{comp}")
        return ",".join(parts)

    def is_baseline(self) -> bool:
        return self.perm == BASELINE_PERM and self.signs == BASELINE_SIGNS


def _right_handed_at_origin(perm: tuple[int, int, int], signs: tuple[int, int, int]) -> bool:
    """Check X×Y·Z > 0 using ∂w/∂lon, ∂w/∂lat, w at lon=0, lat=0."""
    import numpy as np

    # d(component)/dlon at origin: [1,0,0] for (c0,c1,c2)
    # d(component)/dlat at origin: [0,1,0]
    dlon = [1 if perm[ax] == 0 else 0 for ax in range(3)]
    dlat = [1 if perm[ax] == 1 else 0 for ax in range(3)]
    w0 = [1 if perm[ax] == 2 else 0 for ax in range(3)]

    t_lon = np.array([signs[ax] * dlon[ax] for ax in range(3)], dtype=np.float64)
    t_lat = np.array([signs[ax] * dlat[ax] for ax in range(3)], dtype=np.float64)
    w = np.array([signs[ax] * w0[ax] for ax in range(3)], dtype=np.float64)
    return float(np.dot(np.cross(t_lon, t_lat), w)) > 0.0


def enumerate_right_handed_conventions() -> list[AxisConvention]:
    out: list[AxisConvention] = []
    for perm in itertools.permutations((0, 1, 2)):
        for signs in itertools.product((1, -1), repeat=3):
            if _right_handed_at_origin(perm, signs):
                out.append(AxisConvention(perm=perm, signs=signs))
    return out


def world_vectors_from_lonlat(lon, lat, conv: AxisConvention):
    """Build world (X,Y,Z) from equirect lon/lat under ``conv``."""
    import numpy as np

    c0 = np.cos(lat) * np.sin(lon)
    c1 = np.sin(lat)
    c2 = np.cos(lat) * np.cos(lon)
    comps = (c0, c1, c2)
    wx = conv.signs[0] * comps[conv.perm[0]]
    wy = conv.signs[1] * comps[conv.perm[1]]
    wz = conv.signs[2] * comps[conv.perm[2]]
    return wx, wy, wz


def hemisphere_map_axis_convention(
    out_w: int,
    out_h: int,
    cx: float,
    cy: float,
    radius: float,
    fov_deg: float,
    yaw_offset: float,
    rot: tuple[float, float, float],
    conv: AxisConvention,
    *,
    body_flip: bool = False,
):
    """Copy of _hemisphere_map with only world-vector construction changed."""
    import numpy as np
    from app.services.fisheye_stitch import _lens_rot_matrix

    fov = np.radians(fov_deg)
    xs = np.linspace(-np.pi, np.pi, out_w)
    ys = np.linspace(np.pi / 2, -np.pi / 2, out_h)
    lon, lat = np.meshgrid(xs, ys)
    lon = lon + yaw_offset
    X, Y, Z = world_vectors_from_lonlat(lon, lat, conv)
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
    return mapx, mapy, valid


def stitch_with_axis_convention(
    data: bytes,
    filename: str,
    conv: AxisConvention,
    *,
    out_w: int = 2880,
    out_h: int = 1440,
):
    """Minimal stitch: decode, remap, blend — same as production except world axes."""
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

    def map_lens(cx, cy, radius, rot, body_flip):
        return hemisphere_map_axis_convention(
            out_w, out_h, cx, cy, radius, fov, 0.0, rot, conv, body_flip=body_flip,
        )

    if calib.layout == "top-bottom":
        top = img[0 : H // 2, :].copy()
        bot = img[H // 2 : H, :].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        m1x, m1y, v1 = map_lens(l1.cx, l1.cy, l1.radius, l1.rot, False)
        m2x, m2y, v2 = map_lens(l2.cx, l2.cy, l2.radius, l2.rot, True)
    else:
        top = img[:, 0 : W // 2].copy()
        bot = img[:, W // 2 : W].copy()
        l1 = _scale_lens_to_region(calib.lens1, sx_full, sy_full)
        l2 = _scale_lens_to_region(calib.lens2, sx_full, sy_full)
        l2_draw = LensCalibration(l2.cx - W // 2, l2.cy, l2.radius, l2.rot)
        m1x, m1y, v1 = map_lens(l1.cx, l1.cy, l1.radius, l1.rot, False)
        m2x, m2y, v2 = map_lens(
            l2_draw.cx, l2_draw.cy, l2_draw.radius, l2_draw.rot, True,
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


def _resize_for_compare(img, max_w: int = 1920):
    import cv2

    h, w = img.shape[:2]
    if w <= max_w:
        return img
    nh = int(round(h * (max_w / w)))
    return cv2.resize(img, (max_w, nh), interpolation=cv2.INTER_AREA)


def _gray_correlation(a, b) -> float:
    import cv2
    import numpy as np

    ha, wa = a.shape[:2]
    hb, wb = b.shape[:2]
    if (ha, wa) != (hb, wb):
        b = cv2.resize(b, (wa, ha), interpolation=cv2.INTER_AREA)
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32).ravel()
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32).ravel()
    if ga.std() < 1e-6 or gb.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(ga, gb)[0, 1])


def _delta_entry(delta) -> dict:
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
        "Axis convention comparison (world vector before R_eff only)",
        "",
        f"DNG: {report['dng']}",
        f"Output: {report['output_width']}x{report['output_height']}",
        f"Conventions tested: {report['convention_count']} (right-handed)",
        f"Production baseline: {report['baseline_id']}",
        "",
    ]
    if report.get("reference"):
        lines.append(f"Studio reference: {report['reference']}")
        lines.append("")
        lines.append("Ranked vs Studio (best first):")
        lines.append(
            f"{'rank':>4}  {'id':<52}  {'yaw':>7} {'pitch':>7} {'roll':>7}  "
            f"{'|sum|':>6}  {'corr':>6}  {'mse':>8}"
        )
        for i, row in enumerate(report["ranked_vs_studio"], 1):
            d = row["vs_studio"]
            mark = " *" if row["is_baseline"] else ""
            lines.append(
                f"{i:4d}  {row['id']:<52}  "
                f"{d['yaw_deg']:+7.2f} {d['pitch_deg']:+7.2f} {d['roll_deg']:+7.2f}  "
                f"{d['abs_sum_deg']:6.2f}  {d['correlation']:6.4f}  {d['mse']:8.6f}{mark}"
            )
        best = report.get("best_vs_studio")
        if best:
            lines.extend([
                "",
                f"Best match vs Studio: {best['id']}",
                f"  yaw={best['vs_studio']['yaw_deg']:+.2f}  "
                f"pitch={best['vs_studio']['pitch_deg']:+.2f}  "
                f"roll={best['vs_studio']['roll_deg']:+.2f}  "
                f"corr={best['vs_studio']['correlation']:.4f}",
            ])
            if best["is_baseline"]:
                lines.append("  (same as production baseline)")
            else:
                lines.append("  (differs from production baseline)")
    else:
        lines.append("No Studio reference supplied — per-convention vs-baseline deltas only.")
        lines.append("")
    lines.append("")
    lines.append("── All conventions (sorted by |yaw|+|pitch|+|roll| vs Studio or baseline) ──")
    for row in report["all_results"]:
        d = row.get("vs_studio") or row.get("vs_baseline")
        ref = "studio" if row.get("vs_studio") else "baseline"
        lines.append(
            f"  {row['id']:<52}  vs_{ref}  "
            f"yaw={d['yaw_deg']:+.2f} pitch={d['pitch_deg']:+.2f} roll={d['roll_deg']:+.2f}  "
            f"corr={d['correlation']:.4f}"
        )
    return "\n".join(lines).rstrip()


def main() -> None:
    import numpy as np
    from app.services.fisheye_stitch import _save_png
    from app.services.stitch_compare import estimate_orientation_delta

    parser = argparse.ArgumentParser(description="Sweep right-handed world axis conventions")
    parser.add_argument("--dng", type=Path, required=True)
    parser.add_argument("--reference", type=Path, default=None, help="Insta360 Studio export")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--width", type=int, default=2880)
    parser.add_argument("--height", type=int, default=1440)
    parser.add_argument(
        "--save-pngs",
        action="store_true",
        help="Save every convention panorama (24 PNGs)",
    )
    parser.add_argument(
        "--save-top",
        type=int,
        default=3,
        help="Save top N ranked PNGs when --reference is set (0=none)",
    )
    args = parser.parse_args()

    if not args.dng.is_file():
        raise SystemExit(f"DNG not found: {args.dng}")

    conventions = enumerate_right_handed_conventions()
    baseline_conv = next(c for c in conventions if c.is_baseline())

    args.out.mkdir(parents=True, exist_ok=True)
    raw = args.dng.read_bytes()

    ref_img = None
    ref_cmp = None
    if args.reference is not None:
        if not args.reference.is_file():
            raise SystemExit(f"Reference not found: {args.reference}")
        ref_img = _load_bgr(args.reference)
        ref_cmp = _resize_for_compare(ref_img)

    print(f"Testing {len(conventions)} right-handed conventions ...", flush=True)
    panoramas: dict[str, object] = {}
    results: list[dict] = []

    for i, conv in enumerate(conventions, 1):
        print(f"  [{i}/{len(conventions)}] {conv.id}", flush=True)
        pano = stitch_with_axis_convention(
            raw, args.dng.name, conv, out_w=args.width, out_h=args.height,
        )
        panoramas[conv.id] = pano
        pano_cmp = _resize_for_compare(pano)

        entry: dict = {
            "id": conv.id,
            "perm": list(conv.perm),
            "signs": list(conv.signs),
            "is_baseline": conv.is_baseline(),
        }

        if ref_cmp is not None:
            delta = estimate_orientation_delta(
                ref_cmp, pano_cmp, coarse_yaw_step=10.0, fine_step=2.0,
            )
            entry["vs_studio"] = _delta_entry(delta)
            entry["vs_studio"]["direct_correlation"] = _gray_correlation(ref_cmp, pano_cmp)
        results.append(entry)

    # Baseline panorama for vs_baseline deltas
    baseline_pano = panoramas[baseline_conv.id]
    baseline_cmp = _resize_for_compare(baseline_pano)
    for entry in results:
        cid = entry["id"]
        if entry["is_baseline"]:
            entry["vs_baseline"] = {
                "yaw_deg": 0.0, "pitch_deg": 0.0, "roll_deg": 0.0,
                "mse": 0.0, "correlation": 1.0, "abs_sum_deg": 0.0,
            }
        else:
            delta = estimate_orientation_delta(
                baseline_cmp, _resize_for_compare(panoramas[cid]),
                coarse_yaw_step=10.0, fine_step=2.0,
            )
            entry["vs_baseline"] = _delta_entry(delta)

    ranked_vs_studio: list[dict] = []
    best_vs_studio = None
    if ref_cmp is not None:
        ranked_vs_studio = sorted(
            results,
            key=lambda r: (
                r["vs_studio"]["abs_sum_deg"],
                -r["vs_studio"]["correlation"],
                r["vs_studio"]["mse"],
            ),
        )
        best_vs_studio = ranked_vs_studio[0]

    sort_key = (
        (lambda r: (r["vs_studio"]["abs_sum_deg"], -r["vs_studio"]["correlation"]))
        if ref_cmp is not None
        else (lambda r: r["vs_baseline"]["abs_sum_deg"])
    )
    all_sorted = sorted(results, key=sort_key)

    report = {
        "dng": str(args.dng.resolve()),
        "reference": str(args.reference.resolve()) if args.reference else None,
        "output_width": args.width,
        "output_height": args.height,
        "convention_count": len(conventions),
        "baseline_id": baseline_conv.id,
        "ranked_vs_studio": ranked_vs_studio,
        "best_vs_studio": best_vs_studio,
        "all_results": all_sorted,
        "results": results,
    }

    txt = format_report(report)
    (args.out / "axis_convention_compare_report.txt").write_text(txt + "\n", encoding="utf-8")
    (args.out / "axis_convention_compare_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8",
    )

    if args.save_pngs:
        png_dir = args.out / "panoramas"
        png_dir.mkdir(parents=True, exist_ok=True)
        for cid, pano in panoramas.items():
            safe = cid.replace(",", "_").replace("=", "_").replace("+", "p").replace("-", "m")
            _save_png(png_dir / f"{safe}.png", pano)

    if args.save_top > 0 and ranked_vs_studio:
        top_dir = args.out / "top_ranked"
        top_dir.mkdir(parents=True, exist_ok=True)
        for rank, row in enumerate(ranked_vs_studio[: args.save_top], 1):
            cid = row["id"]
            safe = f"{rank:02d}_{cid.replace(',', '_').replace('=', '_').replace('+', 'p').replace('-', 'm')}"
            _save_png(top_dir / f"{safe}.png", panoramas[cid])

    _save_png(args.out / "baseline_production.png", baseline_pano)
    if ref_img is not None:
        _save_png(args.out / "reference_studio.png", ref_img)

    print("")
    print(txt)
    print(f"\nWrote {args.out / 'axis_convention_compare_report.txt'}")


if __name__ == "__main__":
    main()
