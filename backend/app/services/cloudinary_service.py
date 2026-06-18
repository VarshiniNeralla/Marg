from datetime import datetime, timezone
from pathlib import Path
import time
from typing import BinaryIO, Optional

import cloudinary
import cloudinary.utils
import cloudinary.uploader
from anyio import to_thread

from app.core.config import get_settings
from app.core.exceptions import ValidationException

settings = get_settings()


ALLOWED_FOLDERS = {
    "projects",
    "captures",
    "tours",
    "floorplans",
    "avatars",
}


def configure_cloudinary() -> None:
    if not settings.CLOUDINARY_CLOUD_NAME or not settings.CLOUDINARY_API_KEY or not settings.CLOUDINARY_API_SECRET:
        raise ValidationException("Cloudinary credentials are not configured")
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
        secure=True,
    )


def cloudinary_folder(kind: str, org_id: str, entity_id: Optional[str] = None) -> str:
    if kind not in ALLOWED_FOLDERS:
        raise ValidationException(f"Unsupported media folder '{kind}'")
    parts = [kind, org_id]
    if entity_id:
        parts.append(entity_id)
    return "/".join(parts)


def signed_upload_params(kind: str, org_id: str, entity_id: Optional[str] = None) -> dict:
    configure_cloudinary()
    folder = cloudinary_folder(kind, org_id, entity_id)
    timestamp = int(time.time())
    signature = cloudinary.utils.api_sign_request(
        {"timestamp": timestamp, "folder": folder},
        settings.CLOUDINARY_API_SECRET,
    )
    return {
        "signature": signature,
        "timestamp": timestamp,
        "cloud_name": settings.CLOUDINARY_CLOUD_NAME,
        "api_key": settings.CLOUDINARY_API_KEY,
        "upload_preset": "",
        "folder": folder,
    }


def _thumbnail_url(public_id: str, resource_type: str, secure_url: str) -> str:
    if resource_type not in {"image", "video"}:
        return secure_url
    return cloudinary.CloudinaryImage(public_id).build_url(
        secure=True,
        width=480,
        height=320,
        crop="fill",
        quality="auto",
        fetch_format="auto",
    )


async def upload_media(
    *,
    file_obj: BinaryIO,
    filename: str,
    folder: str,
    resource_type: str = "auto",
) -> dict:
    configure_cloudinary()

    def _upload() -> dict:
        return cloudinary.uploader.upload(
            file_obj,
            folder=folder,
            resource_type=resource_type,
            use_filename=True,
            unique_filename=True,
            filename_override=filename,
        )

    result = await to_thread.run_sync(_upload)
    public_id = result["public_id"]
    secure_url = result["secure_url"]
    fmt = result.get("format") or Path(filename).suffix.lower().lstrip(".")
    size = int(result.get("bytes") or 0)
    uploaded_at = result.get("created_at") or datetime.now(timezone.utc).isoformat()
    resource = result.get("resource_type", "image")

    return {
        "original_url": secure_url,
        "thumbnail_url": _thumbnail_url(public_id, resource, secure_url),
        "public_id": public_id,
        "format": fmt,
        "size": size,
        "uploaded_at": uploaded_at,
        "resource_type": resource,
        "width": result.get("width"),
        "height": result.get("height"),
        "pages": result.get("pages"),
        "original_filename": filename,
    }
