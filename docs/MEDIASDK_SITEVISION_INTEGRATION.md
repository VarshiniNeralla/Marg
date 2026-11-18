# MediaSDK in SiteVision: integration report

> **Current status and the production plan:** see [MEDIASDK_PRODUCTION_ROLLOUT.md](MEDIASDK_PRODUCTION_ROLLOUT.md). Where this older document disagrees with it (Docker image, libtiff handling, thread caps), the rollout document is right.


Branch `feature/mediasdk-sitevision-integration` (based on the current working commit; nothing committed or pushed).
MediaSDK 3.2.0 is the primary still-image stitcher for X3 and X5; `fisheye_stitch.py` stays as the automatic fallback.
Camera discovery/connection/capture, the upload API, storage layout, job/retry mechanics and the viewer are unchanged.

## 1. Processing flow

```
capture (.insp) -> upload endpoint (workflow._upload_files) -> background job (capture_stitch_service, MongoDB, retry)
  -> cloudinary_service.upload_media -> _stitch_with_engine
       1. MediaSDK 3.2.0 (X3/X5 only; local process OR the separate stitch worker)
            input pre-check -> SDK run (CPU-safe, one at a time) -> output validation -> 180 deg yaw alignment -> validate again
       2. ANY problem (not installed, rejected input, crash, timeout, invalid output, unverified model, .dng/.insv)
            -> custom stitcher (fisheye_stitch.py) -> output validation
       3. both fail -> job FAILED with both reasons, capture marked failed, raw file kept for retry; nothing is published
  -> existing GPano tagging -> existing storage (local/S3) -> job + capture documents updated -> client polls job status
```
Output validation (both engines): file exists and decodes, 2:1, not flat/degenerate, panorama wraps at the seam (enforced for
MediaSDK, advisory for the custom stitcher). An SDK exit code is never trusted on its own: a corrupt original makes the SDK
exit 0 and write a flat green/grey panorama.

## 2. Files

| File | Change |
|---|---|
| `backend/app/services/mediasdk_stitch.py` (new) | adapter: local or remote execution, CPU retry, concurrency cap, validation, yaw alignment, JPEG-original sniff |
| `backend/app/services/mediasdk_runtime.py` (new) | SDK paths, library env, dependency check (`ldd`), NVIDIA probe, log parsing of what the SDK actually ran on |
| `backend/app/core/mediasdk_config.py` (new) | MediaSDK/stitch settings in their own base class so the worker needs NO database or JWT secrets (full `Settings` inherits it) |
| `backend/app/stitch_worker.py` (new) | separate FastAPI service (`/health`, `POST /v1/stitch`, bearer token, fail-closed) |
| `backend/Dockerfile.stitch-worker`, `backend/requirements-worker.txt` (new) | worker image matching the AWS-tested environment (Ubuntu 22.04, native libtiff5, Mesa CPU rendering, Python 3.12 via uv) |
| `backend/app/services/cloudinary_service.py` | `_stitch_with_engine` (MediaSDK first, fallback, both-engine validation, `StitchEnginesFailed` -> clear error) |
| `backend/app/api/v1/endpoints/workflow.py` | opt-in hook routing JPEG-named Insta360 originals into the stitch job (off by default); two ADDITIVE payload fields `stitchEngine` and `stitchFallbackReason`, stored on the job and capture so the fallback rate is readable from MongoDB |
| `backend/app/core/config.py` | `Settings` now inherits `MediaSdkSettings`; the same fields, defined once |
| `docker-compose.yml` | optional `stitch-worker` profile: 2 CPUs, 4 GB, 128 pids, read-only fs, no capabilities, no published ports, SDK mounted read-only |
| `backend/.env.example`, `.gitignore`, `backend/tests/conftest.py` | new settings documented; SDK files and `*.insp` can never be committed; one marker |
| tests (5 files) + `docs/` | see section 5 |
Not mine and left alone: `backend/infra/ecr/sitevision-ecr.yaml`, `docs/TENANT_ONBOARDING.md` (pre-existing local changes).

## 3. Environment variables (all optional; defaults are the safe intended setup)

`STITCH_ENGINE=mediasdk_fallback` (default; `builtin` = custom only; `mediasdk` = no fallback) - `MEDIASDK_HOME` (SDK root:
`bin/MediaSDKTest`, `lib/`, `bin/models/`) - `MEDIASDK_CLI_PATH`, `MEDIASDK_MODEL_DIR`, `MEDIASDK_LIB_PATH`, `MEDIASDK_TIFF_LIB_DIR`
(only if libtiff.so.5 is not native) - `MEDIASDK_STITCH_TYPE=optflow` - `MEDIASDK_OUTPUT_WIDTH=7680` - `MEDIASDK_ENABLE_CUDA`
(requested only) - `MEDIASDK_IMAGE_ACCEL=auto|cpu` - `MEDIASDK_TIMEOUT_SECONDS=240` - `MEDIASDK_MAX_CONCURRENCY=1` -
`MEDIASDK_VERIFIED_MODELS=X3,X5` (X6/X2/unknown go to the custom stitcher) - `MEDIASDK_YAW_ROLL_DEGREES=180` -
`MEDIASDK_ROUTE_JPEG_ORIGINALS=false` - `MEDIASDK_WORKER_URL` / `MEDIASDK_WORKER_TOKEN` (API side) and `MEDIASDK_WORKER_TOKEN`
(worker side). With `MEDIASDK_HOME`/`MEDIASDK_WORKER_URL` unset the default behaves exactly like `builtin`.

## 4. Docker
Worker image: `backend/Dockerfile.stitch-worker`. The SDK is not in the image: extract the official `.deb`
(`dpkg-deb -x MediaSDK-3.2.0-linux-amd64.deb /srv/mediasdk`) and mount `/srv/mediasdk/opt/MediaSDK-3.2.0-linux` read-only.
`docker compose --profile stitch-worker up -d --build stitch-worker` with `MEDIASDK_HOST_DIR` and `MEDIASDK_WORKER_TOKEN` set;
the API then needs `MEDIASDK_WORKER_URL=http://stitch-worker:8010` and the same token. **The image is built and verified**
(2026-11-18, Docker Desktop, 1.24 GB): it ran real X3 and X5 stitches under the production limits. The default compose
services are unchanged.

## 5. Tests
* Windows: full backend unit suite **967 passed, 1 skipped**.
* Linux (Ubuntu 24.04 WSL2, real SDK 3.2.0): the 5 MediaSDK test files **75 passed** (6 of them run the real SDK).
* New coverage: X3 `.insp`, X5 `.insp`, JPEG-named copies, invalid input, corrupt input, missing SDK library, SDK failure/timeout/launch
  failure, invalid SDK output, automatic fallback, both engines failing, verified-model gating, background job completion, storage
  output, database status updates, the status the client polls, retry after failure, deduplication, the separate worker (auth,
  size limits, failures), the API-to-worker path, worker needs no secrets, opt-in JPEG routing through the real upload endpoint.
* Real-process check in WSL: worker started from a fresh venv of only `requirements-worker.txt` in a directory with no `.env`;
  API-side adapter used it with no local SDK; bad token 401, garbage input 422, all 4 real captures stitched on CPU.
* Job tests use the real job service, real `upload_media` with local storage and mongomock; only the SDK process and the custom
  stitcher's output are faked. The S3 object-store backend and Cloudinary are shared code that was not changed or exercised.

## 6. Comparison on identical original captures (Linux, MediaSDK on CPU vs custom stitcher, 3840 wide)
12 X3 files (11 valid + the known corrupt capture, which both engines correctly reject) and 1 X5 file. Metrics are crude.

| | X3 (11 pairs) | X5 (1 pair) |
|---|---|---|
| Time, MediaSDK / custom | 1.7 s / 11.0 s (median) | 1.7 s / 11.3 s |
| Time at 7680x3840 (x3_a / x5) | 1.9-2.9 s / 38 s | 2.3 s / 38 s |
| Sharpness (Laplacian), MediaSDK vs custom | median 0.93; custom higher on 11/11 | 0.94; custom higher |
| Colour cast \|R-B\| | 0.053 vs 0.065 (MediaSDK lower, 1 file reversed) | 0.028 vs 0.040 |
| Seam continuity ratio | 1.29 vs 1.66 (mixed: 2 files worse) | 2.44 vs 1.39 (MediaSDK worse) |
| Panorama yaw offset after alignment | <= 1.5 deg, never mirrored | 1.5 deg |
| Viewer opening view, horizontal offset | median 0.4 deg | 2.1 deg |
| Viewer opening view, framing | custom about 6% more magnified, about 4 deg vertical offset | about 10%, 2 deg |
| 7680 file size | 5.5 vs 5.3 MB | 3.3 vs 3.1 MB |

Reading: MediaSDK is about 6x faster and uses far less memory. The start heading is preserved (same subject, same direction; the
viewer opens on the image centre, GPano heading 0, for both). It is NOT sharper by this metric (about 7% lower), and colour and seams
are a mixed result. The framing difference is a projection-scale difference between two stitchers; which one is geometrically
correct was not established. Orientation was checked by emulating the viewer's opening view (rectilinear, 72 degrees, heading 0,
pitch 0) from both outputs; the actual PSV viewer was not run in a browser. Only a few comparison images were looked at.

## 7. Remaining issues
1. (Resolved 2026-11-18) The worker image is built and run; the remaining Docker item is the CI build and the production run.
2. JPEG-named originals: routing exists but is OFF. No Insta360-marked JPEG other than renamed `.insp` copies exists locally, so the
   "unstitched original" marker could not be tested against an already-stitched Insta360 JPEG. Provide 2-3 in-camera-stitched X3/X5
   JPEGs before enabling. App camera uploads already arrive as `.insp`.
3. X5: one capture only (and the SDK's seam metric was worse on it). More X5 captures are needed.
4. Quality parity with the custom stitcher is not demonstrated beyond the metrics above; consider a side-by-side review by the team.
5. The 6% scale / 4 deg vertical framing difference means yaw/pitch annotations made on a capture stitched by one engine would sit a
   few degrees off if that capture were re-stitched by the other (retry after a fallback). Not a problem for new captures.
6. Not tested alongside the live application; keep `MEDIASDK_MAX_CONCURRENCY=1` and prefer the separate worker. Insta360 officially
   documents a GPU for 3.x and a CPU-only run is experimental; production licensing/redistribution terms are unconfirmed.
7. Worker traffic is plain HTTP with a bearer token (fine inside one compose network; use TLS across hosts).

## 8. Run and test it locally (Linux or WSL)
```bash
# 1. SDK: extract the official package once
dpkg-deb -x MediaSDK-3.2.0-linux-amd64.deb ~/mediasdk          # -> ~/mediasdk/opt/MediaSDK-3.2.0-linux
# 2. backend env (in-process mode, no worker)
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
export MEDIASDK_HOME=~/mediasdk/opt/MediaSDK-3.2.0-linux
export MEDIASDK_TIFF_LIB_DIR=/path/with/libtiff.so.5            # only if your distro lacks libtiff5 (Ubuntu 22.04 has it)
export UPLOAD_ROOT=/tmp/sv_uploads                               # keep a Windows UPLOAD_ROOT from .env out of Linux runs
uvicorn app.main:app --port 8002                                 # upload a capture through the app as usual
#    confirm the engine: the capture's media asset has stitchEngine == "mediasdk" (and stitchFallbackReason when the custom
#    stitcher took over); logs show "[mediasdk] ok ... accel_observed=cpu"
# 3. or worker mode (separate process)
MEDIASDK_WORKER_TOKEN=change-me uvicorn app.stitch_worker:app --port 8010      # no DB/JWT settings needed
export MEDIASDK_WORKER_URL=http://127.0.0.1:8010 MEDIASDK_WORKER_TOKEN=change-me   # on the API server
# 4. tests
pytest tests/unit                                                # everything (SDK tests mocked)
MEDIASDK_TEST_INSP=/path/IMG.insp MEDIASDK_TEST_INSP_DIR=/path/folder pytest tests/integration/test_mediasdk_real.py -s
```
Force a fallback on purpose: `MEDIASDK_VERIFIED_MODELS=` (empty) sends everything to the custom stitcher.

## 9. Staging/production plan (nothing has been deployed)
1. Build the worker image once on a networked host (a throwaway instance is enough) and run the real-SDK tests inside it.
2. Staging: one worker container, API with `STITCH_ENGINE=mediasdk_fallback` and `MEDIASDK_WORKER_URL`; capture 20+ real X3 and as many
   X5 files; watch fallback rate, job failures and memory.
3. Only then consider production: configuration is additive (default behaves like `builtin` until the worker URL is set). Production
   changes, environment variables and any AWS changes need your approval first.
