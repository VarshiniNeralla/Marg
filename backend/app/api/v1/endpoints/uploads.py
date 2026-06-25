import io
from typing import Optional

import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from loguru import logger

from app.core.config import get_settings
from app.core.dependencies import get_current_user
from app.models.user import UserDocument
from app.schemas.auth import ApiResponse

router = APIRouter(prefix="/uploads", tags=["Uploads"])

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


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
    folder: Optional[str] = "thumbnails",
    current_user: UserDocument = Depends(get_current_user),
) -> ApiResponse[dict]:
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type: {file.content_type}. Allowed: JPEG, PNG, WebP, GIF",
        )

    data = await file.read()
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File too large. Maximum size is 5 MB.",
        )

    try:
        _get_cloudinary()
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            folder=f"horizon/{folder}",
            resource_type="image",
            transformation=[{"width": 1200, "crop": "limit", "quality": "auto"}],
        )
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
