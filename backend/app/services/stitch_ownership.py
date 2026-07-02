"""
Hemisphere ownership and blend-weight diagnostics for dual-fisheye stitching.

Measurement / visualization only — does not alter stitch math.
"""
from __future__ import annotations

from typing import Any, Optional

import numpy as np


def _pixel_stats(mask: np.ndarray) -> dict[str, float]:
    n = int(mask.size)
    c = int(mask.sum())
    return {
        "pixels": c,
        "percent": 100.0 * c / n if n else 0.0,
    }


def ownership_summary(v1: np.ndarray, v2: np.ndarray, w1: np.ndarray) -> dict[str, Any]:
    """Exclusive / overlap pixel counts from valid masks and lens1 blend weight."""
    v1 = v1.astype(bool)
    v2 = v2.astype(bool)
    n = int(v1.size)
    l1_only = v1 & ~v2
    l2_only = v2 & ~v1
    overlap = v1 & v2
    neither = ~v1 & ~v2

    w = w1.astype(np.float64)
    return {
        "total_pixels": n,
        "lens1_valid": _pixel_stats(v1),
        "lens2_valid": _pixel_stats(v2),
        "lens1_exclusive": _pixel_stats(l1_only),
        "lens2_exclusive": _pixel_stats(l2_only),
        "overlap": _pixel_stats(overlap),
        "neither": _pixel_stats(neither),
        "blend_weight_lens1": {
            "min": float(w[v1 | v2].min()) if (v1 | v2).any() else None,
            "max": float(w[v1 | v2].max()) if (v1 | v2).any() else None,
            "mean_in_overlap": float(w[overlap].mean()) if overlap.any() else None,
        },
    }


def longitude_column_ownership(
    v1: np.ndarray,
    v2: np.ndarray,
    out_w: int,
) -> dict[str, Any]:
    """Per output-equirect longitude column: how much each lens owns."""
    lons_deg = np.degrees(np.linspace(-np.pi, np.pi, out_w, endpoint=False))
    h = v1.shape[0]
    l1_col = v1.sum(axis=0).astype(np.float64) / h
    l2_col = v2.sum(axis=0).astype(np.float64) / h
    both_col = (v1 & v2).sum(axis=0).astype(np.float64) / h

    both_heavy = both_col > 0.25
    l1_dom = (l1_col > 0.5) & (l2_col < 0.1)
    l2_dom = (l2_col > 0.5) & (l1_col < 0.1)

    # Columns where both lenses cover most rows → same world longitude contested.
    contested_idx = np.where(both_col > 0.25)[0]
    contested_lons = [float(lons_deg[i]) for i in contested_idx[:20]]
    if contested_idx.size > 20:
        contested_lons.append("...")

    return {
        "columns_both_gt_25pct_rows": int(both_heavy.sum()),
        "columns_lens1_dominant": int(l1_dom.sum()),
        "columns_lens2_dominant": int(l2_dom.sum()),
        "sample_contested_output_longitudes_deg": contested_lons,
        "mean_column_fraction_lens1": float(l1_col.mean()),
        "mean_column_fraction_lens2": float(l2_col.mean()),
        "mean_column_fraction_both": float(both_col.mean()),
    }


def analyze_lens2_rotation_hypotheses(
    *,
    out_w: int,
    out_h: int,
    fov_deg: float,
    lens1_params: tuple[float, float, float, tuple[float, float, float]],
    lens2_params: tuple[float, float, float, tuple[float, float, float]],
    v1: np.ndarray,
    src_h: int,
    src_w: int,
) -> dict[str, Any]:
    """Compare lens2 valid masks under different yaw_offset / body_flip combinations."""
    from app.services.fisheye_stitch import _hemisphere_map

    cx1, cy1, r1, rot1 = lens1_params
    cx2, cy2, r2, rot2 = lens2_params

    modes = [
        ("stitched_actual", np.pi, True, "Ry(π) + yaw_offset=π [current lens2]"),
        ("body_flip_only", 0.0, True, "Ry(π) only, yaw_offset=0"),
        ("yaw_offset_only", np.pi, False, "yaw_offset=π only, no Ry(π)"),
        ("calib_only", 0.0, False, "calibration R2 only"),
    ]
    n = int(v1.size)
    rows: list[dict[str, Any]] = []
    for name, yaw_off, body_flip, desc in modes:
        _, _, v2 = _hemisphere_map(
            out_w, out_h, cx2, cy2, r2, fov_deg, yaw_off, rot2,
            src_h=src_h, src_w=src_w, lens_label=f"diag_{name}",
            body_flip=body_flip,
        )
        v2 = v2.astype(bool)
        overlap = v1 & v2
        rows.append({
            "mode": name,
            "description": desc,
            "yaw_offset_deg": float(np.degrees(yaw_off)),
            "body_flip": body_flip,
            "lens2_valid_pct": 100.0 * int(v2.sum()) / n,
            "overlap_with_lens1_pct": 100.0 * int(overlap.sum()) / n,
            "lens1_exclusive_pct": 100.0 * int((v1 & ~v2).sum()) / n,
            "lens2_exclusive_pct": 100.0 * int((v2 & ~v1).sum()) / n,
        })

    actual = next(r for r in rows if r["mode"] == "stitched_actual")
    body_only = next(r for r in rows if r["mode"] == "body_flip_only")
    yaw_only = next(r for r in rows if r["mode"] == "yaw_offset_only")

    if actual["overlap_with_lens1_pct"] > body_only["overlap_with_lens1_pct"] + 5:
        double_rot_verdict = (
            "High overlap likely from BOTH Ry(π) and yaw_offset=π: "
            f"actual overlap {actual['overlap_with_lens1_pct']:.1f}% vs "
            f"body_flip_only {body_only['overlap_with_lens1_pct']:.1f}% vs "
            f"yaw_offset_only {yaw_only['overlap_with_lens1_pct']:.1f}%."
        )
    elif actual["overlap_with_lens1_pct"] > 30:
        double_rot_verdict = (
            "Both lenses contribute to many of the same output pixels; "
            "overlap is high even in single-rotation modes — check hemisphere assignment."
        )
    else:
        double_rot_verdict = "Overlap consistent with intentional seam feathering."

    return {
        "modes": rows,
        "interpretation": double_rot_verdict,
        "note": (
            "yaw_offset shifts lon before sphere_dirs; body_flip composes R2 @ Ry(π). "
            "They are independent. If stitched_actual overlap ≫ body_flip_only and "
            "≫ yaw_offset_only individually, both may be steering lens2 onto lens1 longitudes."
        ),
    }


def render_ownership_masks(
    v1: np.ndarray,
    v2: np.ndarray,
    w1: np.ndarray,
) -> dict[str, np.ndarray]:
    """BGR visualizations for debug PNG output."""
    import cv2

    v1 = v1.astype(bool)
    v2 = v2.astype(bool)
    h, w = v1.shape
    l1_only = v1 & ~v2
    l2_only = v2 & ~v1
    overlap = v1 & v2

    mask_l1 = np.zeros((h, w, 3), dtype=np.uint8)
    mask_l1[v1] = (255, 255, 255)

    mask_l2 = np.zeros((h, w, 3), dtype=np.uint8)
    mask_l2[v2] = (255, 255, 255)

    w_vis = np.zeros((h, w, 3), dtype=np.uint8)
    w_norm = np.clip(w1, 0, 1)
    gray = (w_norm * 255).astype(np.uint8)
    w_vis[..., 0] = gray
    w_vis[..., 1] = gray
    w_vis[..., 2] = gray
    w_vis[~v1 & ~v2] = (0, 0, 0)

    composite = np.zeros((h, w, 3), dtype=np.uint8)
    composite[l1_only] = (0, 0, 255)      # red = lens1 only
    composite[overlap] = (0, 255, 0)      # green = overlap
    composite[l2_only] = (255, 0, 0)    # blue = lens2 only

    labels = composite.copy()
    cv2.putText(labels, "R=lens1 only", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.putText(labels, "G=overlap", (10, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(labels, "B=lens2 only", (10, 84), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

    return {
        "ownership_lens1.png": mask_l1,
        "ownership_lens2.png": mask_l2,
        "blend_weight_lens1.png": w_vis,
        "ownership_composite.png": labels,
    }


def build_full_ownership_report(
    v1: np.ndarray,
    v2: np.ndarray,
    w1: np.ndarray,
    out_w: int,
    out_h: int,
    *,
    fov_deg: float,
    lens1_params: Optional[tuple] = None,
    lens2_params: Optional[tuple] = None,
    src_h: Optional[int] = None,
    src_w: Optional[int] = None,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "summary": ownership_summary(v1, v2, w1),
        "longitude_columns": longitude_column_ownership(v1, v2, out_w),
    }
    if (
        lens1_params is not None
        and lens2_params is not None
        and src_h is not None
        and src_w is not None
    ):
        report["lens2_rotation_hypotheses"] = analyze_lens2_rotation_hypotheses(
            out_w=out_w,
            out_h=out_h,
            fov_deg=fov_deg,
            lens1_params=lens1_params,
            lens2_params=lens2_params,
            v1=v1.astype(bool),
            src_h=src_h,
            src_w=src_w,
        )
    return report


def format_ownership_report_text(report: dict[str, Any]) -> str:
    s = report["summary"]
    lc = report["longitude_columns"]
    lines = [
        "── Hemisphere ownership diagnostics ──",
        "",
        f"Total pixels: {s['total_pixels']}",
        f"  Lens1 valid:      {s['lens1_valid']['percent']:.1f}%",
        f"  Lens2 valid:      {s['lens2_valid']['percent']:.1f}%",
        f"  Lens1 exclusive:  {s['lens1_exclusive']['percent']:.1f}%",
        f"  Lens2 exclusive:  {s['lens2_exclusive']['percent']:.1f}%",
        f"  Overlap:          {s['overlap']['percent']:.1f}%",
        f"  Neither:          {s['neither']['percent']:.1f}%",
        "",
        "Blend weight w1 (lens1 fraction, 0=lens2 .. 1=lens1):",
        f"  min={s['blend_weight_lens1']['min']}  max={s['blend_weight_lens1']['max']}  "
        f"mean_in_overlap={s['blend_weight_lens1']['mean_in_overlap']}",
        "",
        "Per output-longitude column (fraction of rows valid):",
        f"  mean lens1={lc['mean_column_fraction_lens1']:.3f}  "
        f"lens2={lc['mean_column_fraction_lens2']:.3f}  "
        f"both={lc['mean_column_fraction_both']:.3f}",
        f"  columns with both >50% rows: {lc['columns_both_gt_25pct_rows']}",
        f"  sample contested longitudes (deg): {lc['sample_contested_output_longitudes_deg']}",
    ]
    hyp = report.get("lens2_rotation_hypotheses")
    if hyp:
        lines.extend(["", "── Lens2 rotation hypothesis (no stitch math changed) ──"])
        for row in hyp["modes"]:
            lines.append(
                f"  {row['mode']}: overlap={row['overlap_with_lens1_pct']:.1f}%  "
                f"L1-excl={row['lens1_exclusive_pct']:.1f}%  L2-excl={row['lens2_exclusive_pct']:.1f}%  "
                f"({row['description']})"
            )
        lines.extend(["", f"  → {hyp['interpretation']}"])
    return "\n".join(lines)
