"""
Stand-alone MediaSDK stitch worker (separate process / container from the API server).

    uvicorn app.stitch_worker:app --host 0.0.0.0 --port 8010

The SiteVision API sends a raw capture to ``POST /v1/stitch`` (see ``mediasdk_stitch._stitch_remote_impl``) and
receives the validated equirectangular JPEG. No database, no object-store credentials and no user data live here:
the worker only sees the bytes it is sent. Auth is a shared bearer token (``MEDIASDK_WORKER_TOKEN``); with no token
configured the worker refuses to stitch (fail closed).
"""
from __future__ import annotations

import hmac
import json
from typing import Optional

import anyio
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from loguru import logger

from app.core.mediasdk_config import get_mediasdk_settings
from app.services import mediasdk_runtime as rt
from app.services.mediasdk_stitch import MediaSdkStitchError, stitch_locally

app = FastAPI(title="SiteVision MediaSDK stitch worker", docs_url=None, redoc_url=None, openapi_url=None)


def _check_auth(authorization: Optional[str]) -> None:
    token = (get_mediasdk_settings().MEDIASDK_WORKER_TOKEN or "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="worker has no MEDIASDK_WORKER_TOKEN configured")
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="invalid worker token")


@app.get("/health")
async def health() -> JSONResponse:
    """Liveness + SDK readiness. No filesystem paths are exposed. GPU info is a capability probe, not proof of use."""
    s = get_mediasdk_settings()
    report = await anyio.to_thread.run_sync(rt.check_runtime, s)
    gpu = await anyio.to_thread.run_sync(rt.detect_gpu)
    body = {
        "status": "ok" if report.ok else "degraded",
        "sdk_ready": report.ok,
        "problems": report.problems,
        "stitch_type": s.MEDIASDK_STITCH_TYPE,
        "cuda_requested": bool(s.MEDIASDK_ENABLE_CUDA),
        "image_accel": s.MEDIASDK_IMAGE_ACCEL,
        "max_concurrency": s.MEDIASDK_MAX_CONCURRENCY,
        "gpu": gpu,
    }
    return JSONResponse(body, status_code=200 if report.ok else 503)


@app.post("/v1/stitch")
async def stitch(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_filename: str = Header(default="capture.insp"),
    x_output_width: Optional[int] = Header(default=None),
) -> Response:
    _check_auth(authorization)
    s = get_mediasdk_settings()
    declared = int(request.headers.get("content-length") or 0)
    if declared > s.MAX_RAW_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="capture too large")
    data = await request.body()
    if not data or len(data) > s.MAX_RAW_UPLOAD_BYTES:
        raise HTTPException(status_code=413 if data else 400, detail="empty or oversized capture")
    width = x_output_width if x_output_width and 640 <= x_output_width <= 15360 else None
    try:
        result = await anyio.to_thread.run_sync(lambda: stitch_locally(data, x_filename, out_w=width))
    except MediaSdkStitchError as exc:
        logger.warning(f"[stitch-worker] refused file={x_filename}: {exc}")
        return JSONResponse({"detail": str(exc)}, status_code=422)
    meta = dict(result.metadata or {})
    meta["camera_model"] = result.camera_model
    return Response(
        content=result.processed_image,
        media_type="image/jpeg",
        headers={"X-Stitch-Meta": json.dumps(meta, default=str)},
    )
