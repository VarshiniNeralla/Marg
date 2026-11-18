# MediaSDK 3.2.0 CPU-only compatibility test on EC2 (2026-11-18)

Isolated experiment on a **separate temporary m6a.xlarge** (same AMI family as production: Amazon Linux 2023, kernel 6.1,
Docker 25.0.14, AMD EPYC 7R13, 4 vCPU, 15.6 GB). Production (`sitevision-prod`) was only inspected read-only (Phase 1)
and never used for testing. This is an experiment, NOT official support for CPU-only production use.

## Setup (all removed afterwards)
* CloudFormation stack A: private S3 bucket (public access blocked, AES256, TLS-only, 1-day expiry).
* CloudFormation stack B: `m6a.xlarge`, 40 GB encrypted gp3, security group with **no inbound rules**, **no IAM role**,
  IMDSv2 required, shutdown behaviour = terminate, 150-minute hard stop.
* Inputs/SDK delivered by presigned URLs (the login session only allowed about 15 minutes of validity, so downloads
  were timed right after launch); results came back through the instance's serial console (no credentials on the host).
* The unmodified official `MediaSDK-3.2.0-linux-amd64.deb` (sha256 `17cc1f0c...a95cb`, verified on the instance) was
  extracted to `/opt/MediaSDK-3.2.0-linux` and mounted read-only. Test image: Ubuntu 22.04 + the deb's own `Depends`
  (native `libtiff5`) + Mesa software GL/Vulkan.
* Every stitch ran one at a time in a container with: 2 CPUs, 4 GB RAM (no swap), 128 pids, **no network**, no GPU,
  read-only root filesystem, no capabilities, non-root user, inputs read-only, no ports, no production mounts.
* Teardown verified: both stacks deleted, bucket emptied and deleted, instance terminated, no tagged resources left.

## Results (16 runs: 4 original X3/X5 captures + 2 byte-identical `.jpg`-named copies)
All 16 runs: SDK exit 0, no OOM kill, output decodes, 2:1 aspect, not flat, wraps at the seam, SDK 3.2.0 reported
`GL_RENDERER` and Vulkan device `llvmpipe` (software, CPU). See `results.jsonl` / `report.txt` for every metric.

| | X3 (3 files) | X5 (1 file) |
|---|---|---|
| 3840x1920 optflow wall time | 3.3 - 3.5 s | 3.4 s |
| 7680x3840 optflow wall time | 5.1 - 5.3 s (5 runs) | 5.2 s (3 runs) |
| Peak process RSS | 1.38 - 1.60 GB | 1.38 - 1.59 GB |
| Peak container memory (limit 4 GB) | 1.44 GB max | 1.43 GB max |
| Average CPU use (limit 2 cores) | 1.4 - 1.6 cores | 1.4 - 1.6 cores |
| `.jpg`-named copy @3840 | valid, 3.3 s | valid, 3.4 s |

Other stitch types at 7680 (X3): template 4.9 s, dynamicstitch 5.2 s. `aistitch` at 3840 took 3.6 s, similar to optflow:
it is NOT confirmed that the AI model path actually executed. Peak pids 34 (limit 128). Host guards never tripped.

## Observations / issues
* The SDK needed **no network** (`--network none` for every run).
* Benign log noise: `ParseExifManufacturerNotes failed`, `FrameTypeTimelapseQuat ... data is empty`, and a shader-cache
  warning caused by the read-only root filesystem.
* Validation covers decode, dimensions, flat-colour and seam checks only. The EC2 output images were not retrieved or
  viewed; visual quality was last compared on the WSL CPU path.
* Only ONE distinct X5 capture exists, so X5 is barely covered.

## What this does and does not show
Shows: the Linux SDK stitches real X3 and X5 captures correctly on this instance type using CPU only, in about 5 s at
7680x3840 with about 1.6 GB of memory inside a 2-core / 4 GB container.
Does not show: official support (Insta360's docs say the 3.x SDK needs a discrete GPU), production licensing, behaviour
alongside the live application, GPU behaviour, or X6.

Kit to repeat the test: `bundle/` (Dockerfile, validator, harness), `stackA-bucket.yaml`, `stackB-instance.yaml`,
`bootstrap.sh`. The launch/presign helpers contained local paths and signed URLs and were not saved.
