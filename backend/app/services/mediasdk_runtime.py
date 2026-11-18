"""
Runtime environment for the Insta360 MediaSDK command-line binary (Linux first, Windows still works).

Everything here is configuration-driven; nothing is hard-coded to a developer machine:

* ``MEDIASDK_HOME``          SDK root (``bin/MediaSDKTest``, ``lib/``, ``bin/models/``)
* ``MEDIASDK_CLI_PATH``      explicit binary path (wins over ``MEDIASDK_HOME``)
* ``MEDIASDK_MODEL_DIR``     explicit models dir (default ``<home>/bin/models``)
* ``MEDIASDK_LIB_PATH``      extra library dirs (``os.pathsep`` separated)
* ``MEDIASDK_TIFF_LIB_DIR``  directory holding ``libtiff.so.5`` (the SDK needs v5; Ubuntu 24.04 ships v6)

The SDK binary locates its own bundled libraries through an ``$ORIGIN``-relative RPATH, so only the
libraries it does NOT bundle (libtiff.so.5) normally need to be supplied. We still prepend ``<home>/lib`` so a
relocated binary keeps working. We never create symlinks to a different libtiff ABI.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

_IS_WINDOWS = sys.platform.startswith("win")
_LIB_ENV_VAR = "PATH" if _IS_WINDOWS else "LD_LIBRARY_PATH"


@dataclass
class SdkPaths:
    home: Optional[Path]
    cli: Optional[Path]
    model_dir: Optional[Path]
    lib_dirs: list[Path] = field(default_factory=list)


def resolve_paths(s: Any) -> SdkPaths:
    """Resolve the SDK layout from settings (``s`` is the app Settings or any object with the same attributes)."""
    home_raw = (getattr(s, "MEDIASDK_HOME", "") or "").strip()
    home = Path(home_raw) if home_raw else None
    cli_raw = (getattr(s, "MEDIASDK_CLI_PATH", "") or "").strip()
    cli: Optional[Path] = Path(cli_raw) if cli_raw else None
    if cli is None and home is not None:
        cli = home / "bin" / ("MediaSDKTest.exe" if _IS_WINDOWS else "MediaSDKTest")

    model_raw = (getattr(s, "MEDIASDK_MODEL_DIR", "") or "").strip()
    model_dir: Optional[Path] = Path(model_raw) if model_raw else None
    if model_dir is None:
        for base in (home, cli.parent.parent if cli is not None else None):
            if base is not None and (base / "bin" / "models").is_dir():
                model_dir = base / "bin" / "models"
                break

    lib_dirs: list[Path] = []
    candidates: list[str] = []
    if home is not None:
        candidates.append(str(home / "lib"))
    candidates += [p for p in (getattr(s, "MEDIASDK_LIB_PATH", "") or "").split(os.pathsep) if p.strip()]
    tiff = (getattr(s, "MEDIASDK_TIFF_LIB_DIR", "") or "").strip()
    if tiff:
        candidates.append(tiff)
    for c in candidates:
        p = Path(c)
        if p.is_dir() and p not in lib_dirs:
            lib_dirs.append(p)
    return SdkPaths(home=home, cli=cli, model_dir=model_dir, lib_dirs=lib_dirs)


# Libraries bundled with / used by the SDK that size their thread pools from the number of visible CPUs.
THREAD_ENV_VARS = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "OPENCV_FOR_THREADS_NUM", "LP_NUM_THREADS")


def build_env(paths: SdkPaths, base: Optional[Mapping[str, str]] = None, threads: int = 0) -> dict[str, str]:
    """Process environment for the SDK: configured library dirs prepended and, when ``threads`` > 0, thread pools capped.

    An explicit value already present in the environment is never overridden (operators keep the last word)."""
    env = dict(os.environ if base is None else base)
    if paths.lib_dirs:
        existing = env.get(_LIB_ENV_VAR, "")
        env[_LIB_ENV_VAR] = os.pathsep.join([*map(str, paths.lib_dirs), *([existing] if existing else [])])
    if threads and threads > 0:
        for name in THREAD_ENV_VARS:
            env.setdefault(name, str(int(threads)))
    return env


@dataclass
class RuntimeReport:
    ok: bool
    problems: list[str]
    cli_found: bool = False
    missing_libraries: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return "; ".join(self.problems) if self.problems else "ok"


_LDD_MISSING = re.compile(r"^\s*(\S+)\s+=>\s+not found", re.M)
_LOAD_ERR = re.compile(r"error while loading shared libraries:\s*([^:\s]+)")
_report_cache: dict[tuple, RuntimeReport] = {}


def check_runtime(s: Any, *, use_cache: bool = True) -> RuntimeReport:
    """Validate the SDK install without running a stitch (binary present/executable, no unresolved libraries)."""
    paths = resolve_paths(s)
    key = (str(paths.cli), tuple(map(str, paths.lib_dirs)), paths.cli.stat().st_mtime if paths.cli and paths.cli.is_file() else 0)
    if use_cache and key in _report_cache:
        return _report_cache[key]

    problems: list[str] = []
    missing: list[str] = []
    if paths.cli is None:
        problems.append("MediaSDK is not configured (set MEDIASDK_HOME or MEDIASDK_CLI_PATH)")
        report = RuntimeReport(False, problems)
    elif not paths.cli.is_file():
        problems.append("MediaSDK binary not found at the configured path")
        report = RuntimeReport(False, problems)
    else:
        if not _IS_WINDOWS and not os.access(paths.cli, os.X_OK):
            problems.append("MediaSDK binary is not executable")
        if not _IS_WINDOWS and shutil.which("ldd"):
            try:
                out = subprocess.run(
                    ["ldd", str(paths.cli)], capture_output=True, text=True, timeout=30,
                    env=build_env(paths),
                ).stdout
                missing = sorted(set(_LDD_MISSING.findall(out)))
            except (OSError, subprocess.SubprocessError):
                missing = []  # ldd unusable: the real run still reports missing libraries precisely
        if missing:
            hint = " (set MEDIASDK_TIFF_LIB_DIR to a directory containing libtiff.so.5)" if any(
                m.startswith("libtiff") for m in missing
            ) else ""
            problems.append(f"missing shared libraries: {', '.join(missing)}{hint}")
        report = RuntimeReport(not problems, problems, cli_found=True, missing_libraries=missing)
    if use_cache:
        _report_cache[key] = report
    return report


def missing_library_from_log(log: str) -> Optional[str]:
    """Name of a shared library the dynamic loader could not find, from the process output (else None)."""
    m = _LOAD_ERR.search(log or "")
    return m.group(1) if m else None


# ── GPU detection / observation ──────────────────────────────────────────────

def detect_gpu() -> dict[str, Any]:
    """NVIDIA capability probe. Presence of a GPU does NOT mean the SDK used it; see ``parse_accel``."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"nvidia_smi": False, "gpus": []}
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return {"nvidia_smi": True, "gpus": [], "error": "nvidia-smi failed to run"}
    if out.returncode != 0:
        return {"nvidia_smi": True, "gpus": [], "error": "nvidia-smi reported an error"}
    gpus = []
    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 3:
            gpus.append({"name": parts[0], "driver": parts[1], "memory": parts[2]})
    return {"nvidia_smi": True, "gpus": gpus}


_SOFTWARE_RENDERERS = ("llvmpipe", "softpipe", "swrast", "lavapipe")
_RE_RENDERER = re.compile(r"GL_RENDERER:\s*(.+)")
_RE_BLENDER = re.compile(r"blender type:\s*(\w+)")
_RE_FLOW = re.compile(r"compute type:\s*(\w+)")
_RE_VKDEV = re.compile(r"device 0 :\s*(.+?)\s+type:")


def parse_accel(log: str) -> dict[str, Any]:
    """What the SDK itself reports it ran on. ``accel`` is 'cpu' / 'gpu' / 'unknown' - 'gpu' only on positive evidence.

    Evidence used: the GL renderer, the Vulkan device that flowstate computes on, and the blender type. A real GL
    renderer alone is NOT enough (verified under WSL: GL via D3D12 reported an RTX 5090 while the SDK's Vulkan device
    stayed llvmpipe and the blender stayed BGR_CPU)."""
    renderer = (_RE_RENDERER.search(log or "") or [None, None])[1]
    blender = (_RE_BLENDER.search(log or "") or [None, None])[1]
    flow = (_RE_FLOW.search(log or "") or [None, None])[1]
    renderer = renderer.strip() if renderer else None
    vk = (_RE_VKDEV.search(log or "") or [None, None])[1]
    vk = vk.strip() if vk else None
    software = any(d and any(x in d.lower() for x in _SOFTWARE_RENDERERS) for d in (renderer, vk))
    cpu_blend = bool(blender) and blender.upper().endswith("_CPU")
    if software or cpu_blend:
        accel = "cpu"
    elif renderer and blender:
        accel = "gpu"
    else:
        accel = "unknown"
    return {"accel": accel, "gl_renderer": renderer, "vulkan_device": vk, "blender": blender, "flow_compute": flow}
