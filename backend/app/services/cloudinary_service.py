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
    panorama_content_is_blank,
    validate_stitched_content,
    validate_stitched_output,
)
from app.services.fisheye_stitch import StitchResult, stitch_equirectangular_with_recovery


def _stitch_raw_360(raw: bytes, filename: str) -> Optional[StitchResult]:
    """Thread-pool wrapper: stitch a raw dual-fisheye file to equirectangular."""
    from loguru import logger

    try:
        logger.info(f"[capture-pipeline] stitching started file={filename} bytes={len(raw)}")
        result = stitch_equirectangular_with_recovery(raw, filename)
        if result is None:
            logger.error(f"[capture-pipeline] stitching returned None for {filename}")
            return None
        aspect = result.width / max(result.height, 1)
        logger.info(
            f"[capture-pipeline] stitching completed file={filename} "
            f"output={result.width}x{result.height} aspect={aspect:.3f} "
            f"projection={result.projection} camera={result.camera_model} "
            f"attempt={(result.metadata or {}).get('stitch_attempt', 'default')} "
            f"coverage={(result.metadata or {}).get('sphere_coverage')}"
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


_ROOT_FOLDER = "SiteVision"


def cloudinary_folder(kind: str, org_id: str, entity_id: Optional[str] = None) -> str:
    if kind not in ALLOWED_FOLDERS:
        raise ValidationException(f"Unsupported media folder '{kind}'")
    parts = [_ROOT_FOLDER, kind, org_id]
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
    # Equirectangular captures are 2:1. Using crop=fill at 480×320 (3:2) takes the
    # image centre — for a failed stitch that is mostly mid-grey with a thin band
    # of content near a pole, the gallery card becomes a solid grey tile even when
    # SOME pixels exist. Scale-to-width keeps the full panorama visible; the card
    # uses object-fit:cover so good captures still look filled.
    return cloudinary.CloudinaryImage(public_id).build_url(
        secure=True,
        width=640,
        crop="scale",
        quality="auto",
        fetch_format="auto",
    )


def _cloudinary_configured() -> bool:
    return bool(
        settings.CLOUDINARY_CLOUD_NAME
        and settings.CLOUDINARY_API_KEY
        and settings.CLOUDINARY_API_SECRET
    )


def _media_kind_from_folder(folder: str) -> str:
    """Extract kind (captures|floorplans|…) from a SiteVision/… folder path."""
    parts = [p.lower() for p in (folder or "").replace("\\", "/").split("/") if p]
    for kind in ("floorplans", "captures", "avatars", "tours", "projects", "thumbnails"):
        if kind in parts:
            return kind
    if len(parts) >= 2:
        return parts[1]
    return ""


def _resolve_media_storage(*, folder: str = "", force: Optional[str] = None) -> str:
    """
    Hybrid routing:
      floorplans → Cloudinary always (high-quality PDF page renders)
      captures   → local when MEDIA_STORAGE=local
      other      → MEDIA_STORAGE
    """
    if force in {"local", "cloudinary"}:
        return force
    kind = _media_kind_from_folder(folder)
    if kind == "floorplans":
        return "cloudinary"
    mode = get_settings().MEDIA_STORAGE
    if kind == "captures":
        return "local" if mode == "local" else "cloudinary"
    return mode if mode in {"local", "cloudinary"} else "local"


async def _upload_bytes_to_cloudinary(
    *,
    data: bytes,
    upload_filename: str,
    folder: str,
    effective_resource_type: str,
    original_filename: str,
    stitch_meta: Optional[dict],
) -> dict:
    configure_cloudinary()
    ext = Path(upload_filename).suffix.lower()

    # Free-plan Cloudinary caps ~10MB/file; 8K stitches often exceed that.
    if effective_resource_type == "image" and ext in {".jpg", ".jpeg", ".png", ".webp"}:
        data = await to_thread.run_sync(ensure_under_size, data, settings.MAX_UPLOAD_BYTES)

    def _upload() -> dict:
        return cloudinary.uploader.upload(
            BytesIO(data),
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

    is_pdf = _is_pdf(original_filename, fmt)
    preview_url = _pdf_image_url(public_id) if is_pdf else secure_url

    return {
        "original_url": preview_url,
        "thumbnail_url": _thumbnail_url(public_id, resource, secure_url, original_filename, fmt),
        "public_id": public_id,
        "format": fmt,
        "size": size,
        "uploaded_at": uploaded_at,
        "resource_type": resource,
        "width": result.get("width"),
        "height": result.get("height"),
        "pages": result.get("pages"),
        "original_filename": original_filename,
        "raw_pdf_url": None,
        "storage": "cloudinary",
        "stitch": stitch_meta,
    }


async def _persist_processed_bytes(
    *,
    data: bytes,
    upload_filename: str,
    folder: str,
    effective_resource_type: str,
    original_filename: str,
    stitch_meta: Optional[dict],
    force_storage: Optional[str] = None,
) -> dict:
    """
    Persist processed media bytes.

    Routing (hybrid):
      • floorplans → always Cloudinary (sharp PDF→PNG delivery; avoids soft local raster)
      • captures   → local disk when MEDIA_STORAGE=local (Cloudinary on local failure)
      • everything else → MEDIA_STORAGE setting

    force_storage: optional "local" | "cloudinary" override.
    """
    from loguru import logger
    from app.services.local_media_service import save_media_locally

    backend = _resolve_media_storage(folder=folder, force=force_storage)
    prefer_local = backend == "local"
    logger.info(
        f"[media-storage] routing filename={upload_filename} folder={folder} → {backend}"
    )

    if prefer_local:
        try:
            asset = await save_media_locally(
                data=data,
                filename=upload_filename,
                folder=folder,
            )
            asset["original_filename"] = original_filename
            asset["stitch"] = stitch_meta
            logger.info(
                f"[capture-pipeline] local_upload_complete filename={upload_filename} "
                f"public_id={asset.get('public_id')} url={asset.get('original_url')}"
            )
            if stitch_meta is not None and asset.get("width") and asset.get("height"):
                w, h = int(asset["width"]), int(asset["height"])
                logger.info(
                    f"[capture-pipeline] panorama_url={asset.get('original_url')} "
                    f"aspect={w / max(h, 1):.3f} projection={stitch_meta.get('projection')}"
                )
            return asset
        except Exception as exc:
            logger.error(
                f"[media-storage] local save failed for {upload_filename}; "
                f"falling back to Cloudinary (ops alert): {exc!r}"
            )
            if not _cloudinary_configured():
                raise ValidationException(
                    "Local media save failed and Cloudinary is not configured as a fallback. "
                    f"Details: {exc}"
                ) from exc

    if not _cloudinary_configured():
        raise ValidationException(
            "Cloudinary credentials are not configured "
            "(required for floor plans, or when MEDIA_STORAGE=cloudinary / local fallback)."
        )

    return await _upload_bytes_to_cloudinary(
        data=data,
        upload_filename=upload_filename,
        folder=folder,
        effective_resource_type=effective_resource_type,
        original_filename=original_filename,
        stitch_meta=stitch_meta,
    )


async def upload_media(
    *,
    file_obj: BinaryIO,
    filename: str,
    folder: str,
    resource_type: str = "auto",
    tag_if_panorama: bool = False,
) -> dict:
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
                coverage = (result.metadata or {}).get("sphere_coverage")
                validate_stitched_content(
                    result.processed_image,
                    filename=filename,
                    sphere_coverage=float(coverage) if coverage is not None else None,
                )
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
                f"aspect={result.width / max(result.height, 1):.3f} "
                f"bytes={len(tagged)}"
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
            raw = await to_thread.run_sync(ensure_under_size, raw, get_settings().MAX_UPLOAD_BYTES)
            upload_source = BytesIO(raw)

    data = upload_source.read() if hasattr(upload_source, "read") else bytes(upload_source)
    if isinstance(upload_source, BytesIO):
        upload_source.seek(0)
    # file_obj may already have been consumed above; ensure we hold the bytes.
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)

    return await _persist_processed_bytes(
        data=bytes(data),
        upload_filename=upload_filename,
        folder=folder,
        effective_resource_type=effective_resource_type,
        original_filename=filename,
        stitch_meta=stitch_meta,
    )


async def cloudinary_asset_exists(public_id: str, resource_type: str = "image") -> Optional[bool]:
    """
    Authoritative existence check for one Cloudinary asset via the Admin API.

    Returns True (exists), False (definitively gone), or None (couldn't tell —
    not configured, rate-limited, network error; callers should treat None as
    "don't act on this").

    Why not just HEAD the delivery URL: Cloudinary's CDN keeps serving a
    destroyed asset for a while, so a HEAD returns 200 for a file that no
    longer exists. That false positive is exactly how a destroyed asset got
    reused from the upload-dedup cache and produced a capture whose image
    died minutes later. The Admin API reads the account, not the edge cache.
    """
    from loguru import logger

    if not public_id:
        return None
    try:
        configure_cloudinary()
    except Exception:
        return None
    try:
        import cloudinary.api

        await to_thread.run_sync(
            lambda: cloudinary.api.resource(public_id, resource_type=resource_type)
        )
        return True
    except Exception as exc:
        # cloudinary.exceptions.NotFound is the only "definitely gone" signal;
        # anything else (auth, rate limit, transport) is inconclusive.
        if type(exc).__name__ == "NotFound":
            return False
        logger.warning(f"[cloudinary] existence check inconclusive for {public_id}: {exc!r}")
        return None


async def delete_media_assets(media_assets: list[dict]) -> None:
    """
    Best-effort cleanup for previously-uploaded assets (local disk and/or Cloudinary).

    Deleting a capture/floor-plan/etc. in Mongo used to leave its Cloudinary
    file behind forever — the API only ever called `upload`, never `destroy`,
    so every deleted record left an orphaned image on Cloudinary indefinitely.
    Call this alongside the Mongo delete for any document that stores
    `mediaAssets`/`media_assets` (each item's `public_id`/`resource_type`,
    as returned by `upload_media` above).

    Never raises: a missing/already-deleted asset or a transient Cloudinary
    error must not block the (already-decided) Mongo delete — this is cleanup,
    not the source of truth for whether the delete succeeded.
    """
    from loguru import logger
    from app.services.local_media_service import delete_local_asset, is_local_public_id

    if not media_assets:
        return

    cloudinary_ready = False
    try:
        configure_cloudinary()
        cloudinary_ready = True
    except Exception as exc:
        logger.warning(f"[cloudinary] cleanup unavailable (not configured): {exc!r}")

    for asset in media_assets:
        public_id = (asset or {}).get("public_id")
        if not public_id:
            continue
        storage = (asset or {}).get("storage") or ""
        if storage == "local" or is_local_public_id(public_id):
            delete_local_asset(public_id)
            continue
        if not cloudinary_ready:
            continue
        resource_type = (asset or {}).get("resource_type") or "image"
        try:
            result = await to_thread.run_sync(
                lambda: cloudinary.uploader.destroy(public_id, resource_type=resource_type)
            )
            logger.info(f"[cloudinary] destroyed public_id={public_id} resource_type={resource_type} result={result.get('result')}")
        except Exception as exc:
            logger.warning(f"[cloudinary] failed to destroy public_id={public_id}: {exc!r}")
