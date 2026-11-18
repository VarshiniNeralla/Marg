"""
End-to-end through the REAL job service, upload_media and local storage (temp dir), with a mongomock database.
Only two things are faked: the MediaSDK process (subprocess) and the custom stitcher's output.

Covers: MediaSDK success, automatic fallback, both-engines-failed (clear error + capture marked failed + raw kept),
corrupt input, retry after a failure, storage output, database status updates and the status the client polls.
"""
import asyncio
import hashlib
from io import BytesIO
from types import SimpleNamespace

import numpy as np
import pytest
from mongomock_motor import AsyncMongoMockClient
from PIL import Image

from app.core.config import get_settings
from app.services import capture_stitch_service as css
from app.services import cloudinary_service as cs
from app.services import mediasdk_runtime as rt
from app.services import mediasdk_stitch as ms
from app.services.fisheye_stitch import StitchResult

ORG = "o1"


def _jpeg(w=3840, h=1920, flat=False) -> bytes:
    """A structured, seam-continuous synthetic panorama (random noise averages to grey and is correctly called blank)."""
    if flat:
        arr = np.full((h, w, 3), 128, np.uint8)
    else:
        yy = np.linspace(0, 1, h)[:, None]
        xx = np.linspace(0, 2 * np.pi, w, endpoint=False)[None, :]   # periodic in x: left and right edges match
        r = 128 + 100 * np.sin(3 * xx) + 0 * yy
        g = 128 + 100 * np.sin(5 * xx + 1) * (0.4 + 0.6 * yy)
        b = 40 + 180 * yy + 20 * np.sin(7 * xx)
        arr = np.clip(np.stack([r, g, b], axis=-1), 0, 255).astype(np.uint8)
    buf = BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture
def world(tmp_path, monkeypatch):
    """Real services, fake SDK process. `world.sdk` is the list of (rc, writes_output, log) the fake SDK will play."""
    s = get_settings()
    monkeypatch.setattr(s, "MEDIA_STORAGE", "local")
    monkeypatch.setattr(s, "UPLOAD_ROOT", str(tmp_path / "uploads"))
    monkeypatch.setattr(s, "STITCH_ENGINE", "mediasdk_fallback")
    monkeypatch.setattr(s, "RETAIN_RAW_CAPTURES", False)

    cli = tmp_path / "bin" / "MediaSDKTest"
    cli.parent.mkdir(parents=True)
    cli.write_bytes(b"x")
    cfg = SimpleNamespace(
        MEDIASDK_HOME="", MEDIASDK_CLI_PATH=str(cli), MEDIASDK_MODEL_DIR="", MEDIASDK_LIB_PATH="", MEDIASDK_TIFF_LIB_DIR="",
        MEDIASDK_STITCH_TYPE="optflow", MEDIASDK_OUTPUT_WIDTH=3840, MEDIASDK_ENABLE_FLOWSTATE=True, MEDIASDK_ENABLE_CUDA=False,
        MEDIASDK_IMAGE_ACCEL="cpu", MEDIASDK_MAX_CONCURRENCY=1, MEDIASDK_TIMEOUT_SECONDS=30, MEDIASDK_YAW_ROLL_DEGREES=180.0,
        MEDIASDK_VERIFIED_MODELS="X3,X5", MEDIASDK_WORKER_URL="", MEDIASDK_WORKER_TOKEN="", STITCH_JPEG_QUALITY=90,
    )
    monkeypatch.setattr(ms, "_settings", lambda: cfg)
    monkeypatch.setattr(ms.rt, "check_runtime", lambda s_, **k: rt.RuntimeReport(True, [], cli_found=True))
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")

    w = SimpleNamespace(sdk=[(0, True, "GL_RENDERER: llvmpipe\nblender type: BGR_CPU\n")], sdk_calls=0, builtin=None, builtin_calls=0)

    def fake_run(cmd, **k):
        rc, writes, log = w.sdk[min(w.sdk_calls, len(w.sdk) - 1)]
        w.sdk_calls += 1
        if writes:
            open(cmd[cmd.index("-output") + 1], "wb").write(_jpeg())
        return SimpleNamespace(returncode=rc, stdout="SDK version: 3.2.0\n" + log, stderr="")

    monkeypatch.setattr(ms.subprocess, "run", fake_run)

    def fake_builtin(data, filename, **k):
        w.builtin_calls += 1
        return w.builtin

    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", fake_builtin)
    monkeypatch.setattr(css.CaptureStitchService, "_dispatch", lambda self, job_id: None)  # tests run jobs explicitly
    w.db = AsyncMongoMockClient()["t"]
    w.svc = css.CaptureStitchService(w.db)
    w.tmp = tmp_path
    return w


def _builtin_ok():
    return StitchResult(_jpeg(), "equirectangular", 3840, 1920, "X3", {"projection": "equirectangular"})


async def _submit(w, raw: bytes = b"original-capture-bytes", filename="IMG_20261118_000001_00_001.insp"):
    spool = w.tmp / "spool" / (hashlib.sha256(raw).hexdigest() + ".insp")
    spool.parent.mkdir(exist_ok=True)
    spool.write_bytes(raw)
    folder = cs.cloudinary_folder("captures", ORG, "pin1")
    job = await w.svc.start_stitch(
        org_id=ORG, dedup_key=f"{ORG}:{hashlib.sha256(raw).hexdigest()}", cached_asset=None, raw_path=str(spool),
        filename=filename, ext=".insp", folder=folder, entity_id="pin1",
    )
    job_id = job["jobId"]
    # the client's capture record, created from the pending payload, carries the job id
    await w.db["captures"].insert_one({"_id": "cap1", "orgId": ORG, "stitchJobId": job_id, "processingStatus": "processing",
                                       "processing_status": "processing"})
    return job_id, spool


async def _run(w, job_id):
    await asyncio.wait_for(w.svc._run_job(job_id), timeout=60)
    return await w.svc.get_job(org_id=ORG, job_id=job_id)


@pytest.mark.asyncio
async def test_mediasdk_success_completes_job_stores_panorama_and_updates_capture(world):
    job_id, spool = await _submit(world)
    queued = await world.svc.get_job(org_id=ORG, job_id=job_id)
    assert queued["status"] == css.JOB_STATUS_PENDING                       # what the client sees before the job runs

    job = await _run(world, job_id)
    assert job["status"] == css.JOB_STATUS_COMPLETED and job["error"] is None
    assert world.sdk_calls == 1 and world.builtin_calls == 0               # MediaSDK first; custom stitcher never needed
    asset = job["asset"]
    assert asset["stitchJobId"] == job_id and asset.get("processed_panorama_url")
    assert asset["stitchEngine"] == "mediasdk" and asset["stitchFallbackReason"] is None   # recorded for monitoring
    stored = list((world.tmp / "uploads").rglob("*.jpg"))                   # the panorama really landed in storage
    assert stored and stored[0].read_bytes()[:2] == b"\xff\xd8"
    assert not spool.exists()                                               # spool freed after success
    cap = await world.db["captures"].find_one({"_id": "cap1"})
    assert cap["processedPanoramaUrl"] == asset["processed_panorama_url"]                 # capture record points at the panorama
    assert cap["processingStatus"] == asset["processing_status"] != "processing"          # no longer "processing"
    assert cap["stitchError"] is None and cap["mediaAssets"] == [asset]
    doc = await world.db[css.COLLECTION_JOBS].find_one({"_id": job_id})
    assert doc["status"] == css.JOB_STATUS_COMPLETED and doc["completedAt"] and doc["heartbeatAt"]


@pytest.mark.asyncio
async def test_sdk_failure_falls_back_to_custom_stitcher_automatically(world):
    world.sdk = [(1, False, "MediaSDK crashed")]
    world.builtin = _builtin_ok()
    job = await _run(world, (await _submit(world))[0])
    assert job["status"] == css.JOB_STATUS_COMPLETED                        # the user still gets a panorama
    assert world.builtin_calls == 1 and world.sdk_calls >= 1
    assert job["asset"]["stitchEngine"] == "builtin" and "MediaSDK" in job["asset"]["stitchFallbackReason"]
    cap = await world.db["captures"].find_one({"_id": "cap1"})
    assert cap["mediaAssets"][0]["stitchEngine"] == "builtin"               # persisted on the capture record too


@pytest.mark.asyncio
async def test_invalid_sdk_output_is_not_trusted_and_falls_back(world, monkeypatch):
    # SDK exits 0 but writes a flat grey/green panorama (the real corrupt-input behaviour)
    def flat_run(cmd, **k):
        open(cmd[cmd.index("-output") + 1], "wb").write(_jpeg(flat=True))
        return SimpleNamespace(returncode=0, stdout="SDK version: 3.2.0\n", stderr="")

    monkeypatch.setattr(ms.subprocess, "run", flat_run)
    world.builtin = _builtin_ok()
    job = await _run(world, (await _submit(world))[0])
    assert job["status"] == css.JOB_STATUS_COMPLETED and world.builtin_calls == 1


@pytest.mark.asyncio
async def test_both_engines_failing_marks_job_and_capture_failed_with_clear_error_and_keeps_raw(world):
    world.sdk = [(1, False, "boom")]
    world.builtin = StitchResult(_jpeg(flat=True), "equirectangular", 3840, 1920, "X3", {})   # custom engine output is also invalid
    job_id, spool = await _submit(world)
    job = await _run(world, job_id)
    assert job["status"] == css.JOB_STATUS_FAILED
    assert "MediaSDK" in job["error"] and "built-in stitcher" in job["error"]            # both reasons reported
    assert job["canRetry"] is True and spool.exists()                                     # raw kept so it can be retried
    assert not list((world.tmp / "uploads").rglob("*.jpg"))                               # nothing invalid was published
    cap = await world.db["captures"].find_one({"_id": "cap1"})
    assert cap.get("processingStatus") == "failed" or cap.get("processing_status") == "failed"
    assert cap.get("stitchError")


@pytest.mark.asyncio
async def test_corrupt_capture_is_never_published(world):
    # a truncated original: valid first rows, flat grey afterwards (the real failure mode)
    arr = np.random.default_rng(1).integers(0, 255, (800, 1600, 3), dtype=np.uint8)
    arr[40:] = 128
    buf = BytesIO()
    Image.fromarray(arr).save(buf, "JPEG")
    world.builtin = StitchResult(_jpeg(flat=True), "equirectangular", 3840, 1920, "X3", {})
    job = await _run(world, (await _submit(world, raw=buf.getvalue()))[0])
    assert job["status"] == css.JOB_STATUS_FAILED and world.sdk_calls == 0                # rejected before the SDK even ran
    assert "truncated" in job["error"]
    assert not list((world.tmp / "uploads").rglob("*.jpg"))


@pytest.mark.asyncio
async def test_retry_after_failure_completes_using_the_kept_raw_file(world):
    world.sdk = [(1, False, "transient")]
    world.builtin = None                                                                   # custom engine produces nothing
    job_id, spool = await _submit(world)
    assert (await _run(world, job_id))["status"] == css.JOB_STATUS_FAILED

    world.sdk = [(0, True, "GL_RENDERER: llvmpipe\nblender type: BGR_CPU\n")]              # the problem is fixed
    world.sdk_calls = 0
    requeued = await world.svc.retry_job(org_id=ORG, job_id=job_id)
    assert requeued["status"] == css.JOB_STATUS_PENDING and requeued["error"] is None
    cap = await world.db["captures"].find_one({"_id": "cap1"})
    assert cap.get("stitchError") is None                                                  # UI shows 'processing' again
    job = await _run(world, job_id)
    assert job["status"] == css.JOB_STATUS_COMPLETED and job["asset"]["stitchJobId"] == job_id


@pytest.mark.asyncio
async def test_unverified_camera_model_uses_custom_stitcher(world, monkeypatch):
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X6")          # X6 is not verified for MediaSDK
    world.builtin = _builtin_ok()
    job = await _run(world, (await _submit(world))[0])
    assert job["status"] == css.JOB_STATUS_COMPLETED and world.sdk_calls == 0 and world.builtin_calls == 1


@pytest.mark.asyncio
async def test_identical_upload_is_deduplicated_not_stitched_twice(world):
    job_id, _ = await _submit(world)
    await _run(world, job_id)
    calls = world.sdk_calls
    dedup = await world.db["capture_upload_dedup"].count_documents({})
    assert dedup >= 1                                                  # result cached under the bytes' hash
    again = await world.svc.start_stitch(
        org_id=ORG, dedup_key=f"{ORG}:{hashlib.sha256(b'original-capture-bytes').hexdigest()}",
        cached_asset=(await world.svc.get_job(org_id=ORG, job_id=job_id))["asset"], raw_path=str(world.tmp / "gone.insp"),
        filename="again.insp", ext=".insp", folder=cs.cloudinary_folder("captures", ORG, "pin1"), entity_id="pin1",
    )
    assert again["status"] == css.JOB_STATUS_COMPLETED and again["jobId"] is None and world.sdk_calls == calls
