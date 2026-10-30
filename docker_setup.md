# SiteVision — Docker Setup Guide

This guide explains how SiteVision runs in Docker, how to start it, how to check that it works, and how to fix common problems. You do not need any earlier Docker experience.

---

## 1. What was set up

| File | What it does |
|---|---|
| `backend/Dockerfile` | Recipe for the **backend image** (FastAPI + Python 3.12 + OpenCV stitching) |
| `backend/.dockerignore` | Files kept out of the backend image (secrets, caches, tests, uploads) |
| `frontend/Dockerfile` | Recipe for the **frontend image**: builds the React app, then serves it with nginx |
| `frontend/nginx/default.conf.template` | nginx web server config: serves the website and forwards `/api` and `/media` to the backend |
| `frontend/nginx/proxy_common.inc.template` | Shared forwarding settings: timeouts and upload sizes |
| `frontend/.dockerignore` | Files kept out of the frontend image (`node_modules`, `android/`, `.env`) |
| `docker-compose.yml` | Starts **both** containers together, with the right settings, ports and folders |
| `.env.example` | Optional Docker-level settings: ports, Gemma URL, image tag |
| `backend/requirements.txt` | Added `pymupdf`. The code uses it for PDF floor plans, but it was missing from this file. |

Nothing else in the application code was changed.

---

## 2. How it works (the big picture)

```
 Your browser
     │  http://localhost:8080
     ▼
┌────────────────────────────┐        ┌──────────────────────────────┐
│  sitevision-frontend       │        │  sitevision-backend          │
│  (nginx, port 8080)        │ /api   │  (FastAPI/uvicorn, port 8002)│
│                            │ /media │                              │
│  • serves the React app    ├───────►│  • REST API  /api/v1/...     │
│  • forwards API + images   │        │  • images    /media/...      │
└────────────────────────────┘        └──────┬───────────────────────┘
                                             │
           ┌──────────────────┬──────────────┼───────────────┬─────────────────────┐
           ▼                  ▼              ▼               ▼                     ▼
   MongoDB Atlas      Upstash Redis     Cloudinary     Gemma (vLLM)        ./uploads folder
   (cloud database)   (login tokens)    (floor plans)  AI analysis +       (360 captures,
                                                        Drishti chat        on your disk)
```

**Key ideas**

- **Image**: a packaged, ready-to-run copy of an app. Here there are two: `sitevision-backend` and `sitevision-frontend`.
- **Container**: a running instance of an image. Compose starts one container from each image.
- **Docker Compose**: reads `docker-compose.yml` and starts or stops everything with one command.
- **One address for everything**: the browser only talks to `http://localhost:8080`. nginx inside the frontend container forwards any request starting with `/api` or `/media` to the backend container. Because the browser sees one address, there are no CORS problems, and the login cookie works normally.
- **The database is NOT in Docker.** SiteVision uses **MongoDB Atlas** (cloud). The backend container connects to it over the internet using `MONGO_URI` from `backend/.env`. Your data stays in Atlas, so stopping or deleting containers never deletes it.
- **Uploaded images are NOT inside the container.** The repo's `uploads/` folder is *mounted* into the backend at `/srv/uploads`. Files written there appear in `Marg\uploads` in Windows Explorer, and they survive rebuilds and restarts.

### Where settings come from

| Setting | Where it lives | Notes |
|---|---|---|
| App secrets (Mongo, JWT, Cloudinary, Redis, Groq, SMTP) | `backend/.env` | **Never committed** (gitignored) and **never copied into an image** |
| Docker-only overrides | `docker-compose.yml` → `environment:` | These win over `backend/.env` (see below) |
| Optional ports / Gemma URL | `.env` next to `docker-compose.yml` | Copy from `.env.example` only if you need to change something |

Docker-only overrides, and why they're needed:

| Variable | Docker value | Why |
|---|---|---|
| `UPLOAD_ROOT` | `/srv/uploads` | The Windows path in `.env` (`D:\...`) doesn't exist inside Linux containers |
| `COOKIE_SAMESITE` | *(blank → `lax`)* | Same-origin setup, so no cross-site cookie is needed. `none` requires HTTPS. |
| `FRONTEND_URL` | `http://localhost:8080` | Used in password-reset email links |
| `VLLM_BASE_URL` | `http://<GEMMA_PC_IP>:8000` (set in `Marg\.env`) | Gemma runs on another office PC. See the Gemma section below. |

---

## 3. One-time prerequisites

1. **Docker Desktop** is installed and running (whale icon in the system tray, status "Engine running").
2. **`backend/.env` exists** with your real values. Start from `backend/.env.example` if you ever need a new one.
3. **Existing images** (optional): copy your old `uploads` contents into `Marg\uploads\` so it contains `SiteVision\captures\...`. The paths stored in Mongo (`/media/SiteVision/captures/...`) map directly onto this folder.

---

## 4. Start, stop, rebuild — the commands

Open PowerShell **in the `Marg` folder** (the one containing `docker-compose.yml`).

| Goal | Command |
|---|---|
| **Build images and start everything** (first time, or after code changes) | `docker compose up -d --build` |
| Start (images already built) | `docker compose up -d` |
| See what's running and whether it's healthy | `docker compose ps` |
| Watch live logs from both containers (Ctrl+C to stop watching) | `docker compose logs -f` |
| Logs of only the backend | `docker compose logs -f backend` |
| Restart only the backend (for example, after editing `backend/.env`) | `docker compose up -d backend` |
| **Stop everything** (data and uploads are kept) | `docker compose down` |
| Rebuild only one image | `docker compose build frontend` *(or `backend`)* |

Then open **http://localhost:8080** in your browser.

> `-d` means "detached": the containers run in the background, and you get your terminal back.
> After editing `backend/.env`, run `docker compose up -d backend`. Compose notices the change and recreates the container. No rebuild is needed.
> After changing **code**, run `docker compose up -d --build`.

### Useful addresses

| URL | What |
|---|---|
| http://localhost:8080 | The SiteVision website |
| http://localhost:8080/health/ready | Backend + database check: should say `"mongodb":"up"` |
| http://localhost:8002/docs | Swagger API docs (direct to the backend, development mode only) |

---

## 5. How to verify it works

1. `docker compose ps` → both services show **`(healthy)`**.
2. Open http://localhost:8080/health/ready → `{"status":"ready","checks":{"mongodb":"up"}}`.
3. Open http://localhost:8080 → sign in with your normal account.
4. **Refresh the page (F5).** You should stay signed in. This proves the refresh cookie works.
5. Open a project with existing captures → 360° images load.
6. Upload a capture → a new file appears under `Marg\uploads\SiteVision\captures\...`.

### What was actually tested during setup

| Check | Result |
|---|---|
| Both images build, both containers become healthy | ✅ |
| Backend connects to **MongoDB Atlas** and creates indexes | ✅ |
| Redis (Upstash), Cloudinary (`ping`), Groq API key | ✅ all reachable from the container |
| Website, deep links (e.g. `/tours`) and static files served by nginx | ✅ |
| `/api` and `/media` forwarded to the backend; media without a signature is rejected (401) | ✅ |
| All **96** local image paths referenced by captures in Atlas exist in `uploads/` and load through `/media` | ✅ |
| Full login in a real browser → dashboard → **page reload keeps you signed in** → 0 console errors | ✅ |
| API flow: login → `/auth/me` → cookie refresh → create project → upload image → view image → logout | ✅ |
| `docker compose down` + `up -d` → data and uploads kept | ✅ |
| **Gemma (vLLM) on the office Gemma PC**: model list + a real chat request through the app's own LLM client | ✅ `gemma4-31b` answered in ~1.3 s |

The write tests (login, project creation, upload) ran against a **temporary throwaway copy** of the stack with its own empty local MongoDB, then were deleted. **No test data was written to your Atlas database or Redis.**

Not tested, because it needs real files or real accounts:
- Raw 360 `.insp`/`.dng` stitching with real camera files.
- Floor-plan upload. It goes to your real Cloudinary account; credentials were verified, but no file was uploaded.
- Password-reset email. SMTP isn't configured in `.env`, and with `DEBUG=true` emails are only logged anyway.

---

## 6. Gemma (vLLM) endpoint

The backend calls Gemma at `VLLM_BASE_URL/v1/chat/completions` (model `gemma4-31b`). It's used for construction-progress analysis and the Drishti assistant.

**Current setup:** Gemma runs on **another PC in the office network**, port 8000. Its address is set in `Marg\.env`. That file is gitignored, so create it on each machine from `.env.example`:

```
VLLM_BASE_URL=http://<GEMMA_PC_IP>:8000
```

To find `<GEMMA_PC_IP>`, run `ipconfig` on the Gemma PC and use the **IPv4 Address of the "Ethernet adapter Ethernet"** section. Don't use the `vEthernet` / WSL addresses; those are internal to that PC.

`backend/.env` still says `127.0.0.1:8000`. That's correct only on the Gemma PC itself, and Compose overrides it.

| Where Gemma runs | What to put in `Marg\.env` |
|---|---|
| Another PC / GPU server (current) | `VLLM_BASE_URL=http://<that-ip>:8000` |
| This PC | `VLLM_BASE_URL=http://host.docker.internal:8000` (inside a container, `127.0.0.1` is the container itself) |

After changing it, run `docker compose up -d backend`.

Check it from inside the backend container. It should list `gemma4-31b`:

```powershell
docker compose exec backend python -c "import httpx,os; print(httpx.get(os.environ['VLLM_BASE_URL']+'/v1/models', timeout=8).text)"
```

**Requirements on the Gemma PC:**
- vLLM must be started with `--host 0.0.0.0`.
- Windows Firewall must allow inbound port 8000.
- The PC must keep the same IP. If its IP changes, update `Marg\.env`.

If Gemma is down, the app still works: Drishti returns a polite fallback answer instead of crashing.

#### Why the Docker network has a fixed subnet

Docker normally picks its internal network range automatically from `172.17.x`–`172.31.x`. On this machine it picked **`172.20.0.0/16`**, which is the **same range as the office LAN**. Containers then looked for the Gemma PC's address inside Docker and failed with **"No route to host"**, even though the PC itself could reach Gemma.

`docker-compose.yml` therefore pins the network to `192.168.213.0/24` (`DOCKER_SUBNET` in `.env`). If that range is ever used on your network, change it and run `docker compose down` followed by `docker compose up -d`.

---

## 7. Using Docker Desktop (the GUI)

- **Containers** tab → the **`sitevision`** group with `sitevision-backend` and `sitevision-frontend`.
  - ▶ / ■ buttons start and stop them. 🗑 deletes the container only; your data is safe in Atlas and `uploads/`.
  - Click a container → **Logs** (live output), **Inspect** (settings), **Exec** (a terminal inside it), **Stats** (CPU/RAM).
  - The `8080:8080` link opens the website.
- **Images** tab → `sitevision-backend` (~1 GB, mostly OpenCV/numpy) and `sitevision-frontend` (~80 MB).
- **Builds** tab → history of image builds, with logs if a build fails.

---

## 8. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop isn't running → start it and wait for "Engine running" |
| `port is already allocated` (8080 or 8002) | Something else uses that port, often the old `npm run dev` or `uvicorn` → stop it, or set `FRONTEND_PORT=8081` / `BACKEND_PORT=8003` in `Marg\.env` |
| Backend `unhealthy`, or `/health/ready` says `"mongodb":"down"` | Check `docker compose logs backend`. Usually a wrong `MONGO_URI`, no internet, or this PC's IP isn't in Atlas → **Network Access** allow-list |
| Frontend stays "Waiting" | It waits for the backend to be healthy first → fix the backend (row above) |
| Website loads but login fails with "Cannot reach the server" | Backend down → `docker compose ps`, `docker compose logs backend` |
| Logged out after every refresh | `COOKIE_SAMESITE=none` got applied over plain HTTP → leave it blank in `Marg\.env` |
| Old 360 images show broken | File missing from `Marg\uploads\...`. Copy the old uploads folder in (same `SiteVision/...` structure). |
| Upload fails with "413 Request Entity Too Large" | Raise `CLIENT_MAX_BODY_SIZE` under `frontend` → `environment` in `docker-compose.yml` |
| Gemma / analysis errors | See section 6. Check that the Gemma PC is on and vLLM is running. |
| A LAN machine (Gemma PC, etc.) reachable from Windows but "No route to host" from a container | Docker subnet overlaps the LAN → change `DOCKER_SUBNET` (section 6), then `docker compose down` + `docker compose up -d` |
| Changes to code not visible | You need `docker compose up -d --build` (images contain a copy of the code) |
| Build fails with `403 Forbidden` / `No matching distribution` | Network or proxy blip while downloading packages → run the build again. pip already retries 10 times. |

Handy debugging commands:

```powershell
docker compose logs --tail 100 backend          # last 100 backend log lines
docker compose exec backend sh                  # shell inside the backend (type exit to leave)
docker compose exec backend env | sort          # settings the backend actually sees (contains secrets!)
docker compose config                           # final merged compose config
```

---

## 9. Cleaning up disk space

```powershell
docker compose down              # stop + remove containers (keeps images, data, uploads)
docker image prune               # remove dangling old image layers from previous builds
docker builder prune             # clear the build cache (next build is slower)
```

Never needed for normal use: `docker compose down -v` or `docker system prune -a`. This project uses no Docker volumes for data, but these commands delete *other* projects' data too.

---

## 10. Using the backend seed script

On a **brand-new, empty** database, create the first organization and admin:

```powershell
docker compose exec backend python seed.py --org-slug demo --org-name "Demo" --admin-email admin@example.com --admin-password "Admin@123"
```

Do **not** run this against the shared Atlas database unless you really want a new org or user there.

---

## 11. Preparing for AWS later (not implemented yet)

The setup is already AWS-friendly:

- **Images are self-contained and secret-free.** All configuration comes from environment variables. On AWS, store secrets in **Secrets Manager / SSM Parameter Store** and inject them into ECS tasks.
- **Push images to ECR (done)**: the private repositories `sitevision-backend` and `sitevision-frontend` exist in `ap-south-1` (template: `backend/infra/ecr/sitevision-ecr.yaml`, same settings as the Anviksha repositories: scan on push, AES-256, tags immutable except `latest`). Publish with the script in the repo root:
  - `.\publish_images.ps1 -Version v4` builds both images for `linux/amd64` (nothing is pushed).
  - `.\publish_images.ps1 -Version v4 -Push` pushes `v4` and `latest` to ECR. Add `-DockerHubNamespace <name>` to also push to Docker Hub.
  - A version tag can be used only once (immutable). Each run re-applies OS security patches to the images.
  - Pull on the server: `aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 196338354246.dkr.ecr.ap-south-1.amazonaws.com`, then `docker pull 196338354246.dkr.ecr.ap-south-1.amazonaws.com/sitevision-backend:v3`.
- **Frontend → backend address** is configurable with `BACKEND_UPSTREAM` (default `backend:8002`). On ECS, use `localhost:8002` in the same task, or an internal service name.
- **Health checks** already exist: `/health` (liveness) and `/health/ready` (database) for an ALB or ECS.
- **Run only one backend process per container.** Background stitch jobs live in-process. Scale by adding containers.
- **Uploads**: today a local folder. You plan to move images to **S3** and store S3 links in Mongo. That's an application code change in `local_media_service.py` / `cloudinary_service.py`; Docker needs no change.
- **Before going to production**:
  - Set `APP_ENV=production` and `DEBUG=false`.
  - Use **strong** `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 64`). The app refuses to start in production with weak ones. Changing `JWT_SECRET` invalidates existing signed `/media` links, so plan it with the S3 move.
  - Set real `CORS_ORIGINS` and `FRONTEND_URL`.
  - Serve over **HTTPS** (ALB + ACM certificate). Production cookies are `Secure`.
