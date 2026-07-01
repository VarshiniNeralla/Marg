from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import time
from typing import BinaryIO, Optional

import cloudinary
import cloudinary.utils
import cloudinary.uploader
from anyio import to_thread

from app.core.config import get_settings
from app.core.exceptions import ValidationException
from app.services.panorama_service import (
    inject_gpano_xmp,
    is_dng,
    is_equirectangular,
    is_insp,
    measure_image,
)

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


def _is_pdf(filename: str, fmt: str) -> bool:
    return fmt.lower() == "pdf" or Path(filename).suffix.lower() == ".pdf"


def _pdf_image_url(public_id: str) -> str:
    """Return a Cloudinary URL that renders page 1 of a PDF as a high-res PNG."""
    return cloudinary.CloudinaryImage(public_id).build_url(
        secure=True,
        page=1,
        fetch_format="png",
        quality=100,
        dpr="3.0",
        density=300,
        flags="attachment:false",
    )


def _pdf_raw_url(public_id: str) -> str:
    """Return the original PDF download URL from Cloudinary (for PDF.js vector rendering)."""
    return cloudinary.CloudinaryImage(public_id).build_url(
        secure=True,
        format="pdf",
    )


def _thumbnail_url(public_id: str, resource_type: str, secure_url: str, filename: str = "", fmt: str = "") -> str:
    if _is_pdf(filename, fmt):
        # For PDFs uploaded as images, generate a proper page-1 image thumbnail
        return cloudinary.CloudinaryImage(public_id).build_url(
            secure=True,
            page=1,
            width=480,
            height=320,
            crop="fill",
            fetch_format="png",
            quality="auto",
        )
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
    tag_if_panorama: bool = False,
) -> dict:
    configure_cloudinary()
    ext = Path(filename).suffix.lower()
    # Upload PDFs as resource_type="image" so Cloudinary renders them as images.
    effective_resource_type = "image" if ext == ".pdf" else resource_type

    upload_source: BinaryIO = file_obj
    upload_filename = filename

    # Raw camera formats (.dng, .insv) are NOT browser-displayable and Cloudinary's
    # image pipeline can't decode a .dng ("Failed to ping image" → the 422 the
    # field team hit). Store them as resource_type="raw" so the upload always
    # succeeds as an archival original, rather than failing the whole capture.
    #   • .insp is a JPEG internally, so Cloudinary decodes it as an image — keep it
    #     as image so the viewer can load it (rendered via the dual-fisheye path).
    #   • .dng / .insv → raw storage.
    if is_dng(filename) or ext == ".insv":
        effective_resource_type = "raw"

    # Captures: NEVER reject. If the image is a genuine 2:1 equirectangular
    # panorama, inject GPano metadata so the viewer renders a true 360; otherwise
    # upload it untouched (the viewer shows non-2:1 images flat). Raw camera files
    # are uploaded as-is — the field team uploads straight from the 360 camera, so
    # the capture must always attach.
    if tag_if_panorama and not is_dng(filename) and not is_insp(filename) and ext != ".insv":
        raw = file_obj.read()
        dims = measure_image(raw)
        if dims and is_equirectangular(dims[0], dims[1]):
            tagged = await to_thread.run_sync(inject_gpano_xmp, raw, dims[0], dims[1])
            upload_source = BytesIO(tagged)
            upload_filename = Path(filename).stem + ".jpg"
            effective_resource_type = "image"
        else:
            # Not a panorama (or undecodable here) — upload the original bytes.
            upload_source = BytesIO(raw)

    def _upload() -> dict:
        return cloudinary.uploader.upload(
            upload_source,
            folder=folder,
            resource_type=effective_resource_type,
            use_filename=True,
            unique_filename=True,
            filename_override=upload_filename,
            timeout=settings.CLOUDINARY_UPLOAD_TIMEOUT,
        )

    try:
        result = await to_thread.run_sync(_upload)
    except Exception as exc:
        # Log the full Cloudinary error so upload failures are diagnosable, then
        # surface a clean 4xx (the generic handler would otherwise make it a 500).
        from loguru import logger
        logger.error(
            f"Cloudinary upload failed: file={upload_filename} "
            f"resource_type={effective_resource_type} error={exc!r}"
        )
        raise ValidationException(f"Media upload failed: {exc}") from exc
    public_id = result["public_id"]
    secure_url = result["secure_url"]
    fmt = result.get("format") or ext.lstrip(".")
    size = int(result.get("bytes") or 0)
    uploaded_at = result.get("created_at") or datetime.now(timezone.utc).isoformat()
    resource = result.get("resource_type", "image")

    # For PDFs uploaded as resource_type="image", Cloudinary already converts them.
    # original_url points to the PNG render (public, no auth). raw_pdf_url would
    # require a signed request on most plans — omit it to avoid 401s in the browser.
    is_pdf = _is_pdf(filename, fmt)
    preview_url = _pdf_image_url(public_id) if is_pdf else secure_url

    return {
        "original_url": preview_url,
        "thumbnail_url": _thumbnail_url(public_id, resource, secure_url, filename, fmt),
        "public_id": public_id,
        "format": fmt,
        "size": size,
        "uploaded_at": uploaded_at,
        "resource_type": resource,
        "width": result.get("width"),
        "height": result.get("height"),
        "pages": result.get("pages"),
        "original_filename": filename,
        "raw_pdf_url": None,
    }
