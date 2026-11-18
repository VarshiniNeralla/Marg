#!/bin/bash
# Start (or replace) the MediaSDK stitch worker on the SiteVision host. Run ON the host, e.g. through SSM Run Command.
# DRAFT for review: not applied to production. Idempotent. Usage:  stitch-worker-start.sh <image-tag>   (e.g. sha-1a2b3c4)
#
# Prerequisites (one-time, see docs/MEDIASDK_PRODUCTION_ROLLOUT.md):
#   * the official MediaSDK .deb extracted on the host:  /opt/mediasdk/MediaSDK-3.2.0-linux  (read-only for the worker)
#   * the image pushed to ECR repository sitevision-stitch-worker
# Design: no published port, internal Docker network without internet access, 2 CPU / 4 GB / 128 processes, read-only
# root filesystem, no capabilities, --init so a crashed process is restarted by Docker, one stitch at a time.
set -euo pipefail

TAG="${1:?usage: $0 <image-tag>}"
REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
SDK_DIR="${MEDIASDK_HOST_DIR:-/opt/mediasdk/MediaSDK-3.2.0-linux}"
ENV_FILE="/opt/sitevision/stitch-worker.env"        # holds ONLY MEDIASDK_WORKER_TOKEN; root:root 0600; never printed or logged

[ -x "${SDK_DIR}/bin/MediaSDKTest" ] || { echo "SDK not found at ${SDK_DIR} (extract the official .deb first)"; exit 1; }

# Internal network: containers on it can talk to each other but have NO route to the internet (the SDK needs none).
docker network inspect svstitch >/dev/null 2>&1 || docker network create --internal svstitch

# Shared secret between backend and worker. Created once. Independent of the app secret: no JWT rotation, no sign-outs.
if [ ! -f "${ENV_FILE}" ]; then
  ( umask 077; echo "MEDIASDK_WORKER_TOKEN=$(openssl rand -hex 24)" > "${ENV_FILE}" )
  echo "created ${ENV_FILE} (not displayed)"
fi

aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR}" >/dev/null
docker pull "${ECR}/sitevision-stitch-worker:${TAG}"

docker rm -f sv-stitch-worker >/dev/null 2>&1 || true
docker run -d --name sv-stitch-worker --init --restart unless-stopped --network svstitch \
  --cpus 2 --memory 4g --memory-swap 4g --pids-limit 128 \
  --read-only --tmpfs /tmp:rw,size=1g,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=5 \
  --env-file "${ENV_FILE}" -e MEDIASDK_MAX_CONCURRENCY=1 \
  -v "${SDK_DIR}:/opt/MediaSDK-3.2.0-linux:ro" \
  "${ECR}/sitevision-stitch-worker:${TAG}" >/dev/null

# Wait for the worker to report the SDK ready (503 = SDK missing/broken, which Docker shows as unhealthy).
for i in $(seq 1 40); do
  [ "$(docker inspect sv-stitch-worker --format '{{.State.Health.Status}}')" = "healthy" ] && { echo "sv-stitch-worker healthy"; exit 0; }
  sleep 3
done
echo "worker did not become healthy:"; docker logs --tail 20 sv-stitch-worker 2>&1 | cut -c1-200
exit 1
