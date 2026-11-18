"""MediaSDK engine: output/input validation and engine selection (no SDK binary needed)."""
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.services import cloudinary_service as cs
from app.services import mediasdk_stitch as ms
from app.services.fisheye_stitch import StitchResult


_REAL_CHECK_RUNTIME = ms.rt.check_runtime  # captured before any test patches the shared module attribute


@pytest.fixture(autouse=True)
def _runtime_ok(monkeypatch):
    from app.services import mediasdk_runtime as rt

    monkeypatch.setattr(ms.rt, "check_runtime", lambda s, **k: rt.RuntimeReport(True, [], cli_found=True))


def _jpeg(arr: np.ndarray) -> bytes:
    buf = BytesIO()
    Image.fromarray(arr).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _textured(w=1024, h=512) -> np.ndarray:
    rng = np.random.default_rng(1)
    return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)


def test_valid_panorama_accepted():
    assert ms.validate_panorama_jpeg(_jpeg(_textured())) == (1024, 512)


def test_green_grey_sdk_output_rejected():
    # The real failure: SDK exits 0 but emits a flat green/grey panorama for a corrupt capture.
    img = np.full((512, 1024, 3), 128, np.uint8)
    img[200:, :, :] = (0, 136, 0)
    with pytest.raises(ms.MediaSdkStitchError, match="flat colour"):
        ms.validate_panorama_jpeg(_jpeg(img))


def test_wrong_aspect_and_garbage_rejected():
    with pytest.raises(ms.MediaSdkStitchError, match="2:1"):
        ms.validate_panorama_jpeg(_jpeg(_textured(800, 800)))
    with pytest.raises(ms.MediaSdkStitchError, match="not a readable"):
        ms.validate_panorama_jpeg(b"not a jpeg")


def test_truncated_capture_rejected_and_good_capture_passes():
    good = _textured(1600, 800)
    ms.validate_input_capture(_jpeg(good))
    bad = good.copy()
    bad[40:] = 128  # decoded data ends ~5% in, rest flat fill (what the corrupt X3 file looked like)
    with pytest.raises(ms.MediaSdkStitchError, match="truncated"):
        ms.validate_input_capture(_jpeg(bad))


def test_undecodable_input_defers_to_sdk():
    ms.validate_input_capture(b"\xff\xd8 garbage that PIL cannot decode")  # must not raise


def test_dng_and_missing_sdk_rejected(monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: type("S", (), {"MEDIASDK_CLI_PATH": "", "MEDIASDK_VERIFIED_MODELS": "X3,X5"})())
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    monkeypatch.setattr(ms.rt, "check_runtime", lambda s, **k: _REAL_CHECK_RUNTIME(s, use_cache=False))
    with pytest.raises(ms.MediaSdkStitchError, match="not configured"):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    cli = __file__  # any existing file
    monkeypatch.setattr(
        ms, "_settings",
        lambda: type("S", (), {"MEDIASDK_CLI_PATH": cli, "MEDIASDK_STITCH_TYPE": "optflow", "MEDIASDK_OUTPUT_WIDTH": 3840,
                               "MEDIASDK_VERIFIED_MODELS": "X3,X5"})(),
    )
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X3")
    with pytest.raises(ms.MediaSdkStitchError, match="does not support '.dng'"):
        ms.stitch_with_mediasdk(b"x", "a.dng")


def _result(engine):
    return StitchResult(_jpeg(_textured()), "equirectangular", 1024, 512, "X3", {"engine": engine})


def _engine(monkeypatch, name, available=True):
    monkeypatch.setattr(cs, "get_settings", lambda: type("S", (), {"STITCH_ENGINE": name})())
    monkeypatch.setattr(ms, "mediasdk_available", lambda: available)


def _boom(*a, **k):
    raise ms.MediaSdkStitchError("corrupt")


def _flat():
    return StitchResult(_jpeg(np.full((512, 1024, 3), 128, np.uint8)), "equirectangular", 1024, 512, "X3", {})


def test_default_engine_is_mediasdk_with_fallback():
    from app.core.config import Settings

    assert Settings.model_fields["STITCH_ENGINE"].default == "mediasdk_fallback"
    assert Settings.model_fields["MEDIASDK_YAW_ROLL_DEGREES"].default == 180.0


def test_mediasdk_success_is_primary(monkeypatch):
    _engine(monkeypatch, "mediasdk_fallback")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", lambda *a, **k: _result("mediasdk"))
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: pytest.fail("not needed"))
    assert cs._stitch_with_engine(b"x", "a.insp").metadata["engine"] == "mediasdk"


def test_builtin_engine_never_touches_mediasdk(monkeypatch):
    _engine(monkeypatch, "builtin")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", lambda *a, **k: pytest.fail("must not be called"))
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _result("builtin"))
    r = cs._stitch_with_engine(b"x", "a.insp")
    assert r.metadata["engine"] == "builtin" and r.metadata["engine_fallback"] is False


def test_sdk_not_installed_uses_builtin_silently(monkeypatch):
    _engine(monkeypatch, "mediasdk_fallback", available=False)
    monkeypatch.setattr(ms, "stitch_with_mediasdk", lambda *a, **k: pytest.fail("must not be called"))
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _result("builtin"))
    assert cs._stitch_with_engine(b"x", "a.insp").metadata["engine_fallback"] is False


def test_mediasdk_failure_falls_back_and_records_reason(monkeypatch):
    _engine(monkeypatch, "mediasdk_fallback")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", _boom)
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _result("builtin"))
    m = cs._stitch_with_engine(b"x", "a.insp").metadata
    assert m["engine_fallback"] is True and "corrupt" in m["mediasdk_failure"]


def test_mediasdk_only_engine_has_no_fallback(monkeypatch):
    _engine(monkeypatch, "mediasdk")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", _boom)
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: pytest.fail("no fallback"))
    with pytest.raises(cs.StitchEnginesFailed):
        cs._stitch_with_engine(b"x", "a.insp")


def test_both_engines_failing_raises_with_both_reasons(monkeypatch):
    _engine(monkeypatch, "mediasdk_fallback")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", _boom)
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _flat())
    with pytest.raises(cs.StitchEnginesFailed) as e:
        cs._stitch_with_engine(b"x", "a.insp")
    assert len(e.value.reasons) == 2 and e.value.reasons[0].startswith("MediaSDK") and "built-in" in e.value.reasons[1]


def test_builtin_returning_nothing_is_legacy_none_when_mediasdk_not_in_play(monkeypatch):
    # Pre-integration contract: the caller turns None into its own "could not stitch" error. Unchanged.
    _engine(monkeypatch, "builtin")
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: None)
    assert cs._stitch_with_engine(b"x", "a.insp") is None


def test_legacy_path_does_not_apply_new_validation(monkeypatch):
    # With MediaSDK disabled/uninstalled, a (flat-looking) built-in panorama is accepted exactly as before.
    for kwargs in ({"name": "builtin"}, {"name": "mediasdk_fallback", "available": False}):
        _engine(monkeypatch, **kwargs)
        monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _flat())
        assert cs._stitch_with_engine(b"x", "a.insp") is not None


def test_not_applicable_capture_takes_legacy_path(monkeypatch):
    # An unverified camera model / unsupported format is not a MediaSDK failure: legacy behaviour, no new validation.
    _engine(monkeypatch, "mediasdk_fallback")
    def refuse(*a, **k):
        raise ms.MediaSdkNotApplicable("camera model 'X2' is not yet verified")
    monkeypatch.setattr(ms, "stitch_with_mediasdk", refuse)
    monkeypatch.setattr(cs, "stitch_equirectangular_with_recovery", lambda *a, **k: _flat())
    r = cs._stitch_with_engine(b"x", "a.dng")
    assert r is not None and r.metadata["engine_fallback"] is False and "mediasdk_failure" not in r.metadata
    _engine(monkeypatch, "mediasdk")   # 'mediasdk'-only has no fallback, so it is a failure there
    with pytest.raises(cs.StitchEnginesFailed):
        cs._stitch_with_engine(b"x", "a.dng")


def test_applicability_gate_runs_before_local_or_remote(monkeypatch):
    monkeypatch.setattr(ms, "_settings", lambda: type("S", (), {"MEDIASDK_WORKER_URL": "http://w", "MEDIASDK_VERIFIED_MODELS": "X3,X5"})())
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X2")
    monkeypatch.setattr(ms, "_stitch_remote_impl", lambda *a, **k: pytest.fail("worker must not be called"))
    with pytest.raises(ms.MediaSdkNotApplicable):
        ms.stitch_with_mediasdk(b"x", "a.insp")


def test_wrap_seam_rejected_for_mediasdk_but_advisory_for_builtin():
    img = _textured(1024, 512)
    img[:, :512] = 20     # left half dark, right half bright -> edges (0 vs W-1) wildly different
    img[:, 512:] = 235
    jpg = _jpeg(img)
    with pytest.raises(ms.MediaSdkStitchError, match="wrap"):
        ms.validate_panorama_jpeg(jpg, enforce_wrap=True)
    assert ms.validate_panorama_jpeg(jpg) == (1024, 512)   # built-in path: advisory only


def test_yaw_roll_is_a_pure_180_degree_column_shift():
    import cv2

    base = _textured(1024, 512)
    base[:, :, :] = np.linspace(0, 255, 1024, dtype=np.uint8)[None, :, None]   # smooth horizontal ramp
    rolled = cv2.imdecode(np.frombuffer(ms._roll_yaw(_jpeg(base), 180.0, 95), np.uint8), cv2.IMREAD_COLOR)
    expected = np.roll(base, 512, axis=1)
    assert np.abs(rolled.astype(int) - expected.astype(int)).mean() < 3
    assert ms._roll_yaw(b"unchanged", 0.0, 95) == b"unchanged"


def test_unexpected_os_error_becomes_fallback_eligible(monkeypatch):
    def explode(*a, **k):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(ms, "_stitch_local_impl", explode)
    monkeypatch.setattr(ms, "_require_applicable", lambda *a: None)   # this test is about the failure wrapping only
    with pytest.raises(ms.MediaSdkStitchError, match="unexpectedly"):
        ms.stitch_with_mediasdk(b"x", "a.insp")


def test_launch_failure_retried_once_then_reported(monkeypatch, tmp_path):
    cli = tmp_path / "cli.exe"
    cli.write_bytes(b"x")
    monkeypatch.setattr(ms, "_settings", lambda: type("S", (), {
        "MEDIASDK_CLI_PATH": str(cli), "MEDIASDK_STITCH_TYPE": "optflow", "MEDIASDK_OUTPUT_WIDTH": 3840,
        "MEDIASDK_ENABLE_FLOWSTATE": True, "MEDIASDK_ENABLE_CUDA": True, "MEDIASDK_MODEL_DIR": "",
        "MEDIASDK_TIMEOUT_SECONDS": 5, "MEDIASDK_YAW_ROLL_DEGREES": 180.0, "STITCH_JPEG_QUALITY": 95,
        "MEDIASDK_VERIFIED_MODELS": "X3,X5"})())
    monkeypatch.setattr(ms, "_camera_model", lambda d: "X5")
    monkeypatch.setattr(ms, "validate_input_capture", lambda d: None)
    monkeypatch.setattr(ms.time, "sleep", lambda s: None)
    calls = []

    def run(*a, **k):
        calls.append(1)
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(ms.subprocess, "run", run)
    with pytest.raises(ms.MediaSdkStitchError, match="could not be started"):
        ms.stitch_with_mediasdk(b"x", "a.insp")
    assert len(calls) == 2


@pytest.mark.parametrize("model,allowed", [("X3", True), ("X5", True), ("x5", True), ("X6", False), ("ONE X2", False), ("insta360", False)])
def test_only_verified_models_use_mediasdk(monkeypatch, tmp_path, model, allowed):
    cli = tmp_path / "cli.exe"
    cli.write_bytes(b"x")
    monkeypatch.setattr(ms, "_settings", lambda: type("S", (), {
        "MEDIASDK_CLI_PATH": str(cli), "MEDIASDK_STITCH_TYPE": "optflow", "MEDIASDK_OUTPUT_WIDTH": 3840,
        "MEDIASDK_VERIFIED_MODELS": "X3, X5"})())
    monkeypatch.setattr(ms, "_camera_model", lambda d: model)
    # An unverified model must be refused BEFORE any SDK work; a verified one proceeds (and here stops at .dng).
    with pytest.raises(ms.MediaSdkStitchError) as e:
        ms.stitch_with_mediasdk(b"x", "a.dng")
    assert ("not yet verified" in str(e.value)) is (not allowed)
