# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# SiteVision web app (React + Vite SPA served by nginx)
#
#   1. build   — `npm ci` + `vite build` → static files in /app/dist
#   2. runtime — unprivileged nginx serves dist/ and reverse-proxies /api and
#                /media to the backend, so the browser sees ONE origin
#                (no CORS, refresh-token cookie works with SameSite=Lax).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Install deps first (cached until package*.json change).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Vite inlines VITE_* at BUILD time.
# "/" = same-origin: API calls go to /api/v1/... on whatever host serves this
# page, and nginx (below) forwards them to the backend. Override with a full URL
# (e.g. https://api.example.com) only if the API lives on a different host.
ARG VITE_API_BASE_URL=/
ARG VITE_CLOUDINARY_CLOUD_NAME=
ARG VITE_CLOUDINARY_UPLOAD_PRESET=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_CLOUDINARY_CLOUD_NAME=${VITE_CLOUDINARY_CLOUD_NAME} \
    VITE_CLOUDINARY_UPLOAD_PRESET=${VITE_CLOUDINARY_UPLOAD_PRESET}

RUN npm run build


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

# Pick up OS security patches published after the base image was built (openssl, curl, libxml2, ...).
USER root
RUN apk upgrade --no-cache
USER 101

# Where nginx forwards /api and /media. "backend:8002" is the Compose service
# name; on AWS ECS set it to e.g. "localhost:8002" (same task) or an internal
# service hostname. Rendered into the config by the image's envsubst step.
ENV BACKEND_UPSTREAM=backend:8002 \
    CLIENT_MAX_BODY_SIZE=512m \
    PROXY_TIMEOUT=600s

# *.template files are rendered by envsubst into /etc/nginx/conf.d at start-up.
COPY nginx/default.conf.template nginx/proxy_common.inc.template /etc/nginx/templates/
COPY --from=build /app/dist /usr/share/nginx/html

# nginx-unprivileged already runs as uid 101 and listens on 8080 (no root needed).
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
