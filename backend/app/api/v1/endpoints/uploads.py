import re
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Query, status
from loguru import logger

from app.core.dependencies import get_current_user
from app.models.user import UserDocument
from app.schemas.auth import ApiResponse
from app.services.cloudinary_service import _persist_processed_bytes

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
_SAFE_FOLDER = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


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


@router.post(
    "/image",
    response_model=ApiResponse[dict],
    summary="Upload a single image (thumbnail, avatar, cover) — local disk primary, Cloudinary fallback",
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

    folder_name = (folder or "thumbnails").strip() or "thumbnails"
    if not _SAFE_FOLDER.match(folder_name):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid folder name.",
        )

    storage_folder = f"SiteVision/{folder_name}"
    filename = file.filename or "image.jpg"

    try:
        # Shared helper: floorplans→Cloudinary; captures→local when MEDIA_STORAGE=local.
        asset = await _persist_processed_bytes(
            data=data,
            upload_filename=filename,
            folder=storage_folder,
            effective_resource_type="image",
            original_filename=filename,
            stitch_meta=None,
        )
        return ApiResponse(success=True, data={
            "url": asset.get("original_url"),
            "public_id": asset.get("public_id"),
            "width": asset.get("width"),
            "height": asset.get("height"),
            "storage": asset.get("storage") or "unknown",
        })
    except Exception as exc:
        logger.error(f"Image upload failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Image upload failed. Please try again.",
        )
