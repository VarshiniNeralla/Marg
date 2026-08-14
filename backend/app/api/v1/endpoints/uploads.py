import io
from typing import Optional

import cloudinary
import cloudinary.uploader
from anyio import to_thread
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Query, status
from loguru import logger

from app.core.config import get_settings
from app.core.dependencies import get_current_user
from app.models.user import UserDocument
from app.schemas.auth import ApiResponse

router = APIRouter(prefix="/uploads", tags=["Uploads"])

_ALLOWED_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/pjpeg",
    "image/png", "image/webp", "image/gif",
}
_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".jfif"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
_IMAGE_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),          # JPEG
    (b"\x89PNG\r\n\x1a\n", "image/png"),      # PNG
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),                  # WebP starts RIFF....WEBP
)


def _sniff_image_type(data: bytes) -> str | None:
    for magic, ctype in _IMAGE_MAGIC:
        if data.startswith(magic):
            if ctype == "image/webp" and b"WEBP" not in data[:16]:
                continue
            return ctype
    return None


def _is_allowed_image(file: UploadFile, data: bytes | None = None) -> bool:
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype in _ALLOWED_IMAGE_TYPES:
        return True
    # Some browsers / Android WebViews send empty or octet-stream for photos.
    if ctype in {"", "application/octet-stream", "binary/octet-stream"}:
        name = (file.filename or "").lower()
        if any(name.endswith(ext) for ext in _ALLOWED_IMAGE_EXTS):
            return True
        if data and _sniff_image_type(data):
            return True
    if data and _sniff_image_type(data):
        return True
    return False


def _get_cloudinary():
    s = get_settings()
    cloudinary.config(
        cloud_name=s.CLOUDINARY_CLOUD_NAME,
        api_key=s.CLOUDINARY_API_KEY,
        api_secret=s.CLOUDINARY_API_SECRET,
        secure=True,
    )
    return cloudinary


@router.post(
    "/image",
    response_model=ApiResponse[dict],
    summary="Upload a single image (thumbnail, avatar, cover) to Cloudinary",
)
async def upload_image(
    file: UploadFile = File(...),
    folder: Optional[str] = Query("thumbnails"),
    current_user: UserDocument = Depends(get_current_user),
) -> ApiResponse[dict]:
    data = await file.read()
    if not _is_allowed_image(file, data):
        logger.warning(
            "upload_image rejected type content_type={!r} filename={!r} size={}",
            file.content_type, file.filename, len(data),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type: {file.content_type or 'unknown'}. Allowed: JPEG, PNG, WebP, GIF",
        )

    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File too large. Maximum size is 5 MB.",
        )

    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Empty file. Please choose another image.",
        )

    try:
        _get_cloudinary()
        s = get_settings()

        def _upload():
            # Synchronous Cloudinary SDK call — run in a worker thread so it does
            # NOT block the event loop for the full network upload duration.
            return cloudinary.uploader.upload(
                io.BytesIO(data),
                folder=f"sitevision/{folder}",
                resource_type="image",
                transformation=[{"width": 1200, "crop": "limit", "quality": "auto"}],
                timeout=s.CLOUDINARY_UPLOAD_TIMEOUT,
            )

        result = await to_thread.run_sync(_upload)
        return ApiResponse(success=True, data={
            "url": result.get("secure_url"),
            "public_id": result.get("public_id"),
            "width": result.get("width"),
            "height": result.get("height"),
        })
    except Exception as exc:
        logger.error(f"Cloudinary upload failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image upload failed. Please try again.",
        )
