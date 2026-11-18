"""
(1) The stitch worker/adapter settings must not need production secrets.
(2) Opt-in routing of JPEG-named Insta360 ORIGINALS into the stitch job (OFF by default, never for stitched JPEGs).
"""
import hashlib
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from app.core.config import get_settings
from app.services import cloudinary_service as cs
from app.services import mediasdk_stitch as ms
from tests.unit.test_mediasdk_job_flow import _jpeg, world  # noqa: F401  (fixture reused)

MAGIC = b"8db42d694ccc418790edff439fe026bf"
BACKEND = Path(__file__).resolve().parents[2]


def _original_like(model=b"Insta360 X3") -> bytes:
    """Bytes shaped like a real original: model string near the start, Insta360 trailer marker at the very end."""
    return b"\xff\xd8" + b"\x00" * 600 + model + b"\x00" * 4000 + b"\xff\xd9" + MAGIC


def _stitched_like() -> bytes:
    return _jpeg(1024, 512)  # a stitched export: no Insta360 marker, no model string


# ── (1) worker needs no production secrets ───────────────────────────────────

def test_mediasdk_settings_load_without_any_application_secrets(monkeypatch, tmp_path):
    from app.core.mediasdk_config import MediaSdkSettings

    for k in ("MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"):
        monkeypatch.delenv(k, raising=False)
    s = MediaSdkSettings(_env_file=None)
    assert s.STITCH_ENGINE == "mediasdk_fallback" and s.MEDIASDK_MAX_CONCURRENCY == 1 and s.MEDIASDK_VERIFIED_MODELS == "X3,X5"


def test_worker_module_imports_without_loading_the_application_config():
    code = ("import sys; import app.stitch_worker; "
            "assert 'app.core.config' not in sys.modules, 'worker pulled in the full app settings (needs DB/JWT secrets)'")
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-600:]


# ── (2) JPEG-named originals ─────────────────────────────────────────────────

def test_original_marker_accepts_x3_x5_originals_and_rejects_everything_else(world, monkeypatch):  # noqa: F811
    for model, expected in {"X3": True, "X5": True, "X6": False, "ONE X2": False}.items():
        monkeypatch.setattr(ms, "_camera_model", lambda d, m=model: m)
        assert ms.is_unstitched_insta360_original(_original_like()) is expected, model
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    assert ms.is_unstitched_insta360_original(_original_like()) is True
    assert ms.is_unstitched_insta360_original(_stitched_like()) is False        # no trailer marker: a stitched export
    assert ms.is_unstitched_insta360_original(_original_like()[:-5]) is False   # marker must be at the very end


def test_routing_is_off_by_default_and_never_touches_other_extensions(world, monkeypatch):  # noqa: F811
    assert get_settings().MEDIASDK_ROUTE_JPEG_ORIGINALS is False
    assert cs._is_routed_jpeg_original(BytesIO(_original_like()), "a.jpg") is False
    monkeypatch.setattr(get_settings(), "MEDIASDK_ROUTE_JPEG_ORIGINALS", True)
    assert cs._is_routed_jpeg_original(BytesIO(_original_like()), "a.jpg") is True
    assert cs._is_routed_jpeg_original(BytesIO(_original_like()), "a.JPEG") is True
    assert cs._is_routed_jpeg_original(BytesIO(_original_like()), "a.png") is False
    assert cs._is_routed_jpeg_original(BytesIO(_stitched_like()), "a.jpg") is False   # stitched JPEG: left alone


@pytest.mark.asyncio
async def test_upload_endpoint_sends_jpeg_original_to_the_stitch_job_only_when_enabled(world, monkeypatch):  # noqa: F811
    from app.api.v1.endpoints import workflow

    ctx = SimpleNamespace(org_id="o1")
    spool_dir = world.tmp / "work"
    monkeypatch.setattr("app.services.local_media_service.private_work_dir", lambda name: spool_dir / name)

    async def upload(raw: bytes):
        f = UploadFile(file=BytesIO(raw), filename="IMG_orig.jpg")
        return await workflow._upload_files(ctx=ctx, kind="captures", files=[f], entity_id="pin1", db=world.db)

    # disabled (default): no stitch job is created for a .jpg
    await upload(_original_like() + b"a")
    assert await world.db["capture_stitch_jobs"].count_documents({}) == 0

    # enabled: the same kind of file becomes a queued stitch job, exactly like an .insp
    monkeypatch.setattr(get_settings(), "MEDIASDK_ROUTE_JPEG_ORIGINALS", True)
    uploaded, pending = await upload(_original_like() + b"b")
    assert len(pending) == 1 and not uploaded and pending[0].get("stitchJobId")
    assert await world.db["capture_stitch_jobs"].count_documents({}) == 1

    # enabled, but a stitched JPEG is left on the normal path: still no new job
    before = await world.db["capture_stitch_jobs"].count_documents({})
    try:
        await upload(_stitched_like())
    except Exception:
        pass  # whatever the normal path does with it is unchanged behaviour; only the routing matters here
    assert await world.db["capture_stitch_jobs"].count_documents({}) == before


@pytest.mark.asyncio
async def test_routed_jpeg_original_is_stitched_by_mediasdk_in_the_job(world, monkeypatch):  # noqa: F811
    from tests.unit.test_mediasdk_job_flow import _run, _submit
    from app.services import capture_stitch_service as css

    monkeypatch.setattr(get_settings(), "MEDIASDK_ROUTE_JPEG_ORIGINALS", True)
    raw = _original_like()
    spool = world.tmp / "spool" / (hashlib.sha256(raw).hexdigest() + ".jpg")
    spool.parent.mkdir(exist_ok=True)
    spool.write_bytes(raw)
    job = await world.svc.start_stitch(
        org_id="o1", dedup_key=f"o1:{hashlib.sha256(raw).hexdigest()}", cached_asset=None, raw_path=str(spool),
        filename="IMG_orig.jpg", ext=".jpg", folder=cs.cloudinary_folder("captures", "o1", "pin1"), entity_id="pin1",
    )
    done = await _run(world, job["jobId"])
    assert done["status"] == css.JOB_STATUS_COMPLETED and world.sdk_calls == 1
