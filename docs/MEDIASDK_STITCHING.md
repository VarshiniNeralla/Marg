# MediaSDK stitching (primary) with custom fallback

> **Current status and the production plan:** see [MEDIASDK_PRODUCTION_ROLLOUT.md](MEDIASDK_PRODUCTION_ROLLOUT.md). Where this older document disagrees with it (Docker image, libtiff handling, thread caps), the rollout document is right.


`STITCH_ENGINE=mediasdk_fallback` (default). MediaSDK stitches X3/X5 `.insp` first; anything else, or any MediaSDK
problem, runs the built-in stitcher. Both outputs are validated; if both fail the job fails with a clear message.

## Settings (backend env)
| Variable | Default | Meaning |
|---|---|---|
| STITCH_ENGINE | mediasdk_fallback | `builtin`, `mediasdk_fallback`, `mediasdk` (no fallback) |
| MEDIASDK_CLI_PATH | empty | SDK CLI binary (`MediaSDKTest`); empty = behaves like `builtin` |
| MEDIASDK_MODEL_DIR | empty | SDK `models/` dir (aistitch only) |
| MEDIASDK_STITCH_TYPE | optflow | template / optflow / dynamicstitch / aistitch |
| MEDIASDK_OUTPUT_WIDTH | 7680 | height = width/2 |
| MEDIASDK_VERIFIED_MODELS | X3,X5 | models allowed on MediaSDK; add X6 only after real X6 captures pass |
| MEDIASDK_YAW_ROLL_DEGREES | 180 | aligns MediaSDK to built-in orientation (measured on X3/X5) |
| MEDIASDK_TIMEOUT_SECONDS | 240 | per-file SDK timeout |

## Linux production
Superseded by [MEDIASDK_LINUX_MIGRATION.md](MEDIASDK_LINUX_MIGRATION.md). Summary: the Linux SDK 3.2.0 was run for real on
Ubuntu 24.04 (WSL2) and stitches on CPU only (llvmpipe) in about 1.3 s at 7680 wide with about 1.8 GB peak memory, so the
earlier assumption that a GPU is mandatory is NOT supported by testing. GPU acceleration and the Insta360 licence terms
for production use remain NOT verified. The worker Docker image is built and verified (see the rollout document).
