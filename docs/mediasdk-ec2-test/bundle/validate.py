"""Standalone output + input checks for the isolated MediaSDK test (no SiteVision code). Prints one JSON line.

usage: validate.py INPUT_FILE OUTPUT_JPEG SDK_LOG
An SDK exit code is never treated as proof: the output must decode, be 2:1, and not be flat/degenerate.
"""
import hashlib
import json
import os
import re
import sys

import cv2
import numpy as np

inp, out, logp = sys.argv[1:4]
res = {"input_name": os.path.basename(inp), "input_bytes": os.path.getsize(inp)}

h = hashlib.sha256()
with open(inp, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
res["input_sha256"] = h.hexdigest()
with open(inp, "rb") as f:
    head = f.read(262144)
    f.seek(max(0, res["input_bytes"] - 262144))
    tail = f.read()
m = re.search(rb"Insta360 (X\d|ONE ?[A-Z0-9]+)", head + tail)
res["camera_model"] = m.group(1).decode() if m else "unknown"

log = open(logp, errors="replace").read() if os.path.exists(logp) else ""
def grab(rx):
    mm = re.search(rx, log)
    return mm.group(1).strip() if mm else None
res["sdk_version"] = grab(r"SDK version:\s*([0-9.]+)")
res["gl_renderer"] = grab(r"GL_RENDERER:\s*(.+)")
res["vulkan_device"] = grab(r"device 0 :\s*(.+?)\s+type:")
res["blender"] = grab(r"blender type:\s*(\w+)")
res["flow_compute"] = grab(r"compute type:\s*(\w+)")
low = " ".join(str(res[k]).lower() for k in ("gl_renderer", "vulkan_device"))
res["sdk_reported_cpu"] = bool(("llvmpipe" in low or "lavapipe" in low) or (res["blender"] or "").upper().endswith("_CPU"))

ok = {"exists": os.path.isfile(out) and os.path.getsize(out) > 0}
res["output_bytes"] = os.path.getsize(out) if ok["exists"] else 0
if ok["exists"]:
    img = cv2.imdecode(np.fromfile(out, np.uint8), cv2.IMREAD_COLOR)
    ok["decodes"] = img is not None
    if img is not None:
        hh, ww = img.shape[:2]
        res["output_dims"] = f"{ww}x{hh}"
        ok["aspect_2to1"] = abs(ww / hh - 2.0) < 0.02
        s = cv2.resize(img, (256, 128), interpolation=cv2.INTER_AREA)
        res["flat_row_fraction"] = round(float((s.reshape(128, -1).std(axis=1) < 1.5).mean()), 3)
        q = (s // 16).reshape(-1, 3)
        codes = q[:, 0].astype(np.int32) * 256 + q[:, 1] * 16 + q[:, 2]
        res["dominant_colour_fraction"] = round(float(np.bincount(codes).max() / codes.size), 3)
        ok["not_flat"] = res["flat_row_fraction"] <= 0.40 and res["dominant_colour_fraction"] <= 0.55
        t = cv2.resize(img, (1024, 512), interpolation=cv2.INTER_AREA).astype(np.float32)[64:448]
        wrap = float(np.abs(t[:, 0] - t[:, -1]).mean())
        inner = float(np.median(np.abs(t[:, 1:] - t[:, :-1]).mean(axis=(0, 2))))
        res["wrap_seam_ratio"] = round(wrap / max(inner, 0.1) if wrap >= 25 else 0.0, 2)
        ok["wraps"] = res["wrap_seam_ratio"] <= 6.0
res["checks"] = ok
res["output_valid"] = bool(ok.get("exists") and ok.get("decodes") and ok.get("aspect_2to1") and ok.get("not_flat") and ok.get("wraps"))
print(json.dumps(res))
