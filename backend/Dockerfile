# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# SiteVision API (FastAPI + Motor/MongoDB + OpenCV stitching)
#
# Two stages:
#   1. builder — installs Python deps into an isolated virtualenv
#   2. runtime — copies only that venv + the app code, runs as a non-root user
#
# Secrets are NEVER baked into this image: .env is excluded by .dockerignore and
# all configuration arrives as environment variables at run time.
# ─────────────────────────────────────────────────────────────────────────────

ARG PYTHON_VERSION=3.12

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

# Retries/timeout make builds survive flaky corporate proxies.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_RETRIES=10 \
    PIP_DEFAULT_TIMEOUT=60 \
    PYTHONDONTWRITEBYTECODE=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only the requirements first so this layer is cached until deps change.
# The cache mount keeps downloaded wheels between builds (never in the image).
# dkimpy (pulled in by `emails`) ships source-only, so setuptools/wheel are
# installed up front for its build step.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
 && pip install -r requirements.txt


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

# No extra apt packages needed: opencv-python-headless, rawpy, pymupdf and numpy
# wheels vendor their own native libraries (incl. OpenMP). Only OS security patches
# published after the base image was built are applied (util-linux, zlib, ...).
# apt is pointed at HTTPS mirrors: some corporate proxies answer plain-HTTP apt requests with 403.
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# UPLOAD_ROOT: uploaded media lives on a mounted volume, never in the image.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8002 \
    UPLOAD_ROOT=/srv/uploads

# Non-root user. Fixed UID/GID so volume ownership is predictable on Linux hosts.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /srv --no-create-home app

COPY --from=builder /opt/venv /opt/venv

# Layout mirrors the repo (/srv == repo root, /srv/backend == backend/) because
# the code resolves repo-root paths via Path(__file__).parents[3]
# (e.g. manual_review.json, default uploads/).
WORKDIR /srv/backend
COPY --chown=app:app app ./app
COPY --chown=app:app seed.py update_passwords.py ./

RUN mkdir -p /srv/uploads && chown -R app:app /srv

USER app

EXPOSE 8002

# Liveness probe: /health never touches the DB, so a DB blip won't restart us.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8002\")}/health', timeout=4)" || exit 1

# Single worker on purpose: background stitch / analysis jobs run as in-process
# asyncio tasks and orphaned jobs are recovered on startup — several workers
# would each run that recovery. Scale with more containers, not more workers.
# --proxy-headers: trust X-Forwarded-* from the nginx frontend / AWS load balancer.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75"]
