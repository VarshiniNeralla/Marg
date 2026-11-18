"""
Settings for stitching and the Insta360 MediaSDK engine.

Kept separate from ``app.core.config.Settings`` on purpose: the stitch worker (``app.stitch_worker``) must be able to
start with NO database URI and NO JWT secrets - it should never be handed production credentials. The full
``Settings`` inherits this class, so every field is defined exactly once and the API server sees the same values.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class MediaSdkSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Raw 360 files (.dng/.insp/.insv) are stitched server-side into a small
    # equirectangular JPEG BEFORE reaching Cloudinary, so the raw INPUT gets a
    # larger cap — a raw Insta360 .dng is ~35 MB. Only the stitched output must
    # fit MAX_UPLOAD_BYTES.
    MAX_RAW_UPLOAD_BYTES: int = 64 * 1024 * 1024
    STITCH_JPEG_QUALITY: int = 95
    # Stitching engine: "mediasdk_fallback" (default: Insta360 MediaSDK first, the built-in stitcher on ANY MediaSDK
    # failure), "builtin" (custom stitcher only), or "mediasdk" (MediaSDK only; a failure fails the job). When
    # MEDIASDK_CLI_PATH is unset/missing the default behaves exactly like "builtin". MEDIASDK_CLI_PATH is the SDK's
    # demo/CLI binary (MediaSDKTest[.exe]); MEDIASDK_MODEL_DIR the SDK `models/` dir (needed only for aistitch).
    STITCH_ENGINE: str = "mediasdk_fallback"
    MEDIASDK_HOME: str = ""            # SDK root: bin/MediaSDKTest, lib/, bin/models/ (CLI + models derived from it)
    MEDIASDK_CLI_PATH: str = ""        # explicit binary path; wins over MEDIASDK_HOME
    MEDIASDK_MODEL_DIR: str = ""
    MEDIASDK_LIB_PATH: str = ""        # extra shared-library dirs (os.pathsep separated)
    MEDIASDK_TIFF_LIB_DIR: str = ""    # dir holding libtiff.so.5 (SDK needs v5; Ubuntu 24.04 ships v6) - no symlinks
    MEDIASDK_IMAGE_ACCEL: str = "auto"  # "auto" | "cpu"  (SDK -image_processing_accel)
    MEDIASDK_MAX_CONCURRENCY: int = 1   # simultaneous SDK runs per process
    # Threads each SDK library may start (OpenMP/OpenBLAS/OpenCV/Mesa llvmpipe). They default to ONE PER VISIBLE CPU, so on
    # a 32-core host the SDK alone needs ~135 processes and aborts under a 128-process container limit ("Can't spawn new
    # thread"); measured peak is 45 with 2, 34 on a 4-vCPU host. 0 = do not touch (let the libraries decide).
    MEDIASDK_THREADS: int = 2
    # Separately deployed stitch worker (app.stitch_worker). When set, the API server sends captures there instead
    # of running the SDK locally. The worker itself must NOT set MEDIASDK_WORKER_URL.
    MEDIASDK_WORKER_URL: str = ""
    MEDIASDK_WORKER_TOKEN: str = ""
    MEDIASDK_STITCH_TYPE: str = "optflow"
    MEDIASDK_OUTPUT_WIDTH: int = 7680
    MEDIASDK_ENABLE_FLOWSTATE: bool = True
    MEDIASDK_ENABLE_CUDA: bool = True
    # MediaSDK centres the opposite lens from the built-in stitcher (measured 180 deg on X2/X3/X5). Output is rolled
    # by this many degrees so MediaSDK and built-in panoramas share one orientation (compare view, annotations).
    MEDIASDK_YAW_ROLL_DEGREES: float = 180.0
    # Camera models MediaSDK is allowed to stitch (comma-separated, as reported by the file's own metadata, e.g.
    # "X3,X5"). Anything else (X6 until Insta360 confirms support AND real X6 captures pass, ONE X2, unknown model)
    # goes straight to the built-in stitcher. Add a model here only after real captures have been validated.
    MEDIASDK_VERIFIED_MODELS: str = "X3,X5"
    # Route JPEG-named uploads that are Insta360 ORIGINALS (not stitched exports) into the stitch job. OFF by default:
    # a previous content-sniffing version mis-routed already-stitched X3 JPEGs and wrecked them; enable only after
    # validating real stitched-JPEG samples from your cameras. Camera uploads from the app arrive as .insp regardless.
    MEDIASDK_ROUTE_JPEG_ORIGINALS: bool = False
    MEDIASDK_TIMEOUT_SECONDS: int = 240


@lru_cache
def get_mediasdk_settings() -> MediaSdkSettings:
    """Cached MediaSDK/stitching settings; needs none of the application's required secrets."""
    return MediaSdkSettings()
