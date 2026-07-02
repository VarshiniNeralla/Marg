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
    GpanoPose,
    PanoramaValidationError,
    classify_projection_bgr,
    inject_gpano_xmp,
    is_equirectangular,
    is_insp,
    is_raw_capture,
    measure_image,
    validate_stitched_output,
)
from app.services.fisheye_stitch import StitchResult, _decode_raw_rgb, stitch_equirectangular


def _stitch_raw_360(raw: bytes, filename: str) -> Optional[StitchResult]:
    """Thread-pool wrapper: stitch a raw dual-fisheye file to equirectangular."""
    from loguru import logger
    try:
        logger.info(f"[capture-pipeline] stitching started file={filename} bytes={len(raw)}")
        result = stitch_equirectangular(raw, filename)
        if result is None:
            logger.error(f"[capture-pipeline] stitching returned None for {filename}")
            return None
        aspect = result.width / max(result.height, 1)
        logger.info(
            f"[capture-pipeline] stitching completed file={filename} "
            f"output={result.width}x{result.height} aspect={aspect:.3f} "
            f"projection={result.projection} camera={result.camera_model}"
        )
        return result
    except Exception as exc:
        logger.error(f"[capture-pipeline] stitching failed for {filename}: {exc!r}")
        return None


def _extract_insp_preview(raw: bytes, filename: str) -> Optional[tuple[bytes, int, int]]:
    """
    Fallback for `.insp` files that decode to a viewable 2:1 preview but do not
    expose the raw calibration blob needed for our stitcher.
    """
    from loguru import logger
    import cv2

    img = _decode_raw_rgb(raw, filename)
    if img is None:
        return None
    h, w = img.shape[:2]
    projection = classify_projection_bgr(img)
    logger.info(
        f"[capture-pipeline] insp_preview_check file={filename} "
        f"decoded={w}x{h} projection={projection}"
    )
    if projection != "equirectangular":
        return None
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        return None
    return buf.tobytes(), w, h

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
    stitch_meta: Optional[dict] = None

    # Raw dual-fisheye camera files (.dng/.insp/.insv) are stitched server-side
    # when calibration is available. If stitching is unavailable for `.insp`, we
    # preserve the prior product behavior: upload the raw image and let the
    # frontend render it with DualFisheyeAdapter.
    if tag_if_panorama and is_raw_capture(filename):
        from loguru import logger

        ext = Path(filename).suffix.lower()
        logger.info(
            f"[capture-pipeline] file_type={ext} processor=fisheye_stitch "
            f"filename={filename} folder={folder}"
        )
        raw = file_obj.read()
        result = await to_thread.run_sync(_stitch_raw_360, raw, filename)
        if result is None:
            if is_insp(filename):
                preview = await to_thread.run_sync(_extract_insp_preview, raw, filename)
                if preview is not None:
                    preview_jpg, width, height = preview
                    try:
                        validate_stitched_output(width, height, filename=filename)
                    except PanoramaValidationError as exc:
                        raise ValidationException(str(exc)) from exc
                    tagged = await to_thread.run_sync(
                        inject_gpano_xmp,
                        preview_jpg,
                        width,
                        height,
                    )
                    upload_source = BytesIO(tagged)
                    upload_filename = Path(filename).stem + ".jpg"
                    effective_resource_type = "image"
                    stitch_meta = {
                        "projection": "equirectangular",
                        "cameraModel": "embedded-preview",
                        "stitchWidth": width,
                        "stitchHeight": height,
                        "source": "insp_preview",
                    }
                    logger.info(
                        f"[capture-pipeline] using embedded INSP preview for {filename} "
                        f"output={width}x{height} aspect={width / max(height, 1):.3f}"
                    )
                else:
                    dims = measure_image(raw)
                    dim_text = f"{dims[0]}x{dims[1]}" if dims else "unknown"
                    logger.warning(
                        f"[capture-pipeline] stitch_failed_fallback_raw_insp file={filename} "
                        f"reason=no_usable_calibration_or_preview projection=dualfisheye "
                        f"dims={dim_text}"
                    )
                    upload_source = BytesIO(raw)
                    upload_filename = filename
                    effective_resource_type = "image"
            else:
                raise ValidationException(
                    f"Could not stitch {filename}. The file may be corrupt, missing "
                    f"embedded Insta360 calibration, or unsupported. Export an "
                    f"equirectangular JPEG from Insta360 Studio and upload that instead."
                )
        else:
            try:
                validate_stitched_output(result.width, result.height, filename=filename)
            except PanoramaValidationError as exc:
                raise ValidationException(str(exc)) from exc

            gpano_pose = GpanoPose.from_metadata((result.metadata or {}).get("gpano"))
            tagged = await to_thread.run_sync(
                inject_gpano_xmp,
                result.processed_image,
                result.width,
                result.height,
                gpano_pose,
            )
            upload_source = BytesIO(tagged)
            upload_filename = Path(filename).stem + ".jpg"
            effective_resource_type = "image"
            stitch_meta = {
                "projection": result.projection,
                "cameraModel": result.camera_model,
                "stitchWidth": result.width,
                "stitchHeight": result.height,
                **result.metadata,
            }
            logger.info(
                f"[capture-pipeline] upload_source=stitched_jpg filename={upload_filename} "
                f"dimensions={result.width}x{result.height} "
                f"aspect={result.width / max(result.height, 1):.3f}"
            )

    # Non-raw captures: if the image is already a 2:1 equirectangular export
    # (e.g. from the Insta360 app), inject GPano metadata; otherwise upload as-is.
    elif tag_if_panorama:
        raw = file_obj.read()
        dims = measure_image(raw)
        if dims and is_equirectangular(dims[0], dims[1]):
            tagged = await to_thread.run_sync(inject_gpano_xmp, raw, dims[0], dims[1])
            upload_source = BytesIO(tagged)
            upload_filename = Path(filename).stem + ".jpg"
            effective_resource_type = "image"
        else:
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
    out_w = result.get("width")
    out_h = result.get("height")

    from loguru import logger
    logger.info(
        f"[capture-pipeline] cloudinary_upload_complete filename={upload_filename} "
        f"public_id={public_id} resource_type={resource} "
        f"dimensions={out_w}x{out_h} url={secure_url}"
    )
    if stitch_meta is not None and out_w and out_h:
        logger.info(
            f"[capture-pipeline] panorama_url={secure_url} "
            f"aspect={out_w / max(out_h, 1):.3f} projection={stitch_meta.get('projection')}"
        )

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
        # Present when a raw dual-fisheye was stitched to equirectangular server-side.
        "stitch": stitch_meta,
    }
