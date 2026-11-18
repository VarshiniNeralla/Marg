# Linux MediaSDK 3.2.0 stitching: migration notes

> **Current status and the production plan:** see [MEDIASDK_PRODUCTION_ROLLOUT.md](MEDIASDK_PRODUCTION_ROLLOUT.md). Where this older document disagrees with it (Docker image, libtiff handling, thread caps), the rollout document is right.


Scope: still-image stitching only (no video). Camera discovery, capture, upload, storage, jobs and the viewer are
unchanged. Status of every claim below is stated as VERIFIED (run here), or NOT VERIFIED.

## 1. What existed (audit)

| Piece | File | Role |
|---|---|---|
| Upload + stitch entry | `app/services/cloudinary_service.py` (`upload_media`, `_stitch_raw_360`) | raw `.insp/.dng/.insv` is stitched off the event loop, validated, GPano-tagged, stored |
| Background jobs, dedup, retry, MongoDB | `app/services/capture_stitch_service.py` | job document + in-flight guard + spool + `STITCH_MAX_CONCURRENCY` |
| Custom stitcher (kept as fallback) | `app/services/fisheye_stitch.py` | fisheye to equirectangular |
| MediaSDK adapter | `app/services/mediasdk_stitch.py` | CLI wrapper around the SDK `ImageStitcher` |

**There was no Windows-specific code in the application.** The Windows SDK was only used for local benchmarking. The
adapter already took the binary path from configuration, but it had no Linux runtime support (library path, libtiff.so.5,
CPU/GPU handling, dependency validation, worker separation). That is what this migration adds. Nothing was deleted: the
custom stitcher stays as the automatic fallback.

## 2. New architecture

```
API server (FastAPI, existing)                      Stitch worker (new, separate process/container)
 upload -> capture_stitch_service (job, Mongo)       app/stitch_worker.py
   -> cloudinary_service._stitch_with_engine           POST /v1/stitch  (bearer token)  GET /health
        1. mediasdk_stitch.stitch_with_mediasdk  --HTTP-->   mediasdk_stitch.stitch_locally
              local mode: runs the SDK here                      mediasdk_runtime (paths, env, ldd check)
              remote mode: MEDIASDK_WORKER_URL                   MediaSDKTest  (-image_processing_accel, -disable_cuda)
        2. any failure/invalid output -> fisheye_stitch (custom)
        3. both engines' output validated; both fail -> job fails with both reasons
```

* `mediasdk_runtime.py` (new): resolves paths, builds the library environment, validates dependencies (`ldd`), probes
  NVIDIA (`nvidia-smi`), and parses what the SDK itself reports it ran on.
* `mediasdk_stitch.py`: local or remote execution, CPU retry, concurrency limit, validation, 180 degree yaw alignment.
* `stitch_worker.py` (new): the only thing the worker exposes. No database, no object-store credentials, no user data.
* `Dockerfile.stitch-worker` (new) + optional `stitch-worker` compose profile.
* Formats: `.insp`, `.jpg`, `.jpeg` are passed to the SDK. `.dng`, `.insv` are refused (the custom stitcher handles them).

## 3. Configuration (env, no hard-coded paths)

| Variable | Default | Meaning |
|---|---|---|
| STITCH_ENGINE | mediasdk_fallback | `builtin`, `mediasdk_fallback`, `mediasdk` |
| MEDIASDK_HOME | empty | SDK root; CLI = `<home>/bin/MediaSDKTest`, models = `<home>/bin/models` |
| MEDIASDK_CLI_PATH | empty | explicit binary (wins over HOME) |
| MEDIASDK_LIB_PATH | empty | extra library dirs (`:` separated) |
| MEDIASDK_TIFF_LIB_DIR | empty | directory containing `libtiff.so.5` |
| MEDIASDK_MODEL_DIR | empty | override models dir |
| MEDIASDK_STITCH_TYPE | optflow | template / optflow / dynamicstitch / aistitch |
| MEDIASDK_OUTPUT_WIDTH | 7680 | height = width / 2 |
| MEDIASDK_ENABLE_CUDA | true | SDK `-disable_cuda` when false |
| MEDIASDK_IMAGE_ACCEL | auto | `auto` or `cpu` (SDK `-image_processing_accel`) |
| MEDIASDK_TIMEOUT_SECONDS | 240 | per-file |
| MEDIASDK_MAX_CONCURRENCY | 1 | simultaneous SDK runs per process |
| MEDIASDK_VERIFIED_MODELS | X3,X5 | models allowed on MediaSDK |
| MEDIASDK_YAW_ROLL_DEGREES | 180 | orientation alignment (see section 6) |
| MEDIASDK_WORKER_URL / _TOKEN | empty | send captures to a separate worker |

`libtiff.so.5`: the SDK needs v5. Ubuntu 22.04 (the worker image) ships it natively (`libtiff5`), so nothing is configured
there. Ubuntu 24.04 ships v6 (different ABI): never symlink; extract Ubuntu's own `libtiff5` package into a private directory
and point `MEDIASDK_TIFF_LIB_DIR` at it (only needed for a 24.04 host such as the WSL test setup). The SDK finds its other
libraries itself (`$ORIGIN`-relative RPATH, VERIFIED with `ldd`).

## 4. Run the stitch worker locally (Linux / WSL)

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
export MEDIASDK_HOME=/opt/MediaSDK-3.2.0-linux                      # your extracted SDK
export MEDIASDK_TIFF_LIB_DIR=/opt/mediasdk-deps/usr/lib/x86_64-linux-gnu
export MEDIASDK_WORKER_TOKEN=change-me
uvicorn app.stitch_worker:app --host 127.0.0.1 --port 8010
curl -s localhost:8010/health                                        # sdk_ready, problems, gpu probe
curl -s -X POST localhost:8010/v1/stitch -H "Authorization: Bearer change-me" -H "X-Filename: IMG.insp" \
     -H "X-Output-Width: 3840" --data-binary @IMG.insp -o out.jpg -D -
# API server side:  MEDIASDK_WORKER_URL=http://127.0.0.1:8010  MEDIASDK_WORKER_TOKEN=change-me
```

Or in-process (no worker): set the three `MEDIASDK_*` paths above on the API server and leave `MEDIASDK_WORKER_URL` empty.

Real-SDK integration test: `MEDIASDK_HOME=... MEDIASDK_TIFF_LIB_DIR=... MEDIASDK_TEST_INSP=/path/x.insp pytest
backend/tests/integration/test_mediasdk_real.py -s` (skipped when not configured).

## 5. Docker

`backend/Dockerfile.stitch-worker` (Ubuntu 22.04, the platform of the AWS test) installs the SDK package's own dependencies
(including native `libtiff5`) plus Mesa software rendering, Python 3.12 via uv, and runs uvicorn as a non-root user.
**The SDK is not in the image**; mount it read-only at `/opt/MediaSDK-3.2.0-linux`.

**VERIFIED (2026-11-18):** the image builds (1.24 GB), starts with the production limits (2 CPU, 4 GB, 128 processes,
read-only root filesystem, no capabilities, internal network without internet) and stitched real X3 and X5 captures. Details
in the rollout document. If apt returns 403 through a proxy that blocks plain HTTP, build with
`--build-arg APT_USE_HTTPS=true` (certificate verification stays on).

## 6. Results

VERIFIED on Ubuntu 24.04 (WSL2), real SDK 3.2.0, real X3/X5 captures:
* 61 unit/integration tests pass on Linux (real SDK for the integration ones); the full Windows unit suite passes.
* Real stitches: X5 and X3 `.insp` to 3840x1920 and 7680x3840; a `.jpg`-named capture; a 4-file batch; CPU-only mode;
  a truncated capture is refused.
* Speed (32-thread CPU, `llvmpipe`): 7680x3840 optflow about 1.3 s, peak RSS about 1.8 GB; 4 cores `taskset`: 1.3 to 1.8 s.
  `template` 1.1 s, `dynamicstitch` 1.0 s, `aistitch` 9.9 s. Windows runs were about 10 s per file.
* Orientation: Linux raw output vs Windows raw output of the same file: yaw offset 0.0 degrees, correlation 1.0, so the
  180 degree alignment calibrated on Windows applies unchanged.

NOT VERIFIED:
* **GPU use.** Every Linux run so far used the CPU path (`GL_RENDERER: llvmpipe`, Vulkan device `llvmpipe`, blender
  `BGR_CPU`). With Mesa's D3D12 driver the GL renderer became the RTX 5090, but the SDK's Vulkan device stayed `llvmpipe`
  and the blender stayed `BGR_CPU`, so a real GL renderer alone is not evidence of GPU use. The SDK bundles CUDA 11.x
  libraries; compatibility with newer GPUs (e.g. Blackwell) is untested. Each capture records `accel_observed`
  (cpu / gpu / unknown) from the SDK's own log; `gpu` appears only on positive evidence. Verify on a real NVIDIA instance.
* Whether CPU and GPU outputs are equivalent in quality (only CPU has been compared with the earlier Windows output).
* The earlier Windows-only `WinError 5` failure: not reproduced, cause unknown.

## 7. Production requirements

* Ubuntu 22.04/24.04 x86_64 host or container; SDK mounted from a private artifact store (licence/redistribution terms
  for production use are NOT confirmed; check with Insta360).
* Current production host (m6a.xlarge, Amazon Linux 2023, no GPU): the SDK ran on CPU in WSL at about 1.8 GB peak
  memory, which suggests a CPU worker may be viable and a GPU may not be required. Confirm on the real instance type
  (the 1.3 s figure is from a fast 32-thread desktop CPU).
* Keep the custom stitcher as fallback until the worker has run in production.
* Do not store `MEDIASDK_WORKER_TOKEN` in source control; put it in Secrets Manager like the other app secrets.
