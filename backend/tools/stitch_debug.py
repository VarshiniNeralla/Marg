#!/usr/bin/env python3
"""
Debug the Insta360 DNG stitcher and compare against Insta360 Studio export.

Usage (from backend/ with venv active):

  python tools/stitch_debug.py --dng path/to/capture.dng --out debug_run_01

  python tools/stitch_debug.py \\
    --dng path/to/capture.dng \\
    --reference path/to/studio_export.jpg \\
    --out debug_run_01

Outputs (in --out directory):
  01_raw_decoded.png
  02_top_fisheye.png              — crop + calibration overlay
  03_bottom_fisheye.png
  04_top_fisheye_after_rotation.png — remap footprint + fisheye circle + ±X/±Y/±Z markers
  05_bottom_fisheye_after_rotation.png — same for lens2
  world_direction_fisheye.txt / .json — pixel coords + validation summary
  projection_validation_lens1.png — rainbow theta rays + 15° equidistant rings (lens1)
  projection_validation_lens2.png — same for lens2
  ray_pipeline_trace.txt / .json — one world ray through every frame (matrices + values)
  06_sphere_lens1_only.png
  07_sphere_lens1_grid.png          — equator + prime meridian overlay
  08_sphere_lens2_only.png
  09_sphere_lens2_grid.png
  10_final_blended.png
  11_final_blended_grid.png
  ownership_lens1.png               — binary mask (white = lens1 valid)
  ownership_lens2.png               — binary mask (white = lens2 valid)
  blend_weight_lens1.png            — w1 heatmap (1=lens1, 0=lens2)
  ownership_composite.png           — R=lens1 only, G=overlap, B=lens2 only
  hemisphere_ownership.txt / .json  — exclusive/overlap % and rotation hypotheses
  12_world_frame_on_blend.png       — ±X/±Y/±Z markers + lens axes on blended stitch
  13_final_blended_latlon_grid.png  — 30° lon/lat grid on 10_final_blended.png
  world_frame_measurements.txt      — lon/lat, seam, body-flip axis
  stitch_metadata.json

With --reference (Studio export):
  12_reference_studio.png
  13_test_aligned_to_reference.png
  14_abs_diff.png
  orientation_delta.json            — computed yaw/pitch/roll (degrees)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Allow running as `python tools/stitch_debug.py` from backend/
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.fisheye_stitch import (  # noqa: E402
    _overlay_equirect_horizon_equator,
    _save_png,
    stitch_equirectangular_debug,
)
from app.services.stitch_compare import (  # noqa: E402
    estimate_orientation_delta,
    render_aligned_preview,
)


def _load_bgr(path: Path):
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"Could not read image: {path}")
    return img


def main() -> None:
    parser = argparse.ArgumentParser(description="Debug Insta360 fisheye stitcher")
    parser.add_argument("--dng", required=True, type=Path, help="Input .dng / .insp file")
    parser.add_argument("--out", required=True, type=Path, help="Output directory for PNGs")
    parser.add_argument(
        "--reference",
        type=Path,
        default=None,
        help="Insta360 Studio equirectangular export of the same capture (ground truth)",
    )
    parser.add_argument("--width", type=int, default=5760, help="Output equirect width")
    parser.add_argument("--height", type=int, default=2880, help="Output equirect height")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not args.dng.is_file():
        raise SystemExit(f"Input not found: {args.dng}")

    raw = args.dng.read_bytes()
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Stitching {args.dng.name} → {out_dir}")
    artifacts = stitch_equirectangular_debug(
        raw,
        args.dng.name,
        out_dir,
        out_w=args.width,
        out_h=args.height,
    )
    if artifacts is None:
        raise SystemExit("Stitch failed (no calibration or decode error).")

    print("Wrote intermediate PNGs:")
    for name in sorted(out_dir.glob("*.png")):
        print(f"  {name.name}")

    if args.reference is None:
        print("\nNo --reference provided. Add Insta360 Studio export to compute orientation delta.")
        return

    if not args.reference.is_file():
        raise SystemExit(f"Reference not found: {args.reference}")

    ref = _load_bgr(args.reference)
    test = artifacts.blended
    _save_png(out_dir / "12_reference_studio.png", _overlay_equirect_horizon_equator(ref))

    print(f"\nComparing against Studio reference: {args.reference.name}")
    print("Searching rotation (yaw, pitch, roll) that aligns our stitch to Studio...")
    delta = estimate_orientation_delta(ref, test)
    aligned, diff = render_aligned_preview(ref, test, delta)

    _save_png(out_dir / "13_test_aligned_to_reference.png", _overlay_equirect_horizon_equator(aligned))
    _save_png(out_dir / "14_abs_diff.png", diff)

    report = {
        "description": (
            "Rotation (degrees) to apply to OUR stitch so it matches the Studio reference. "
            "Convention: R = Rz(roll) @ Rx(pitch) @ Ry(yaw), same as fisheye_stitch._rot_matrix."
        ),
        "reference": str(args.reference.resolve()),
        "dng": str(args.dng.resolve()),
        **delta.as_dict(),
    }
    report_path = out_dir / "orientation_delta.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("\n── Orientation delta (our stitch → Studio) ──")
    print(f"  yaw:   {delta.yaw_deg:+.2f}°")
    print(f"  pitch: {delta.pitch_deg:+.2f}°")
    print(f"  roll:  {delta.roll_deg:+.2f}°")
    print(f"  MSE:   {delta.mse:.6f}")
    print(f"  corr:  {delta.correlation:.4f}")
    print(f"\nWrote {report_path}")


if __name__ == "__main__":
    main()
