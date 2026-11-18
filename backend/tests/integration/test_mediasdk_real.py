"""
Manual integration test: runs the REAL Insta360 MediaSDK binary on a REAL capture.

Skipped unless configured, so CI and machines without the SDK are unaffected:

    export MEDIASDK_HOME=/opt/MediaSDK-3.2.0-linux
    export MEDIASDK_TIFF_LIB_DIR=/opt/mediasdk-deps/usr/lib/x86_64-linux-gnu   # libtiff.so.5
    export MEDIASDK_TEST_INSP=/path/to/IMG_xxx_00_001.insp                     # an X3/X5 capture
    pytest tests/integration/test_mediasdk_real.py -s

Set MEDIASDK_TEST_INSP_DIR to also run every ``*.insp`` in a folder (multiple-image run).
"""
import os
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.core.mediasdk_config import get_mediasdk_settings
from app.services import mediasdk_runtime as rt
from app.services import mediasdk_stitch as ms

INSP = os.environ.get("MEDIASDK_TEST_INSP", "")
pytestmark = pytest.mark.skipif(
    not (os.environ.get("MEDIASDK_HOME") or os.environ.get("MEDIASDK_CLI_PATH")) or not Path(INSP).is_file(),
    reason="set MEDIASDK_HOME (or MEDIASDK_CLI_PATH) and MEDIASDK_TEST_INSP to run against the real SDK",
)


@pytest.fixture(autouse=True)
def _fresh_settings():
    get_mediasdk_settings.cache_clear()   # the adapter reads MediaSdkSettings, not the full app Settings
    yield
    get_mediasdk_settings.cache_clear()


def test_sdk_runtime_dependencies_are_satisfied():
    report = rt.check_runtime(get_mediasdk_settings(), use_cache=False)
    assert report.ok, report.summary()


def test_real_insp_is_stitched_validated_and_oriented():
    data = Path(INSP).read_bytes()
    res = ms.stitch_with_mediasdk(data, Path(INSP).name, out_w=3840)
    assert (res.width, res.height) == (3840, 1920) and res.processed_image[:2] == b"\xff\xd8"
    m = res.metadata
    assert m["engine"] == "mediasdk" and m["mediasdk_version"] and m["yaw_roll_degrees"] == get_mediasdk_settings().MEDIASDK_YAW_ROLL_DEGREES
    assert m["accel_observed"] in ("cpu", "gpu", "unknown")
    print(f"\n[real-sdk] {Path(INSP).name}: {m['processing_seconds']}s accel_observed={m['accel_observed']} "
          f"renderer={m['gl_renderer']} blender={m['blender']} v{m['mediasdk_version']}")


def test_real_jpg_named_capture_is_accepted_by_the_sdk(tmp_path):
    jpg = tmp_path / "capture.jpg"
    jpg.write_bytes(Path(INSP).read_bytes())
    res = ms.stitch_with_mediasdk(jpg.read_bytes(), jpg.name, out_w=1920)
    assert (res.width, res.height) == (1920, 960) and res.metadata["original_format"] == "jpg"


def test_corrupt_capture_is_refused_not_published(tmp_path):
    data = bytearray(Path(INSP).read_bytes())
    cut = data[: len(data) // 12]  # truncated transfer
    with pytest.raises(ms.MediaSdkStitchError):
        ms.stitch_with_mediasdk(bytes(cut), "broken.insp", out_w=1920)


def test_cpu_only_configuration(monkeypatch):
    monkeypatch.setenv("MEDIASDK_ENABLE_CUDA", "false")
    monkeypatch.setenv("MEDIASDK_IMAGE_ACCEL", "cpu")
    get_mediasdk_settings.cache_clear()
    res = ms.stitch_with_mediasdk(Path(INSP).read_bytes(), Path(INSP).name, out_w=1920)
    assert res.metadata["cuda_used_setting"] is False and res.metadata["image_accel"] == "cpu"


def test_multiple_images_in_a_folder():
    folder = os.environ.get("MEDIASDK_TEST_INSP_DIR")
    if not folder:
        pytest.skip("set MEDIASDK_TEST_INSP_DIR for the multi-image run")
    files = sorted(Path(folder).glob("*.insp"))[:8]
    assert files
    for f in files:
        res = ms.stitch_with_mediasdk(f.read_bytes(), f.name, out_w=1920)
        assert res.width == 1920
