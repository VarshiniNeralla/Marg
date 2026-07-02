#!/usr/bin/env python3
"""
Verify dual-fisheye lens optical-axis directions against stitcher conventions.

Measurement only — does not change any stitching equations.

Usage (from backend/):

  python tools/orientation_verify.py --dng path/to/capture.dng --out orientation_check

  python tools/orientation_verify.py \\
    --dng path/to/capture.dng \\
    --background path/to/11_final_blended.png \\
    --out orientation_check

Outputs in --out:
  orientation_report.txt   — human-readable axis vectors and separations
  orientation_report.json
  orientation_axes.png     — equator, meridian, forward, lens1/2 optical axes
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.orientation_verify import (  # noqa: E402
    format_orientation_report,
    verify_from_raw_bytes,
)


def _load_bgr(path: Path):
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"Could not read image: {path}")
    return img


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Measure lens optical axes using current stitcher rotation conventions",
    )
    parser.add_argument("--dng", required=True, type=Path, help="Input .dng / .insp file")
    parser.add_argument("--out", required=True, type=Path, help="Output directory")
    parser.add_argument(
        "--background",
        type=Path,
        default=None,
        help="Optional equirect PNG to draw axes on top of (e.g. blended stitch)",
    )
    parser.add_argument("--width", type=int, default=2048, help="Diagram width")
    parser.add_argument("--height", type=int, default=1024, help="Diagram height")
    args = parser.parse_args()

    if not args.dng.is_file():
        raise SystemExit(f"Input not found: {args.dng}")

    bg = None
    if args.background is not None:
        if not args.background.is_file():
            raise SystemExit(f"Background not found: {args.background}")
        bg = _load_bgr(args.background)

    raw = args.dng.read_bytes()
    report = verify_from_raw_bytes(
        raw,
        out_dir=args.out,
        map_width=args.width,
        map_height=args.height,
        background_bgr=bg,
    )
    if report is None:
        raise SystemExit("No embedded INSTA360 calibration found in file.")

    print(format_orientation_report(report))
    print(f"\nWrote {args.out / 'orientation_report.txt'}")
    print(f"Wrote {args.out / 'orientation_report.json'}")
    print(f"Wrote {args.out / 'orientation_axes.png'}")


if __name__ == "__main__":
    main()
