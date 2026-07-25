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
    ensure_under_size,
    inject_gpano_xmp,
    is_equirectangular,
    is_raw_capture,
    measure_image,
    validate_stitched_output,
)
from app.services.fisheye_stitch import StitchResult, stitch_equirectangular


def _stitch_raw_360(raw: bytes, filename: str) -> Optional[StitchResult]:
    """Thread-pool wrapper: stitch a raw dual-fisheye file to equirectangular."""
    from loguru import logger

    # TEMPORARY DEBUG (2026-07-25): persist a copy of every raw capture before
    # stitching so a defective stitch can be re-run/diagnosed offline against
    # its actual source bytes — the backend otherwise only keeps the final
    # Cloudinary-hosted stitched output, with no way to recover the original
    # upload after the fact. REMOVE once the seam-alignment issue is closed.
    try:
        from pathlib import Path as _Path
        import time as _time
        debug_dir = _Path(__file__).resolve().parents[2] / "uploads" / "_debug_raw_captures"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_path = debug_dir / f"{int(_time.time())}_{filename}"
        debug_path.write_bytes(raw)
        logger.info(f"[debug] saved raw capture to {debug_path}")
    except Exception as exc:
        logger.warning(f"[debug] failed to save raw capture copy: {exc!r}")

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
    #
    # Deliberately extension-only, NOT content-sniffed: a prior version of this
    # function also ran classify_projection_bytes on any 2:1 .jpg and routed it
    # into the raw stitcher if the corners looked "dark enough" to resemble an
    # unstitched dual-fisheye frame. That heuristic false-positived on genuine,
    # already-equirectangular Insta360 X3 OSC captures whose corners happened
    # to be a dim ceiling/room corner — misrouting real photos into a stitcher
    # built for a different image format entirely, producing wavy/misaligned
    # output (confirmed on-device: real captures split into two visibly
    # mismatched halves). Trusting the extension alone is what the OSC capture
    # pipeline actually needs; a manually-uploaded raw file with a wrong/generic
    # .jpg extension is a rare edge case not worth reintroducing that bug for.
    is_raw = tag_if_panorama and is_raw_capture(filename)

    if is_raw:
        from loguru import logger

        ext = Path(filename).suffix.lower()
        logger.info(
            f"[capture-pipeline] file_type={ext} processor=fisheye_stitch "
            f"filename={filename} folder={folder}"
        )
        raw = file_obj.read()
        result = await to_thread.run_sync(_stitch_raw_360, raw, filename)
        if result is None:
            # NOTE: this used to fall back to _extract_insp_preview, which
            # classified the RAW (un-rectified) dual-fisheye bytes with the
            # same corner-darkness heuristic as classify_projection_bgr and,
            # on a false positive (e.g. bright ceiling light in the corners
            # instead of the expected dark lens vignette), uploaded the raw
            # side-by-side fisheye pair completely unprocessed, mislabeled as
            # a finished panorama — confirmed on-device as the cause of a
            # "doubled"/wavy image bug. Now that fisheye_stitch.py can build a
            # synthetic profile-based calibration when no embedded calibration
            # exists (see parse_embedded_calibration's "profile" source), a
            # genuine stitch failure here means the file truly can't be
            # stitched (e.g. corrupt, unrecognised layout) — fail clearly
            # rather than guess.
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
            # A camera-native 360 JPEG (e.g. an Insta360 X3 OSC capture,
            # ~14-15MB) can exceed Cloudinary's free-plan 10MB/file limit even
            # though it needed no stitching at all. Re-encode at a lower
            # (still high) JPEG quality ONLY if it's actually over the cap —
            # every capture that already fits is left byte-for-byte untouched.
            tagged = await to_thread.run_sync(ensure_under_size, tagged, settings.MAX_UPLOAD_BYTES)
            upload_source = BytesIO(tagged)
            upload_filename = Path(filename).stem + ".jpg"
            effective_resource_type = "image"
        else:
            # Flat (non-panorama) capture — same safety net: an oversized
            # phone/camera photo shouldn't fail outright when a lower-quality
            # re-encode would let it upload fine.
            raw = await to_thread.run_sync(ensure_under_size, raw, settings.MAX_UPLOAD_BYTES)
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
