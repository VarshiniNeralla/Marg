#!/usr/bin/env python3
"""
Export spherical-rotation variants of an equirectangular panorama.

This is a debug utility for already-stitched panoramas. It rotates on the
unit sphere, then resamples back into equirectangular form so the outputs stay
valid 2:1 panoramas for the existing viewer.

Usage (from backend/):

  python tools/rotate_equirect_debug.py

  python tools/rotate_equirect_debug.py \
    --input debug_run_09/10_final_blended.png \
    --out-dir debug_run_09/equirect_rotations
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as `python tools/rotate_equirect_debug.py` from backend/
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.fisheye_stitch import _save_png  # noqa: E402
from app.services.stitch_compare import _latlon_grid, _rotate_equirect, _vec_from_latlon  # noqa: E402


def _load_bgr(path: Path):
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"Could not read image: {path}")
    return img


def export_rotations(input_path: Path, out_dir: Path) -> dict[str, Path]:
    img = _load_bgr(input_path)
    h, w = img.shape[:2]
    lon, lat = _latlon_grid(h, w)
    vecs = _vec_from_latlon(lat, lon)

    variants = {
        "01_original.png": img,
        "02_roll_plus90.png": _rotate_equirect(img, 0.0, 0.0, 90.0, lon, lat, vecs),
        "03_roll_minus90.png": _rotate_equirect(img, 0.0, 0.0, -90.0, lon, lat, vecs),
        "04_rotate_180.png": _rotate_equirect(img, 0.0, 0.0, 180.0, lon, lat, vecs),
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for name, out in variants.items():
        path = out_dir / name
        _save_png(path, out)
        written[name] = path
    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export spherical roll variants of an equirectangular panorama"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("debug_run_09") / "10_final_blended.png",
        help="Input equirectangular panorama PNG",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("debug_run_09") / "equirect_rotations",
        help="Directory for rotated panorama exports",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input not found: {args.input}")

    written = export_rotations(args.input, args.out_dir)
    print(f"Input: {args.input}")
    print(f"Output dir: {args.out_dir}")
    print("Wrote:")
    for name in written:
        print(f"  {name}")


if __name__ == "__main__":
    main()
