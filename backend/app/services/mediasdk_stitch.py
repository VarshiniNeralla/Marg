"""
Insta360 MediaSDK stitching engine (optional, behind ``STITCH_ENGINE``).

Runs the official MediaSDK ``ImageStitcher`` (SetInputPath / SetStitchType /
SetOutputSize / EnableFlowState / EnableCuda / SetImageProcessingAccelType / Stitch)
through the SDK's own command-line binary (built from the SDK's ``example/main.cc``;
``MediaSDKTest`` on Linux, ``MediaSDKTest.exe`` on Windows). All paths and runtime
libraries come from configuration (see ``mediasdk_runtime``), never from a hard-coded
location.

Two execution modes, same contract:
* local  - run the SDK binary in this process' host (default);
* remote - ``MEDIASDK_WORKER_URL`` set: send the capture to the separately deployed
  stitch worker (``app.stitch_worker``), which runs the local mode and returns the JPEG.

Why validation lives here: the SDK exits 0 and writes a normal-looking JPEG even
when the INPUT is corrupt (a truncated capture came back as a flat green/grey
panorama). Process success is therefore never treated as stitch success; every
output is checked for readability, 2:1 dimensions and real image content before
a ``StitchResult`` is returned. Any failure raises ``MediaSdkStitchError`` so the
caller can fall back to the built-in stitcher.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from loguru import logger

from app.services import mediasdk_runtime as rt
from app.services.fisheye_stitch import StitchResult

_VERSION_RE = re.compile(r"SDK version:\s*([0-9][0-9.]*)")
_ALLOWED_TYPES = {"template", "optflow", "dynamicstitch", "aistitch"}
# Input formats the SDK's ImageStitcher accepts for stills.
_SUPPORTED_SUFFIXES = {".insp", ".jpg", ".jpeg"}


class MediaSdkStitchError(RuntimeError):
    """MediaSDK could not produce a valid panorama (reason is safe to show/log)."""


class MediaSdkNotApplicable(MediaSdkStitchError):
    """MediaSDK is not meant for this capture (unverified camera model, unsupported format): not a failure.

    The caller then behaves exactly as it did before MediaSDK existed (built-in stitcher, no extra validation)."""


def _settings():
    from app.core.mediasdk_config import get_mediasdk_settings

    return get_mediasdk_settings()


def mediasdk_available() -> bool:
    """True when stitching can be attempted: a worker URL is set, or the local SDK is installed with its libraries."""
    s = _settings()
    if (getattr(s, "MEDIASDK_WORKER_URL", "") or "").strip():
        return True
    return rt.check_runtime(s).ok


# ── Validation ───────────────────────────────────────────────────────────────

_WRAP_SEAM_MAX_RATIO = 6.0   # valid panoramas measured 0.5-1.8 (left/right edge diff / typical neighbour diff)
_WRAP_SEAM_MIN_ABS = 25.0


def wrap_seam_ratio(img) -> float:
    """How much the left and right edges differ vs. ordinary neighbouring columns (valid 360 panoramas wrap)."""
    import cv2
    import numpy as np

    s = cv2.resize(img, (1024, 512), interpolation=cv2.INTER_AREA).astype(np.float32)[64:448]
    wrap = float(np.abs(s[:, 0] - s[:, -1]).mean())
    inner = float(np.median(np.abs(s[:, 1:] - s[:, :-1]).mean(axis=(0, 2))))
    return wrap / max(inner, 0.1) if wrap >= _WRAP_SEAM_MIN_ABS else 0.0


def validate_panorama_jpeg(jpeg: bytes, *, enforce_wrap: bool = False) -> tuple[int, int]:
    """Return (width, height) or raise MediaSdkStitchError.

    ``enforce_wrap`` additionally requires the left/right edges to be continuous (a real 360 panorama wraps);
    it is advisory-only for the built-in stitcher, which can leave a known dark wedge behind the camera.

    Catches: unreadable file, wrong aspect, flat/blank output, and the degenerate
    "mostly one flat colour" panoramas the SDK emits for corrupt input.
    """
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise MediaSdkStitchError("output is not a readable image")
    h, w = img.shape[:2]
    if abs(w / max(h, 1) - 2.0) > 0.02:
        raise MediaSdkStitchError(f"output is not 2:1 equirectangular ({w}x{h})")

    small = cv2.resize(img, (256, 128), interpolation=cv2.INTER_AREA)
    # Fraction of rows with essentially no variation (flat fill from a failed decode).
    row_std = small.reshape(128, -1).std(axis=1)
    flat_rows = float((row_std < 1.5).mean())
    # Fraction of pixels sharing the single most common quantised colour.
    q = (small // 16).reshape(-1, 3)
    codes = q[:, 0].astype(np.int32) * 256 + q[:, 1] * 16 + q[:, 2]
    dominant = float(np.bincount(codes).max() / codes.size)
    if flat_rows > 0.40 or dominant > 0.55:
        raise MediaSdkStitchError(
            f"output is mostly flat colour (flat_rows={flat_rows:.2f}, dominant={dominant:.2f}); "
            "the original capture is probably corrupt or incomplete"
        )
    ratio = wrap_seam_ratio(img)
    if ratio > _WRAP_SEAM_MAX_RATIO:
        if enforce_wrap:
            raise MediaSdkStitchError(f"panorama does not wrap at the 360 degree seam (ratio {ratio:.1f})")
        logger.warning(f"[stitch-validate] wrap-seam discontinuity ratio={ratio:.1f} (advisory)")
    return w, h


def _roll_yaw(jpeg: bytes, degrees: float, quality: int) -> bytes:
    """Roll an equirectangular JPEG horizontally by ``degrees`` (pure column shift, no resampling)."""
    import cv2
    import numpy as np

    if abs(degrees % 360.0) < 1e-6:
        return jpeg
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise MediaSdkStitchError("output is not a readable image")
    shift = int(round(img.shape[1] * (degrees % 360.0) / 360.0))
    ok, buf = cv2.imencode(".jpg", np.roll(img, shift, axis=1), [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise MediaSdkStitchError("could not re-encode yaw-aligned panorama")
    return buf.tobytes()


def validate_input_capture(data: bytes) -> None:
    """Cheap pre-flight: reject captures whose JPEG is truncated/corrupt.

    The raw capture is a ~12 MP+ JPEG; a transfer cut-off leaves a valid first few
    rows followed by flat grey. Decode at 1/8 scale and look for that tail.
    """
    from io import BytesIO

    import numpy as np
    from PIL import Image

    try:
        im = Image.open(BytesIO(data))
        im.draft("RGB", (max(im.size[0] // 8, 1), max(im.size[1] // 8, 1)))
        arr = np.asarray(im.convert("RGB"))
    except Exception as exc:
        # Some genuine captures have a JPEG layout PIL cannot decode but MediaSDK can (verified on a real X3
        # file). No positive evidence of truncation, so defer to the SDK + output validation.
        logger.info(f"[mediasdk] input pre-check skipped ({exc.__class__.__name__}); relying on output validation")
        return
    rows = arr.reshape(arr.shape[0], -1).std(axis=1)
    # A genuine fisheye pair always has texture in most rows; a truncated JPEG ends in a long
    # run of byte-identical rows. Require that run to be at the BOTTOM to avoid false alarms
    # on legitimately dark rows.
    tail = 0
    for v in rows[::-1]:
        if v < 0.5:
            tail += 1
        else:
            break
    if tail / max(len(rows), 1) > 0.20:
        raise MediaSdkStitchError(
            f"original capture is truncated/corrupt ({tail / len(rows):.0%} of the image is flat fill)"
        )


_ORIGINAL_TRAILER_MAGIC = b"8db42d694ccc418790edff439fe026bf"


def is_unstitched_insta360_original(data: bytes) -> bool:
    """Conservative test for "this JPEG-named file is an Insta360 ORIGINAL" (not a stitched export).

    Requires the Insta360 original-file trailer marker (present on all X3/X5 originals tested, absent on stitched
    outputs of both engines) AND a camera model on the MediaSDK allow-list. It is only used when
    MEDIASDK_ROUTE_JPEG_ORIGINALS is enabled, which is OFF by default: no in-camera-stitched Insta360 JPEG was
    available to prove the marker cannot also appear on an already-stitched panorama.
    """
    if _ORIGINAL_TRAILER_MAGIC not in data[-64:]:
        return False
    s = _settings()
    verified = {m.strip().upper() for m in (s.MEDIASDK_VERIFIED_MODELS or "").split(",") if m.strip()}
    return _camera_model(data).upper() in verified


def _camera_model(data: bytes) -> str:
    try:
        from app.services.fisheye_stitch import detect_model

        return detect_model(data) or "insta360"
    except Exception:
        return "insta360"


# ── Engine ───────────────────────────────────────────────────────────────────

_slots_lock = threading.Lock()
_slots: Optional[tuple[int, threading.BoundedSemaphore]] = None


def _concurrency_slots(limit: int) -> threading.BoundedSemaphore:
    """Process-wide cap on simultaneous SDK runs (MEDIASDK_MAX_CONCURRENCY); rebuilt if the setting changes."""
    global _slots
    limit = max(1, int(limit))
    with _slots_lock:
        if _slots is None or _slots[0] != limit:
            _slots = (limit, threading.BoundedSemaphore(limit))
        return _slots[1]


def _run_sdk(cmd: list[str], *, cwd: str, env: dict[str, str], timeout: int, filename: str) -> subprocess.CompletedProcess:
    """One SDK invocation. A transient launch failure gets one retry; timeouts/missing libraries never do."""
    for launch in (1, 2):
        try:
            return subprocess.run(
                cmd, cwd=cwd, env=env, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise MediaSdkStitchError(f"MediaSDK timed out after {timeout}s") from exc
        except OSError as exc:
            logger.warning(f"[mediasdk] launch failed attempt={launch} file={filename}: {exc!r}")
            if launch == 2:
                raise MediaSdkStitchError("MediaSDK could not be started") from exc
            time.sleep(1.0)
    raise MediaSdkStitchError("MediaSDK could not be started")  # unreachable; keeps type checkers honest


def _stitch_local_impl(
    data: bytes,
    filename: str,
    *,
    out_w: Optional[int] = None,
    out_h: Optional[int] = None,
    jpeg_quality: Optional[int] = None,  # SDK writes its own JPEG; kept for signature parity
) -> StitchResult:
    s = _settings()
    paths = rt.resolve_paths(s)
    report = rt.check_runtime(s)
    if not report.ok:
        raise MediaSdkStitchError(f"MediaSDK runtime is not usable: {report.summary()}")
    cli = str(paths.cli)

    stitch_type = (s.MEDIASDK_STITCH_TYPE or "optflow").lower()
    if stitch_type not in _ALLOWED_TYPES:
        raise MediaSdkStitchError(f"unsupported MEDIASDK_STITCH_TYPE '{stitch_type}'")
    out_w = int(out_w or s.MEDIASDK_OUTPUT_WIDTH)
    out_h = int(out_h or out_w // 2)

    suffix = Path(filename).suffix.lower()
    model = _camera_model(data)
    verified = {m.strip().upper() for m in (s.MEDIASDK_VERIFIED_MODELS or "").split(",") if m.strip()}
    if model.upper() not in verified:
        raise MediaSdkStitchError(
            f"camera model '{model}' is not yet verified for MediaSDK (verified: {', '.join(sorted(verified)) or 'none'})"
        )
    if suffix not in _SUPPORTED_SUFFIXES:
        # ImageStitcher stills: .insp/.jpg. A real X2 .dng ran for ~10 s and wrote no output.
        raise MediaSdkStitchError(f"MediaSDK ImageStitcher does not support '{suffix or 'unknown'}' captures")
    validate_input_capture(data)

    use_cuda = bool(s.MEDIASDK_ENABLE_CUDA)
    accel_cfg = (getattr(s, "MEDIASDK_IMAGE_ACCEL", "auto") or "auto").lower()
    if accel_cfg not in ("auto", "cpu"):
        raise MediaSdkStitchError(f"unsupported MEDIASDK_IMAGE_ACCEL '{accel_cfg}' (auto|cpu)")
    # Attempt 1 honours the configuration; if it was allowed to use the GPU/auto path and fails, attempt 2 is CPU-only.
    attempts: list[tuple[bool, str]] = [(use_cuda, accel_cfg)]
    if use_cuda or accel_cfg != "cpu":
        attempts.append((False, "cpu"))

    started = time.monotonic()
    queue_wait = 0.0          # time spent waiting for a free SDK slot (MEDIASDK_MAX_CONCURRENCY), NOT processing time
    sdk_started: Optional[float] = None
    work = Path(tempfile.mkdtemp(prefix="mediasdk_"))
    env = rt.build_env(paths, threads=int(getattr(s, "MEDIASDK_THREADS", 0) or 0))
    # The SDK writes a shader cache under $HOME/.cache; point it at the per-run scratch dir so a read-only or
    # unwritable home (container hardening) is not an error and nothing persists between runs.
    env["XDG_CACHE_HOME"] = str(work / "cache")
    timeout = int(s.MEDIASDK_TIMEOUT_SECONDS)
    try:
        src = work / f"in{suffix}"
        dst = work / "out.jpg"
        src.write_bytes(data)
        log = ""
        used = attempts[0]
        for n, (cuda, accel) in enumerate(attempts, start=1):
            used = (cuda, accel)
            if dst.exists():
                dst.unlink()
            cmd = [
                cli, "-inputs", str(src), "-output", str(dst),
                "-stitch_type", stitch_type, "-output_size", f"{out_w}x{out_h}",
                "-enable_flowstate" if s.MEDIASDK_ENABLE_FLOWSTATE else "-disable_flowstate",
                "-image_processing_accel", accel, "--log_level", "info",
            ]
            if paths.model_dir:
                # Insta360 README: the -model_root_dir value MUST end with "/", otherwise models are silently skipped.
                cmd += ["-model_root_dir", str(paths.model_dir).rstrip("/\\") + "/"]
            if not cuda:
                cmd.append("-disable_cuda")
            requested = time.monotonic()
            with _concurrency_slots(getattr(s, "MEDIASDK_MAX_CONCURRENCY", 1)):
                queue_wait += time.monotonic() - requested
                if sdk_started is None:
                    sdk_started = time.monotonic()
                proc = _run_sdk(cmd, cwd=str(paths.cli.parent), env=env, timeout=timeout, filename=filename)
            log = (proc.stdout or "") + (proc.stderr or "")
            lib = rt.missing_library_from_log(log)
            if lib:  # a different accel mode cannot fix a missing library
                raise MediaSdkStitchError(
                    f"MediaSDK runtime library missing: {lib}"
                    + (" (set MEDIASDK_TIFF_LIB_DIR to a directory containing libtiff.so.5)" if lib.startswith("libtiff") else "")
                )
            ok = proc.returncode == 0 and dst.is_file() and dst.stat().st_size > 0
            if ok:
                break
            reason = f"exit code {proc.returncode}" if proc.returncode != 0 else "no output file"
            logger.error(f"[mediasdk] attempt={n} cuda={cuda} accel={accel} {reason} file={filename} log_tail={log[-500:]!r}")
            if n == len(attempts):
                raise MediaSdkStitchError(
                    f"MediaSDK exited with code {proc.returncode}" if proc.returncode != 0
                    else "MediaSDK finished but wrote no output file"
                )
            logger.warning(f"[mediasdk] retrying on CPU only file={filename}")

        jpeg = dst.read_bytes()
        validate_panorama_jpeg(jpeg, enforce_wrap=True)  # validate the SDK's own output first
        yaw_roll = float(s.MEDIASDK_YAW_ROLL_DEGREES)
        jpeg = _roll_yaw(jpeg, yaw_roll, int(s.STITCH_JPEG_QUALITY))
        w, h = validate_panorama_jpeg(jpeg, enforce_wrap=True)
        m = _VERSION_RE.search(log)
        duration = round(time.monotonic() - (sdk_started if sdk_started is not None else started), 2)
        observed = rt.parse_accel(log)
        logger.info(
            f"[mediasdk] ok file={filename} {w}x{h} type={stitch_type} secs={duration} "
            f"accel_observed={observed['accel']} renderer={observed['gl_renderer']}"
        )
        return StitchResult(
            processed_image=jpeg,
            projection="equirectangular",
            width=w,
            height=h,
            camera_model=model,
            metadata={
                "engine": "mediasdk",
                "mediasdk_version": m.group(1) if m else None,
                "stitch_type": stitch_type,
                "flowstate": bool(s.MEDIASDK_ENABLE_FLOWSTATE),
                "cuda_requested": bool(use_cuda),
                "cuda_used_setting": bool(used[0]),
                "image_accel": used[1],
                "accel_fallback": used != attempts[0],
                # What the SDK reported it actually ran on; 'gpu' only on positive evidence in its own log.
                "accel_observed": observed["accel"],
                "gl_renderer": observed["gl_renderer"],
                "vulkan_device": observed["vulkan_device"],
                "blender": observed["blender"],
                "original_format": suffix.lstrip("."),
                "yaw_roll_degrees": yaw_roll,
                "processing_seconds": duration,
                "queued_seconds": round(queue_wait, 2),
            },
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _stitch_remote_impl(data: bytes, filename: str, *, out_w: Optional[int] = None, **_: object) -> StitchResult:
    """Send the capture to the separately deployed stitch worker; re-validate what comes back."""
    import httpx

    s = _settings()
    url = s.MEDIASDK_WORKER_URL.strip().rstrip("/") + "/v1/stitch"
    headers = {
        "Content-Type": "application/octet-stream",
        "X-Filename": Path(filename).name,
        "X-Output-Width": str(int(out_w or s.MEDIASDK_OUTPUT_WIDTH)),
    }
    token = (getattr(s, "MEDIASDK_WORKER_TOKEN", "") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    started = time.monotonic()
    try:
        resp = httpx.post(url, content=data, headers=headers, timeout=float(s.MEDIASDK_TIMEOUT_SECONDS) + 30.0)
    except httpx.HTTPError as exc:
        raise MediaSdkStitchError(f"stitch worker unreachable ({exc.__class__.__name__})") from exc
    if resp.status_code != 200:
        try:
            detail = str(resp.json().get("detail", ""))[:300]
        except Exception:
            detail = ""
        raise MediaSdkStitchError(f"stitch worker refused the capture (HTTP {resp.status_code}): {detail or 'no detail'}")
    w, h = validate_panorama_jpeg(resp.content, enforce_wrap=True)  # never trust the worker blindly
    try:
        meta = json.loads(resp.headers.get("X-Stitch-Meta", "{}"))
    except ValueError:
        meta = {}
    meta.update({"engine": "mediasdk", "executed_on": "worker", "round_trip_seconds": round(time.monotonic() - started, 2)})
    return StitchResult(
        processed_image=resp.content, projection="equirectangular", width=w, height=h,
        camera_model=str(meta.pop("camera_model", "insta360")), metadata=meta,
    )


def stitch_locally(data: bytes, filename: str, **kwargs) -> StitchResult:
    """Run the SDK on THIS host (used by the worker service). Every failure is a MediaSdkStitchError."""
    try:
        return _stitch_local_impl(data, filename, **kwargs)
    except MediaSdkStitchError:
        raise
    except Exception as exc:
        logger.exception(f"[mediasdk] unexpected error file={filename}")
        raise MediaSdkStitchError(f"MediaSDK failed unexpectedly ({exc.__class__.__name__})") from exc


def _require_applicable(data: bytes, filename: str) -> None:
    """Raise MediaSdkNotApplicable for captures MediaSDK is not verified/able to handle (local AND remote mode)."""
    verified = {m.strip().upper() for m in (_settings().MEDIASDK_VERIFIED_MODELS or "").split(",") if m.strip()}
    model = _camera_model(data)
    if model.upper() not in verified:
        raise MediaSdkNotApplicable(
            f"camera model '{model}' is not yet verified for MediaSDK (verified: {', '.join(sorted(verified)) or 'none'})"
        )
    suffix = Path(filename).suffix.lower()
    if suffix not in _SUPPORTED_SUFFIXES:
        raise MediaSdkNotApplicable(f"MediaSDK ImageStitcher does not support '{suffix or 'unknown'}' captures")


def stitch_with_mediasdk(data: bytes, filename: str, **kwargs) -> StitchResult:
    """Public entry point: local or remote per MEDIASDK_WORKER_URL; every failure is a MediaSdkStitchError."""
    try:
        _require_applicable(data, filename)
        if (getattr(_settings(), "MEDIASDK_WORKER_URL", "") or "").strip():
            return _stitch_remote_impl(data, filename, **kwargs)
        return _stitch_local_impl(data, filename, **kwargs)
    except MediaSdkStitchError:
        raise
    except Exception as exc:  # OSError, cv2 errors, etc. - never let these skip the fallback
        logger.exception(f"[mediasdk] unexpected error file={filename}")
        raise MediaSdkStitchError(f"MediaSDK failed unexpectedly ({exc.__class__.__name__})") from exc
