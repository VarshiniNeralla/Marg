#!/usr/bin/env python3
"""
Seam / optical-flow correspondence diagnostics for the dual-fisheye stitcher.

Purpose
-------
The stitched panoramas are ~98-99% correct; the residual defect is a few-pixel
double edge on high-contrast structures (door frames, window frames, beams,
scaffolding, thin verticals) near the two seams. This tool measures — on a real
capture, with zero pipeline changes — WHERE that residual comes from:

  * optical-flow magnitude in the two seam corridors (production parameters)
  * forward/backward flow-consistency error  e(x) = |F(x) + B(x + F(x))|
  * a confidence map  c = exp(-(e/tau)^2)
  * hemisphere mismatch |front-back| BEFORE and AFTER the flow alignment
  * the optimized seam paths and the multiband mixing band around them
  * final hemisphere ownership (seam mask)
  * quantitative stats correlating: edge pixels <-> flow unreliability <->
    residual post-alignment mismatch inside the seam mixing band

Usage (from backend/ with venv active):

  python tools/seam_flow_diagnostics.py --raw path/to/capture.dng --out diag_run_01

Outputs (in --out):
  diag_blended.png              final production stitch (unchanged pipeline)
  diag_flow_magnitude.png       |flow| in the seam corridors (JET, 0..40 px)
  diag_fb_error.png             fwd/bwd consistency error (JET, 0..8 px)
  diag_flow_confidence.png      confidence map (white=reliable, black=unreliable)
  diag_overlap_pre_align.png    |front-back| before flow warp (JET, 0..96)
  diag_overlap_post_align.png   |front-back| after flow warp — what the blend mixes
  diag_seam_overlay.png         blended + seam paths + mixing band + hot residuals
  diag_ownership.png            final hemisphere ownership mask
  diag_crop_<seam>_<k>.png      worst-residual zooms: [blended | pre | post | conf]
  diag_stats.json               the numbers behind the conclusion
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.services.fisheye_stitch import _save_png, _stitch_arrays  # noqa: E402

# ── Production constants (must mirror _parallax_align_hemispheres exactly) ────
STRIP_HALF = 560
TAPER = 64
MAX_FLOW = 100.0
FARNEBACK = dict(
    pyr_scale=0.5, levels=5, winsize=41, iterations=3, poly_n=7, poly_sigma=1.5, flags=0
)
# Multiband mixing half-width: levels 1-4 transition over ±6/14/24/48 px of the
# seam (documented + measured in fisheye_stitch._optimize_seam_mask).
MIX_BAND = 48
# Diagnostic thresholds
CONF_TAU = 2.0          # px — fb-error scale for the confidence map
EDGE_GRAD_T = 40.0      # Sobel magnitude defining "high-contrast" pixels
RESID_T = 60.0          # sum-of-channels |front-back| defining a visible residual
FB_ERR_LOW_CONF = 2.0   # px — fb-error above this = unreliable correspondence


def _fb_error(fwd: np.ndarray, bwd: np.ndarray) -> np.ndarray:
    """Forward/backward consistency error |F(x) + B(x + F(x))| per pixel (px)."""
    h, w = fwd.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    bx = cv2.remap(bwd[..., 0], gx + fwd[..., 0], gy + fwd[..., 1],
                   cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    by = cv2.remap(bwd[..., 1], gx + fwd[..., 0], gy + fwd[..., 1],
                   cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return np.hypot(fwd[..., 0] + bx, fwd[..., 1] + by)


def _jet(x: np.ndarray, vmax: float) -> np.ndarray:
    x8 = np.clip(x / max(vmax, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    return cv2.applyColorMap(x8, cv2.COLORMAP_JET)


def _gray_img(x: np.ndarray, vmax: float) -> np.ndarray:
    x8 = np.clip(x / max(vmax, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(x8, cv2.COLOR_GRAY2BGR)


def _pct(mask_num: np.ndarray, mask_den: np.ndarray) -> float:
    d = int(mask_den.sum())
    return 100.0 * int((mask_num & mask_den).sum()) / d if d else 0.0


def _stats_of(x: np.ndarray, mask: np.ndarray) -> dict:
    v = x[mask]
    if v.size == 0:
        return {"n": 0}
    return {
        "n": int(v.size),
        "median": round(float(np.median(v)), 3),
        "p90": round(float(np.percentile(v, 90)), 3),
        "p99": round(float(np.percentile(v, 99)), 3),
        "max": round(float(v.max()), 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--raw", required=True, help="Path to .dng/.insp capture")
    ap.add_argument("--out", required=True, help="Output directory")
    args = ap.parse_args()

    raw_path = Path(args.raw)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    data = raw_path.read_bytes()
    result = _stitch_arrays(data, raw_path.name)
    if result is None:
        raise SystemExit("Stitch failed — no calibration or decode error")
    blended, art = result
    print(f"[stitch] done in {time.time() - t0:.1f}s")

    front_pre = art.front_pre_align
    back_pre = art.back_pre_align
    front_post = art.front_aligned
    back_post = art.back_aligned
    seam_left = np.asarray(art.seam_left)
    seam_right = np.asarray(art.seam_right)
    seam_mask = art.seam_mask
    clean_overlap = art.clean_lens1 & art.clean_lens2

    H, W = blended.shape[:2]
    lf = cv2.cvtColor(front_pre, cv2.COLOR_BGR2GRAY)
    lb = cv2.cvtColor(back_pre, cv2.COLOR_BGR2GRAY)

    # Full-canvas diagnostic fields (zero outside the two corridors)
    mag_full = np.zeros((H, W), np.float32)
    err_full = np.zeros((H, W), np.float32)
    strip_meta = {}
    for name, xc in (("left", W // 4), ("right", 3 * W // 4)):
        x0, x1 = xc - STRIP_HALF, xc + STRIP_HALF
        a, b = lf[:, x0:x1], lb[:, x0:x1]
        fwd = cv2.calcOpticalFlowFarneback(a, b, None, **FARNEBACK)
        bwd = cv2.calcOpticalFlowFarneback(b, a, None, **FARNEBACK)
        fwd[..., 0] = np.clip(fwd[..., 0], -MAX_FLOW, MAX_FLOW)
        fwd[..., 1] = np.clip(fwd[..., 1], -MAX_FLOW, MAX_FLOW)
        bwd[..., 0] = np.clip(bwd[..., 0], -MAX_FLOW, MAX_FLOW)
        bwd[..., 1] = np.clip(bwd[..., 1], -MAX_FLOW, MAX_FLOW)
        mag_full[:, x0:x1] = np.hypot(fwd[..., 0], fwd[..., 1])
        err_full[:, x0:x1] = _fb_error(fwd, bwd)
        strip_meta[name] = {"x0": int(x0), "x1": int(x1), "xc": int(xc)}
    conf_full = np.exp(-((err_full / CONF_TAU) ** 2)).astype(np.float32)

    diff_pre = np.abs(front_pre.astype(np.int16) - back_pre.astype(np.int16)) \
        .sum(axis=2).astype(np.float32)
    diff_post = np.abs(front_post.astype(np.int16) - back_post.astype(np.int16)) \
        .sum(axis=2).astype(np.float32)

    grad = cv2.Sobel(lf, cv2.CV_32F, 1, 0, ksize=3) ** 2 \
        + cv2.Sobel(lf, cv2.CV_32F, 0, 1, ksize=3) ** 2
    grad = np.sqrt(grad)

    # Analysis domain: real two-source content inside the corridors.
    corridor = np.zeros((H, W), bool)
    for m in strip_meta.values():
        corridor[:, m["x0"]:m["x1"]] = True
    domain = corridor & clean_overlap
    edges = domain & (grad > EDGE_GRAD_T)
    flat = domain & (grad <= EDGE_GRAD_T)
    low_conf = err_full > FB_ERR_LOW_CONF

    # ── Seam-band analysis: what the multiband mixer actually sees ────────────
    cols = np.arange(W)[None, :]
    band = (np.abs(cols - seam_left[:, None]) <= MIX_BAND) | \
           (np.abs(cols - seam_right[:, None]) <= MIX_BAND)
    band &= domain
    hot_band = band & (diff_post > RESID_T)          # visible residual in mixing band
    rows_hot = np.zeros(H, bool)
    for name, path in (("left", seam_left), ("right", seam_right)):
        for y in range(H):
            x0 = max(0, path[y] - MIX_BAND)
            x1 = min(W, path[y] + MIX_BAND + 1)
            if (diff_post[y, x0:x1][domain[y, x0:x1]] > RESID_T).any():
                rows_hot[y] = True

    stats = {
        "file": raw_path.name,
        "output": f"{W}x{H}",
        "thresholds": {
            "conf_tau_px": CONF_TAU, "edge_grad": EDGE_GRAD_T,
            "residual_sum3": RESID_T, "fb_err_low_conf_px": FB_ERR_LOW_CONF,
            "mix_band_px": MIX_BAND,
        },
        "flow_magnitude_px": {
            "domain": _stats_of(mag_full, domain),
            "edges": _stats_of(mag_full, edges),
        },
        "fb_consistency_error_px": {
            "domain": _stats_of(err_full, domain),
            "flat": _stats_of(err_full, flat),
            "edges": _stats_of(err_full, edges),
        },
        "pct_low_confidence": {
            "of_domain": round(_pct(low_conf, domain), 2),
            "of_flat": round(_pct(low_conf, flat), 2),
            "of_edges": round(_pct(low_conf, edges), 2),
        },
        "hemisphere_mismatch_sum3": {
            "pre_align_domain": _stats_of(diff_pre, domain),
            "post_align_domain": _stats_of(diff_post, domain),
            "pre_align_edges": _stats_of(diff_pre, edges),
            "post_align_edges": _stats_of(diff_post, edges),
        },
        "seam_mixing_band": {
            "band_px_each_side": MIX_BAND,
            "pct_band_pixels_hot": round(_pct(diff_post > RESID_T, band), 2),
            "pct_rows_with_hot_pixel_in_band": round(100.0 * rows_hot.sum() / H, 2),
            "hot_band_pixels": int(hot_band.sum()),
            "pct_hot_band_pixels_low_confidence": round(_pct(low_conf, hot_band), 2),
            "pct_hot_band_pixels_on_edges": round(_pct(grad > EDGE_GRAD_T, hot_band), 2),
            "fb_error_at_hot_band": _stats_of(err_full, hot_band),
            "flow_mag_at_hot_band": _stats_of(mag_full, hot_band),
            "pre_align_diff_at_hot_band": _stats_of(diff_pre, hot_band),
            "post_align_diff_at_hot_band": _stats_of(diff_post, hot_band),
        },
    }

    # ── Renders ───────────────────────────────────────────────────────────────
    def masked(img_map, base_mask):
        out = img_map.copy()
        out[~base_mask] = 0
        return out

    _save_png(out_dir / "diag_blended.png", blended)
    _save_png(out_dir / "diag_flow_magnitude.png", _jet(masked(mag_full, domain), 40.0))
    _save_png(out_dir / "diag_fb_error.png", _jet(masked(err_full, domain), 8.0))
    _save_png(out_dir / "diag_flow_confidence.png", _gray_img(masked(conf_full, domain), 1.0))
    _save_png(out_dir / "diag_overlap_pre_align.png", _jet(masked(diff_pre, domain), 96.0))
    _save_png(out_dir / "diag_overlap_post_align.png", _jet(masked(diff_post, domain), 96.0))
    _save_png(out_dir / "diag_ownership.png",
              _gray_img(seam_mask.astype(np.float32), 1.0))

    overlay = blended.copy()
    band_tint = np.zeros_like(overlay)
    band_tint[band] = (0, 160, 0)
    overlay = cv2.addWeighted(overlay, 1.0, band_tint, 0.35, 0)
    overlay[hot_band] = (0, 0, 255)                       # residual the viewer sees
    hot_lowconf = hot_band & low_conf
    overlay[hot_lowconf] = (255, 0, 255)                  # …and flow was unreliable
    ys = np.arange(H)
    for path in (seam_left, seam_right):
        overlay[ys, np.clip(path, 0, W - 1)] = (0, 255, 0)
    _save_png(out_dir / "diag_seam_overlay.png", overlay)

    # ── Worst-residual zoom crops per seam ────────────────────────────────────
    crop_meta = []
    for name, path in (("left", seam_left), ("right", seam_right)):
        band_r = np.zeros(H, np.float32)
        for y in range(H):
            x0 = max(0, path[y] - MIX_BAND)
            x1 = min(W, path[y] + MIX_BAND + 1)
            sel = domain[y, x0:x1]
            band_r[y] = float(diff_post[y, x0:x1][sel].max()) if sel.any() else 0.0
        r = band_r.copy()
        for k in range(3):
            y = int(np.argmax(r))
            if r[y] < RESID_T:
                break
            xc = int(path[y])
            y0, y1 = max(0, y - 220), min(H, y + 220)
            x0, x1 = max(0, xc - 220), min(W, xc + 220)
            panel = np.hstack([
                blended[y0:y1, x0:x1],
                _jet(masked(diff_pre, domain)[y0:y1, x0:x1], 96.0),
                _jet(masked(diff_post, domain)[y0:y1, x0:x1], 96.0),
                _gray_img(masked(conf_full, domain)[y0:y1, x0:x1], 1.0),
            ])
            cv2.putText(panel, f"{name} y={y} x={xc} resid={band_r[y]:.0f} "
                        f"err={err_full[y, xc]:.1f}px",
                        (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            _save_png(out_dir / f"diag_crop_{name}_{k}.png", panel)
            crop_meta.append({
                "seam": name, "y": int(y), "x": xc,
                "band_residual": round(float(band_r[y]), 1),
                "fb_error_px_at_seam": round(float(err_full[y, xc]), 2),
                "flow_mag_px_at_seam": round(float(mag_full[y, xc]), 2),
            })
            r[max(0, y - 250):min(H, y + 250)] = 0.0
    stats["worst_crops"] = crop_meta

    (out_dir / "diag_stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))
    print(f"[diagnostics] written to {out_dir} in {time.time() - t0:.1f}s total")


if __name__ == "__main__":
    main()
