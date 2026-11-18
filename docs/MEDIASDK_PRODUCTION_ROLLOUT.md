# MediaSDK 3.2.0 production rollout: findings, plan and approvals

Status: engineering complete and verified locally. **Nothing is committed, pushed, deployed or created in AWS.**
Every item marked "needs approval" below is a proposal, not an action.

## 1. Final configuration (X3 and X5, explicit)

| Setting | Value | Why |
|---|---|---|
| `STITCH_ENGINE` | `mediasdk_fallback` (default) | MediaSDK first, custom stitcher (`fisheye_stitch.py`) automatically on any problem |
| `MEDIASDK_VERIFIED_MODELS` | `X3,X5` (set it explicitly in production) | both models use the same validated pipeline; X2, X6 and unknown models go to the custom stitcher |
| `MEDIASDK_ROUTE_JPEG_ORIGINALS` | `false` | stays off until genuine in-camera-stitched JPEGs are verified (an earlier sniffing version wrecked them) |
| `.insp` | MediaSDK | |
| `.dng`, `.insv`, unsupported or rejected input | custom stitcher | verified: `.dng` is refused by the SDK and falls back |
| video | unchanged | not touched |
| `MEDIASDK_MAX_CONCURRENCY` | `1` | one stitch at a time per worker |
| `MEDIASDK_THREADS` | `2` | **new**: see section 3 (without it the SDK needs ~135 processes on a 32-core host) |
| `MEDIASDK_TIMEOUT_SECONDS` | `240` | |
| `MEDIASDK_WORKER_URL` / `_TOKEN` | see section 5 | unset = MediaSDK disabled (behaves exactly like today) |

## 2. What was audited
The adapter, runtime, worker, job integration, validation, fallback, engine metadata and tests already existed and were kept.
This pass added: the verified Docker image and its options, the thread cap, correct processing-time accounting (queue wait is
reported separately as `queued_seconds`), the CI jobs, the ECR/IAM/host-script drafts, the capacity and licensing findings,
and a clean-PR plan. Tests: 969 backend unit tests pass (Windows); 77 MediaSDK tests pass on Linux against the real SDK; the
clean change set passes 956 tests on top of `origin/main`.

## 3. Docker: build and runtime evidence (2026-11-18)
* Image: Ubuntu 22.04 + the package's own dependencies (native `libtiff5`) + Mesa software rendering + Python 3.12 (uv) +
  slim requirements. 1.24 GB, runs as user `stitch`, health check configured. **The SDK is not in the image**; it was extracted
  from the official `.deb` into a Docker volume and mounted read-only.
* Limits applied exactly: 2 CPUs, 4 GB (no swap), 128 processes, read-only root filesystem (tmpfs `/tmp`), all capabilities
  dropped, no-new-privileges, no published ports, on an internal Docker network with **no internet access**.
* Real captures through the real adapter (X3 x2, X5 x1, 3 runs each + `.jpg`-named copies): **14 of 14 valid**, 7680x3840,
  2.3-3.5 s SDK time, 2.4-4.2 s including the HTTP round trip, CPU only (`llvmpipe`).
* Peak 2.0 GB of 4 GB memory, 51 of 128 processes, CPU throttled in about 12% of scheduling periods (it uses its 2-CPU cap in
  bursts), no OOM kill.
* Three simultaneous requests are serialised (6.6 s for three; one at a time).
* Refusals work: corrupt original (422, "truncated/corrupt"), junk bytes (422), `.dng` (422, falls back), wrong token (401).
* The worker needs no outside network (name resolution fails inside, and it still stitches).
* Missing SDK is visible: `/health` returns 503 "degraded" with the reason and Docker marks the container unhealthy.
* Crash recovery: after the worker process dies on its own, Docker restarts it in under 1 s and it is healthy in under 6 s.
  **Requires `--init` and `--restart unless-stopped`** (a manual `docker kill` is deliberately not restarted by Docker).
* **Bug found and fixed here:** the SDK's libraries start one thread per visible CPU. On a 32-core host the SDK alone peaked at
  135 processes and aborted under the 128 limit ("Can't spawn new thread"); with the thread cap it peaks at 45, on a 4-vCPU host
  34 (AWS test). The cap is applied in the adapter (`MEDIASDK_THREADS`) and as defaults in the image.
* If apt returns 403 through a proxy that blocks plain HTTP, build with `--build-arg APT_USE_HTTPS=true` (verification stays on).

## 4. Production capacity (measured today, read-only)
Host `m6a.xlarge` (4 vCPU, 15.6 GiB, Amazon Linux 2023, Docker 25.0.14, SELinux permissive, 50 GB disk, 18 GB free).

| Fact | Value |
|---|---|
| Host CPU, last 14 days | mean 4.1%; highest hourly average 65.8%; highest 5-minute peak 75.7% |
| Memory now | 4.6 GiB used, 10.7 GiB available, **2.8 GiB swapped out** |
| Backend container | limit 12 GiB, swap limit 20 GiB, no CPU limit, restart unless-stopped, `STITCH_MAX_CONCURRENCY=2` |
| **Backend peak memory since it started (yesterday 10:55 UTC)** | **12,288 MiB = its limit; the limit was reached 12,666 times** (never OOM-killed; it swapped instead) |
| Stitch workload | 155 stitch jobs on 2026-11-17, none failed; busiest minute: **24 jobs queued at once** (bulk "Upload now") |
| Disk | 18 GB free; Docker uses 23 GB, of which **20.6 GB is reclaimable** (86 images, only 3 active) |

**Reading:** production already runs under memory pressure during bulk uploads, and the custom stitcher is the cause (each
stitch needs several GB). MediaSDK needs about 2 GB peak and 2-3 s, so replacing it as the primary engine should *reduce*
pressure on this host. That is a prediction from measurements, not yet observed on production.
Worst case on paper: backend cap 12 GiB + worker cap 4 GiB = 16 GiB > 15.6 GiB RAM; the 8 GiB swap absorbs it, but it is a
reason to monitor and, once MediaSDK is primary, to consider lowering the backend's `STITCH_MAX_CONCURRENCY` (needs approval).

**Burst test (2026-11-18, Docker, real X3/X5 captures, production limits: 2 CPU, 4 GB, no swap, 128 pids).** 24 captures
(the busiest minute seen in production), 2 submitted at once like the backend's `STITCH_MAX_CONCURRENCY=2`. The "busy
neighbour" rows pin CPU-bound processes on the same cores to imitate a busy backend. This is a Docker emulation of the
4-vCPU host, not the real instance.

| Scenario | Valid 7680x3840 | Throughput | Per-job latency p50 / p95 / max | Worker mem peak | Pids peak | OOM |
|---|---|---|---|---|---|---|
| A1 shared 4-vCPU host, idle neighbour | 24/24 | 29.6/min | 3.9 / 4.2 / 5.9 s | 1.9 GB | 28 | no |
| A2 backend busy on 2 cores | 24/24 | 28.8/min | 4.1 / 4.2 / 5.7 s | 1.7 GB | 30 | no |
| A3 backend saturating all 4 cores | 24/24 | 19.4/min | 6.0 / 7.2 / 7.7 s | 1.7 GB | 32 | no |
| A4 flood, 24 requests at once | 24/24 | 29.6/min | 26 / 45 / 49 s (queueing) | 3.0 GB | 50 | no |
| B1 dedicated 2-vCPU host, 3 GB | 24/24 | 30.3/min | 3.9 / 4.0 / 5.1 s | 1.7 GB | 27 | no |

Reading: a worker capped at 2 CPUs gives about 30 captures/minute whether it shares the host or not; contention only costs
about a third of throughput when the neighbour saturates every core, and nothing failed. Memory stays under 3.1 GB even
when 24 requests arrive at once (worker concurrency 1 queues the rest; the flood latency is waiting, not stitching). So a
dedicated host buys isolation, not speed. Caveat: the flood's 3 GB peak is within the 4 GB cap but not by a wide margin. The backend's request timeout is
`MEDIASDK_TIMEOUT_SECONDS + 30` = 270 s, far above the 49 s worst wait measured, so queueing does not trigger fallback; a
backlog of roughly 130 captures at once would. Keep the backend at 2 concurrent requests to the worker.

**Option A: worker on the existing host (recommended).** Strict limits, internal network, no extra cost. Workload is ~155
captures/day x ~2.5 s = about 6.5 minutes of worker time per day; a 24-per-minute burst is about what one worker handles.
Disk: SDK 4.5 GB + image 1.2 GB fits; pruning unused old images (20.6 GB) is optional and needs approval.
**Option B: dedicated worker instance.** Isolation, but more to operate (network rules, patching, SDK on a second host).
Estimated cost (Mumbai on-demand, looked up today): `m6a.large` 2 vCPU/8 GiB **$40.55/month**, `c6a.large` 2 vCPU/4 GiB
$34.13/month (tight for a 2 GB peak), + 20 GB gp3 about $1.82/month. For comparison: growing the production volume by 30 GB
is about $2.74/month. **Recommendation: Option A now; move to B only if monitoring shows host pressure or a high fallback
rate.** No GPU instance is needed: CPU-only works (see section 7).

## 5. Production configuration
Backend (additions to the existing `docker run`): `--env-file /opt/sitevision/stitch-worker.env`,
`-e MEDIASDK_WORKER_URL=http://sv-stitch-worker:8010`, `-e MEDIASDK_VERIFIED_MODELS=X3,X5`; then
`docker network connect svstitch sv-backend` (the backend stays on `svnet` and also joins the internal `svstitch` network).
Worker: created by `backend/infra/ec2/stitch-worker-start.sh` (limits, `--init`, restart policy, SDK read-only mount,
log rotation).
**Secrets:** the shared token lives only in `/opt/sitevision/stitch-worker.env` (root, mode 0600), generated on the host by the
script, never printed or logged, and independent of the app secret. **No JWT rotation and no use of `build_prod_secret.py`**
(that script re-rotates the JWT secrets and signs everyone out). The existing `start.sh` is not in the repository; the lines
above are a change to it and need approval. Existing containers log to CloudWatch (`awslogs`); the worker uses rotated
json-file logs by default (a CloudWatch log group would be an AWS change).

## 6. CI/CD changes (drafted in the working tree, not applied)
* `.github/workflows/ci.yml`: new job `docker-stitch-worker` builds the image and boot-checks it (503 "degraded" without the SDK,
  401 without the token). Needs no AWS access, so it is safe to merge immediately. The boot-check logic was run locally.
* `.github/workflows/build-push.yml`: new job `stitch-worker` pushes the image to ECR, **disabled until the repository
  variable `STITCH_WORKER_ENABLED=true`**; no effect on the existing backend/frontend jobs.
* `backend/infra/ecr/sitevision-stitch-worker-ecr.yaml` (new stack, same settings as the backend repository, kept separate from
  the unrelated ECR lifecycle change).
* `backend/infra/iam/sitevision-github-oidc.yaml` and `sitevision-ec2-role.yaml`: one line each, allowing CI to push to and the
  host to pull from `sitevision-stitch-worker`.
* The deploy workflows are unchanged: they deploy only backend and frontend. The worker is started on the host with the script
  (a new manual deploy workflow would be a later improvement).

## 7. Licensing, CPU support and the `aiflow` message
**Licensing: not confirmed, and I did not assume anything.**
* The package ships **no license text** (the `.deb`, headers, README and the Windows pack were searched).
* Insta360 gates the SDK behind an application and an "SDK use agreement" whose text is not public (search found only
  the consumer app's separate agreement). An older Insta360 page mentions an NDA and a business license.
* So these are open and need the agreement you accepted, or Insta360: commercial/SaaS use, processing customers' images on
  your servers, running it in containers on cloud VMs, redistributing it between your own servers/artifact store, and how long
  version 3.2.0 on Linux is supported.
* The SDK also has a `datareport` subsystem and an embedded `https://cloud.insta360.com`. It produced 2 local report records per
  stitch and **no network or upload attempt was visible in its log**, but I cannot prove it never sends anything. The worker is
  therefore designed to run with no internet access, which was verified to work. Ask Insta360 what the reports contain.
* **CPU-only: works in every test (AWS, WSL, Docker) but is not officially confirmed.** Insta360's documentation says the 3.x SDK
  needs a discrete GPU. Ask them whether software rendering (Mesa `llvmpipe`) is supported for production.
* **`bcv: unknown version of aiflow`:** printed once per stitch by every run: all four stitch types, X3 and X5, even with
  flowstate off. The SDK's own config dump just before it shows `ai flow version is:0`, so it most likely means "no AI-flow
  version configured, defaulting to the normal flow". The binary does contain AI-flow code and `aistitch` mode works. Every
  output was valid, so it is very likely benign, but Insta360 has not confirmed that. It is not suppressed.

Questions to send Insta360: (1) commercial and server-side use under the SDK agreement; (2) container/cloud deployment and
internal redistribution; (3) official support for CPU-only/software-rendered Linux; (4) what `datareport` sends and how to
disable it; (5) meaning of `unknown version of aiflow` for X3/X5 originals; (6) PureShot DNG support and X6 timeline;
(7) support lifetime for Linux MediaSDK 3.2.0.

## 8. Rollback (configuration only; no code removal)
1. **Fastest, no restart:** `docker stop sv-stitch-worker`. Each job gets "worker unreachable" at once and the custom stitcher
   runs; nothing is lost. `docker start sv-stitch-worker` re-enables it.
2. Remove `MEDIASDK_WORKER_URL` from the backend env and restart the backend: MediaSDK is fully off.
3. Redeploy the previous backend tag with the existing rollback workflow.
Existing captures and stored panoramas are never touched. If both engines fail, the job is marked failed with both reasons and
the original is kept for retry (tested).

## 9. Clean pull-request plan
* **Base on `origin/main` (272baee), not local `main`:** local `main` is 44 commits behind. This branch is only 2 commits ahead of
  `origin/main` (`c98eb0c`, `c40afbb`: "recapture the floor / before-after" and "review notes"), neither touching any MediaSDK
  file.
* **Include (verified to apply cleanly and pass 956 tests on `origin/main`):** modified `.gitignore`, `backend/.env.example`,
  `backend/app/api/v1/endpoints/workflow.py`, `backend/app/core/config.py`, `backend/app/services/cloudinary_service.py`,
  `backend/tests/conftest.py`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/workflows/build-push.yml`,
  `backend/infra/iam/sitevision-github-oidc.yaml`, `backend/infra/iam/sitevision-ec2-role.yaml`; new
  `backend/Dockerfile.stitch-worker`, `backend/requirements-worker.txt`, `backend/app/core/mediasdk_config.py`,
  `backend/app/services/mediasdk_runtime.py`, `backend/app/services/mediasdk_stitch.py`, `backend/app/stitch_worker.py`,
  `backend/infra/ec2/stitch-worker-start.sh`, `backend/infra/ecr/sitevision-stitch-worker-ecr.yaml`, five test files, and
  `docs/MEDIASDK_*.md` plus `docs/mediasdk-ec2-test/`.
* **Exclude:** `backend/infra/ecr/sitevision-ecr.yaml` (your unrelated ECR lifecycle-policy change), `docs/TENANT_ONBOARDING.md`,
  and the two unrelated commits above.
* Suggested commits (on a new branch from `origin/main`): (1) adapter, runtime, settings, tests; (2) worker, Docker, compose;
  (3) CI, ECR, IAM, host script; (4) docs. Open the PR against `main`. This needs commits and a push, which need your approval.

## 10. Production deployment sequence (every step needs your approval)
0. **Business/legal:** confirm the SDK agreement covers this use (section 7).
1. PR approved and merged. CI builds and tests; the build pipeline pushes the backend image; the deploy workflow ships it.
   MediaSDK is **inert** (no worker URL): production behaves as today. Verify an X3 and an X5 capture still stitch with the
   custom stitcher.
2. AWS (infra changes): create the ECR repository stack; update the two IAM stacks; set `STITCH_WORKER_ENABLED=true`; CI pushes
   the first worker image.
3. Host preparation: get the official `.deb` onto the host and extract it to `/opt/mediasdk` (recommended: a small private
   artifact bucket readable by the instance role; alternative: a short-lived presigned download); optionally prune old unused
   Docker images.
4. Run `stitch-worker-start.sh <tag>` through SSM. Verify `/health` (SDK ready) and that the backend authenticates with it (a
   probe with junk bytes returns 422).
5. Edit `start.sh` (env file, worker URL, network join) and restart the backend in a quiet period. MediaSDK is now on for X3 and X5.
6. You test from the mobile app. We watch: `stitchEngine` and `stitchFallbackReason` on the new captures (database), the
   worker health, host memory and CPU, and the fallback rate.
7. Roll back with section 8 if the fallback rate is high, the worker is unhealthy, or the host shows pressure.

## 11. Open items
* Insta360 licensing and CPU-only confirmation (section 7); the `aiflow` message is unconfirmed.
* No X5 capture has gone through the real app yet (you will do this after deployment). X5 results so far: 1 distinct capture.
* The worker has not run on the production host; its coexistence with the live backend is measured only indirectly.
* Quality parity with the custom stitcher beyond the earlier metrics is not demonstrated (MediaSDK was about 7% less sharp by the
  Laplacian metric, similar colour, a ~6% framing difference).
