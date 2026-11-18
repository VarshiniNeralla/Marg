"""Linux runtime for the MediaSDK engine: paths/env, dependency validation, CPU fallback, GPU detection,
concurrency, the separate stitch worker and its client. SDK execution is mocked; see
tests/integration/test_mediasdk_real.py for the opt-in real-SDK test."""
import os
import subprocess
import threading
import time
from io import BytesIO
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import stitch_worker
from app.services import mediasdk_runtime as rt
from app.services import mediasdk_stitch as ms


_REAL_CHECK = rt.check_runtime  # the real function, captured before the autouse stub replaces it


@pytest.fixture(autouse=True)
def _runtime_stub(request, monkeypatch):
    """Most tests mock the SDK process; keep the (real, ldd-running) dependency check out of their way."""
    if "real_runtime_check" in request.keywords:
        return
    monkeypatch.setattr(ms.rt, "check_runtime", lambda s, **k: rt.RuntimeReport(True, [], cli_found=True))


def _jpeg(w=1024, h=512) -> bytes:
    buf = BytesIO()
    Image.fromarray(np.random.default_rng(3).integers(0, 255, (h, w, 3), dtype=np.uint8)).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _settings(tmp_path, **over):
    cli = tmp_path / "bin" / "MediaSDKTest"
    if not cli.exists():  # settings factories can be called from many threads; never rewrite the file concurrently
        cli.parent.mkdir(parents=True, exist_ok=True)
        cli.write_bytes(b"#!/bin/sh\n")
        cli.chmod(0o755)
    base = dict(
        MEDIASDK_HOME="", MEDIASDK_CLI_PATH=str(cli), MEDIASDK_MODEL_DIR="", MEDIASDK_LIB_PATH="",
        MEDIASDK_TIFF_LIB_DIR="", MEDIASDK_STITCH_TYPE="optflow", MEDIASDK_OUTPUT_WIDTH=3840,
        MEDIASDK_ENABLE_FLOWSTATE=True, MEDIASDK_ENABLE_CUDA=True, MEDIASDK_IMAGE_ACCEL="auto",
        MEDIASDK_MAX_CONCURRENCY=1, MEDIASDK_TIMEOUT_SECONDS=30, MEDIASDK_YAW_ROLL_DEGREES=0.0,
        MEDIASDK_VERIFIED_MODELS="X3,X5", MEDIASDK_WORKER_URL="", MEDIASDK_WORKER_TOKEN="", STITCH_JPEG_QUALITY=95,
        MAX_RAW_UPLOAD_BYTES=64 * 1024 * 1024,
    )
    base.update(over)
    return SimpleNamespace(**base)


# ── paths / environment ──────────────────────────────────────────────────────

def test_paths_derive_cli_models_and_libs_from_home(tmp_path):
    home = tmp_path / "sdk"
    (home / "bin" / "models").mkdir(parents=True)
    (home / "lib").mkdir()
    tiff = tmp_path / "tiff"
    tiff.mkdir()
    p = rt.resolve_paths(SimpleNamespace(MEDIASDK_HOME=str(home), MEDIASDK_TIFF_LIB_DIR=str(tiff)))
    assert p.cli.parent == home / "bin" and p.cli.name.startswith("MediaSDKTest")
    assert p.model_dir == home / "bin" / "models"
    assert p.lib_dirs == [home / "lib", tiff]


def test_env_prepends_lib_dirs_without_dropping_existing(tmp_path):
    tiff = tmp_path / "t"
    tiff.mkdir()
    paths = rt.SdkPaths(None, None, None, [tiff])
    env = rt.build_env(paths, {rt._LIB_ENV_VAR: "/existing"})
    assert env[rt._LIB_ENV_VAR].split(os.pathsep) == [str(tiff), "/existing"]
    assert rt.build_env(rt.SdkPaths(None, None, None, []), {"A": "1"}) == {"A": "1"}


def test_thread_caps_are_applied_but_never_override_an_explicit_value():
    paths = rt.SdkPaths(None, None, None, [])
    env = rt.build_env(paths, {"A": "1"}, threads=2)
    assert all(env[v] == "2" for v in rt.THREAD_ENV_VARS) and env["A"] == "1"
    env = rt.build_env(paths, {"OMP_NUM_THREADS": "8"}, threads=2)
    assert env["OMP_NUM_THREADS"] == "8" and env["OPENBLAS_NUM_THREADS"] == "2"      # operator's explicit value wins
    assert not any(v in rt.build_env(paths, {}, threads=0) for v in rt.THREAD_ENV_VARS)  # 0 = leave the libraries alone


def test_adapter_passes_the_thread_cap_to_the_sdk_process(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(ms, "_settings", lambda: _settings(tmp_path, MEDIASDK_THREADS=2))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    monkeypatch.setattr(rt.os, "environ", {"PATH": "x"})

    def run(cmd, **k):
        seen.update(k["env"])
        open(cmd[cmd.index("-output") + 1], "wb").write(_jpeg(3840, 1920))
        return SimpleNamespace(returncode=0, stdout=CPU_LOG, stderr="")

    monkeypatch.setattr(ms.subprocess, "run", run)
    ms.stitch_with_mediasdk(b"x", "a.insp")
    assert seen.get("OMP_NUM_THREADS") == "2" and seen.get("LP_NUM_THREADS") == "2"


def test_no_hardcoded_home_paths_in_runtime_modules():
    import inspect

    for mod in (rt, ms):
        src = inspect.getsource(mod)
        assert "/home/" not in src and "insta360-libs" not in src and "srivarshini" not in src.lower()


# ── dependency validation ────────────────────────────────────────────────────

@pytest.mark.real_runtime_check
def test_runtime_reports_missing_cli(tmp_path):
    r = _REAL_CHECK(SimpleNamespace(MEDIASDK_HOME="", MEDIASDK_CLI_PATH=str(tmp_path / "nope"), MEDIASDK_LIB_PATH="",
                                    MEDIASDK_TIFF_LIB_DIR="", MEDIASDK_MODEL_DIR=""), use_cache=False)
    assert not r.ok and "not found" in r.summary()
    r = _REAL_CHECK(SimpleNamespace(), use_cache=False)
    assert not r.ok and "not configured" in r.summary()


@pytest.mark.real_runtime_check
@pytest.mark.skipif(os.name == "nt", reason="ldd is Linux-only")
def test_runtime_flags_missing_libtiff_with_hint(tmp_path, monkeypatch):
    s = _settings(tmp_path)
    monkeypatch.setattr(rt.shutil, "which", lambda n: "/usr/bin/ldd")
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: SimpleNamespace(
        stdout="\tlibtiff.so.5 => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n"))
    r = _REAL_CHECK(s, use_cache=False)
    assert not r.ok and r.missing_libraries == ["libtiff.so.5"] and "MEDIASDK_TIFF_LIB_DIR" in r.summary()


def test_missing_library_parsed_from_loader_error():
    log = "MediaSDKTest: error while loading shared libraries: libtiff.so.5: cannot open shared object file"
    assert rt.missing_library_from_log(log) == "libtiff.so.5"
    assert rt.missing_library_from_log("all good") is None


def test_missing_library_at_runtime_is_fallback_eligible_not_retried(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    calls = []

    def run(*a, **k):
        calls.append(1)
        return SimpleNamespace(returncode=127, stdout="", stderr="error while loading shared libraries: libtiff.so.5: nope")

    monkeypatch.setattr(ms.subprocess, "run", run)
    with pytest.raises(ms.MediaSdkStitchError, match="libtiff.so.5"):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(calls) == 1  # CPU retry cannot fix a missing library


# ── CPU fallback, accel observation, formats ─────────────────────────────────

def _fake_sdk(tmp_path, monkeypatch, behaviours, **settings_over):
    """behaviours: list of (returncode, writes_output, log) consumed per subprocess call."""
    monkeypatch.setattr(ms, "_settings", lambda: _settings(tmp_path, **settings_over))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X5")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    seen = []

    def run(cmd, **k):
        seen.append(list(cmd))
        rc, writes, log = behaviours[min(len(seen) - 1, len(behaviours) - 1)]
        if writes:
            open(cmd[cmd.index("-output") + 1], "wb").write(_jpeg(3840, 1920))
        return SimpleNamespace(returncode=rc, stdout="SDK version: 3.2.0\n" + log, stderr="")

    monkeypatch.setattr(ms.subprocess, "run", run)
    return seen


CPU_LOG = "GL_RENDERER: llvmpipe (LLVM 20.1.2, 256 bits)\nblender type: BGR_CPU\nflowstate ON, compute type: VULKAN\n"


def test_success_records_what_sdk_reported_not_what_was_requested(tmp_path, monkeypatch):
    seen = _fake_sdk(tmp_path, monkeypatch, [(0, True, CPU_LOG)])
    r = ms.stitch_with_mediasdk(b"x", "a.insp")
    m = r.metadata
    assert m["cuda_requested"] is True and m["accel_observed"] == "cpu" and m["gl_renderer"].startswith("llvmpipe")
    assert m["mediasdk_version"] == "3.2.0" and m["accel_fallback"] is False and r.camera_model == "X5"
    assert "-image_processing_accel" in seen[0] and "-disable_cuda" not in seen[0]


def test_failed_gpu_attempt_retries_on_cpu(tmp_path, monkeypatch):
    seen = _fake_sdk(tmp_path, monkeypatch, [(1, False, "cuda init failed"), (0, True, CPU_LOG)])
    r = ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(seen) == 2 and r.metadata["accel_fallback"] is True
    assert "-disable_cuda" in seen[1] and seen[1][seen[1].index("-image_processing_accel") + 1] == "cpu"


def test_cpu_only_configuration_has_no_retry(tmp_path, monkeypatch):
    seen = _fake_sdk(tmp_path, monkeypatch, [(1, False, "boom")], MEDIASDK_ENABLE_CUDA=False, MEDIASDK_IMAGE_ACCEL="cpu")
    with pytest.raises(ms.MediaSdkStitchError, match="exited with code 1"):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(seen) == 1 and "-disable_cuda" in seen[0]


def test_both_attempts_failing_raises(tmp_path, monkeypatch):
    seen = _fake_sdk(tmp_path, monkeypatch, [(1, False, "a"), (1, False, "b")])
    with pytest.raises(ms.MediaSdkStitchError):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(seen) == 2


def test_exit_zero_without_output_is_failure(tmp_path, monkeypatch):
    _fake_sdk(tmp_path, monkeypatch, [(0, False, "")], MEDIASDK_ENABLE_CUDA=False, MEDIASDK_IMAGE_ACCEL="cpu")
    with pytest.raises(ms.MediaSdkStitchError, match="no output"):
        ms.stitch_with_mediasdk(b"x", "a.insp")


def test_timeout_is_reported_and_not_retried(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    calls = []

    def run(cmd, **k):
        calls.append(1)
        raise subprocess.TimeoutExpired(cmd, 30)

    monkeypatch.setattr(ms.subprocess, "run", run)
    with pytest.raises(ms.MediaSdkStitchError, match="timed out"):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(calls) == 1


@pytest.mark.parametrize("name,ok", [("a.insp", True), ("a.JPG", True), ("a.jpeg", True), ("a.dng", False), ("a.insv", False), ("a", False)])
def test_supported_input_formats(tmp_path, monkeypatch, name, ok):
    _fake_sdk(tmp_path, monkeypatch, [(0, True, CPU_LOG)])
    if ok:
        assert ms.stitch_with_mediasdk(b"x", name).metadata["original_format"] == name.rsplit(".", 1)[-1].lower()
    else:
        with pytest.raises(ms.MediaSdkStitchError, match="does not support"):
            ms.stitch_with_mediasdk(b"x", name)


def test_invalid_input_rejected_before_sdk_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms.subprocess, "run", lambda *a, **k: pytest.fail("SDK must not run"))
    buf = BytesIO()
    bad = np.random.default_rng(1).integers(0, 255, (800, 1600, 3), dtype=np.uint8)
    bad[40:] = 128
    Image.fromarray(bad).save(buf, "JPEG")
    with pytest.raises(ms.MediaSdkStitchError, match="truncated"):
        ms.stitch_with_mediasdk(buf.getvalue(), "a.insp")


def test_parse_accel_gpu_only_on_positive_evidence():
    assert rt.parse_accel(CPU_LOG)["accel"] == "cpu"
    assert rt.parse_accel("GL_RENDERER: NVIDIA A10G/PCIe\nblender type: BGR_GPU\n")["accel"] == "gpu"
    assert rt.parse_accel("nothing useful")["accel"] == "unknown"
    assert rt.parse_accel("GL_RENDERER: NVIDIA A10G\nblender type: BGR_CPU")["accel"] == "cpu"


# ── GPU capability detection ─────────────────────────────────────────────────

def test_gpu_detection_absent_present_and_broken(monkeypatch):
    monkeypatch.setattr(rt.shutil, "which", lambda n: None)
    assert rt.detect_gpu() == {"nvidia_smi": False, "gpus": []}
    monkeypatch.setattr(rt.shutil, "which", lambda n: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="NVIDIA A10G, 550.54, 23028 MiB\n"))
    g = rt.detect_gpu()
    assert g["gpus"] == [{"name": "NVIDIA A10G", "driver": "550.54", "memory": "23028 MiB"}]
    monkeypatch.setattr(rt.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=9, stdout=""))
    assert rt.detect_gpu()["gpus"] == []


# ── concurrency / multiple images / background execution ─────────────────────

def test_concurrency_cap_is_enforced_across_threads(tmp_path, monkeypatch):
    cfg = _settings(tmp_path, MEDIASDK_MAX_CONCURRENCY=2)
    monkeypatch.setattr(ms, "_settings", lambda: cfg)
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    active, peak, lock = 0, 0, threading.Lock()

    def run(cmd, **k):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.4)
        open(cmd[cmd.index("-output") + 1], "wb").write(_jpeg(3840, 1920))
        with lock:
            active -= 1
        return SimpleNamespace(returncode=0, stdout=CPU_LOG, stderr="")

    monkeypatch.setattr(ms.subprocess, "run", run)
    results = []
    threads = [threading.Thread(target=lambda i=i: results.append(ms.stitch_with_mediasdk(b"x", f"{i}.insp"))) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(results) == 6 and peak == 2
    # Processing time excludes the wait for a slot; the wait is reported separately (2 slots, 6 jobs of ~0.4 s each, so
    # the last jobs wait ~0.8 s). Relative checks, not absolute ones, so a slow CI runner cannot make this flaky: had the
    # wait been counted as processing, the longest-waiting job would show processing >= queued + 0.4.
    last = max(results, key=lambda r: r.metadata["queued_seconds"])
    assert last.metadata["queued_seconds"] > 0.3
    assert last.metadata["processing_seconds"] < last.metadata["queued_seconds"]


# ── stitch worker service ────────────────────────────────────────────────────

@pytest.fixture
def worker(monkeypatch):
    s = SimpleNamespace(MEDIASDK_WORKER_TOKEN="secret-token", MAX_RAW_UPLOAD_BYTES=1024 * 1024, MEDIASDK_STITCH_TYPE="optflow",
                        MEDIASDK_ENABLE_CUDA=True, MEDIASDK_IMAGE_ACCEL="auto", MEDIASDK_MAX_CONCURRENCY=1)
    monkeypatch.setattr(stitch_worker, "get_mediasdk_settings", lambda: s)
    return TestClient(stitch_worker.app), s


def _ok_result():
    from app.services.fisheye_stitch import StitchResult

    return StitchResult(_jpeg(), "equirectangular", 1024, 512, "X5", {"engine": "mediasdk", "stitch_type": "optflow"})


def test_worker_requires_valid_token_and_fails_closed(worker, monkeypatch):
    client, s = worker
    monkeypatch.setattr(stitch_worker, "stitch_locally", lambda *a, **k: pytest.fail("must not run unauthenticated"))
    assert client.post("/v1/stitch", content=b"x").status_code == 401
    assert client.post("/v1/stitch", content=b"x", headers={"Authorization": "Bearer wrong"}).status_code == 401
    s.MEDIASDK_WORKER_TOKEN = ""
    assert client.post("/v1/stitch", content=b"x", headers={"Authorization": "Bearer "}).status_code == 503


def test_worker_returns_jpeg_and_metadata(worker, monkeypatch):
    client, _ = worker
    got = {}
    monkeypatch.setattr(stitch_worker, "stitch_locally", lambda d, f, out_w=None: got.update(f=f, w=out_w) or _ok_result())
    r = client.post("/v1/stitch", content=b"rawbytes", headers={"Authorization": "Bearer secret-token", "X-Filename": "p.insp", "X-Output-Width": "3840"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content[:2] == b"\xff\xd8"
    assert '"stitch_type": "optflow"' in r.headers["X-Stitch-Meta"] and got == {"f": "p.insp", "w": 3840}


def test_worker_reports_sdk_failure_as_422_and_limits_size(worker, monkeypatch):
    client, _ = worker

    def boom(*a, **k):
        raise ms.MediaSdkStitchError("camera model 'X6' is not yet verified")

    monkeypatch.setattr(stitch_worker, "stitch_locally", boom)
    h = {"Authorization": "Bearer secret-token"}
    r = client.post("/v1/stitch", content=b"x", headers=h)
    assert r.status_code == 422 and "not yet verified" in r.json()["detail"]
    assert client.post("/v1/stitch", content=b"x" * (1024 * 1024 + 1), headers=h).status_code == 413
    assert client.post("/v1/stitch", content=b"", headers=h).status_code == 400


def test_worker_health_hides_paths_and_reports_degraded(worker, monkeypatch):
    client, _ = worker
    monkeypatch.setattr(stitch_worker.rt, "check_runtime", lambda s: rt.RuntimeReport(False, ["missing shared libraries: libtiff.so.5"]))
    monkeypatch.setattr(stitch_worker.rt, "detect_gpu", lambda: {"nvidia_smi": False, "gpus": []})
    r = client.get("/health")
    assert r.status_code == 503 and r.json()["status"] == "degraded" and "/" not in str(r.json()["problems"]).replace("libtiff.so.5", "")


# ── API server -> worker client (separation) ─────────────────────────────────

def _client_settings(**over):
    return SimpleNamespace(MEDIASDK_WORKER_URL="http://worker:8010/", MEDIASDK_WORKER_TOKEN="secret-token",
                           MEDIASDK_OUTPUT_WIDTH=7680, MEDIASDK_TIMEOUT_SECONDS=30, MEDIASDK_VERIFIED_MODELS="X3,X5", **over)


@pytest.fixture(autouse=True)
def _x5_capture(monkeypatch):
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X5")   # the applicability gate reads the capture's trailer


def test_remote_mode_sends_capture_to_worker_and_revalidates(monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _client_settings())
    import httpx

    sent = {}

    def post(url, content, headers, timeout):
        sent.update(url=url, headers=headers, n=len(content))
        return httpx.Response(200, content=_jpeg(), headers={"X-Stitch-Meta": '{"stitch_type":"optflow","camera_model":"X5"}'})

    monkeypatch.setattr(httpx, "post", post)
    r = ms.stitch_with_mediasdk(b"capture-bytes", "p.insp")
    assert sent["url"] == "http://worker:8010/v1/stitch" and sent["headers"]["Authorization"] == "Bearer secret-token"
    assert r.metadata["executed_on"] == "worker" and r.camera_model == "X5" and r.width == 1024


def test_remote_mode_failures_are_fallback_eligible(monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _client_settings())
    import httpx

    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    with pytest.raises(ms.MediaSdkStitchError, match="unreachable"):
        ms.stitch_with_mediasdk(b"x", "p.insp")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(422, json={"detail": "corrupt"}))
    with pytest.raises(ms.MediaSdkStitchError, match="422.*corrupt"):
        ms.stitch_with_mediasdk(b"x", "p.insp")
    flat = BytesIO()
    Image.fromarray(np.full((512, 1024, 3), 128, np.uint8)).save(flat, "JPEG")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, content=flat.getvalue()))
    with pytest.raises(ms.MediaSdkStitchError, match="flat colour"):  # a bad worker answer is never trusted
        ms.stitch_with_mediasdk(b"x", "p.insp")


def test_availability_in_remote_mode_needs_only_the_url(monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: _client_settings())
    assert ms.mediasdk_available() is True


@pytest.mark.asyncio
async def test_background_job_path_runs_engine_off_the_event_loop(monkeypatch):
    """upload_media offloads stitching with to_thread; several captures run without blocking the loop."""
    import asyncio

    from anyio import to_thread

    from app.services import cloudinary_service as cs

    seen_threads = set()

    def fake_stitch(raw, filename):
        seen_threads.add(threading.get_ident())
        time.sleep(0.3)
        return _ok_result()

    monkeypatch.setattr(cs, "_stitch_with_engine", fake_stitch)
    main = threading.get_ident()
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    t = asyncio.create_task(ticker())
    results = await asyncio.gather(*[to_thread.run_sync(cs._stitch_raw_360, b"x", f"{i}.insp") for i in range(4)])
    t.cancel()
    assert all(r is not None for r in results) and main not in seen_threads and ticks > 3
