"""
Local-disk media persistence.

Files land under UPLOAD_ROOT (default: <repo>/uploads) and are served at
/media/... by FastAPI. public_id values use the prefix ``local/`` so delete and
dedup checks can tell them apart from Cloudinary assets without guessing from URL.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Optional

from anyio import to_thread
from loguru import logger
from PIL import Image

from app.core.config import get_settings

_LOCAL_PUBLIC_ID_PREFIX = "local/"
_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def upload_root() -> Path:
    settings = get_settings()
    raw = (settings.UPLOAD_ROOT or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    # backend/app/services/this_file.py → parents[3] = repo root
    return (Path(__file__).resolve().parents[3] / "uploads").resolve()


def ensure_upload_root() -> Path:
    root = upload_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def is_local_public_id(public_id: str | None) -> bool:
    return bool(public_id) and str(public_id).startswith(_LOCAL_PUBLIC_ID_PREFIX)


def _safe_filename(filename: str) -> str:
    name = Path(filename or "upload.bin").name
    stem = _UNSAFE_CHARS.sub("_", Path(name).stem).strip("._") or "upload"
    ext = Path(name).suffix.lower()
    if len(stem) > 80:
        stem = stem[:80]
    return f"{stem}{ext}"


def _safe_folder(folder: str) -> str:
    """
    Normalize a Cloudinary-style folder (e.g. SiteVision/captures/org/id) into
    a relative path that cannot escape UPLOAD_ROOT.
    """
    parts: list[str] = []
    for part in (folder or "misc").replace("\\", "/").split("/"):
        part = part.strip()
        if not part or part in {".", ".."}:
            continue
        parts.append(_UNSAFE_CHARS.sub("_", part).strip("._") or "x")
    return "/".join(parts) if parts else "misc"


def relative_path_from_public_id(public_id: str) -> str:
    if not is_local_public_id(public_id):
        raise ValueError(f"Not a local public_id: {public_id!r}")
    return public_id[len(_LOCAL_PUBLIC_ID_PREFIX) :].lstrip("/")


def _is_under_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def disk_path_for_public_id(public_id: str) -> Path:
    rel = relative_path_from_public_id(public_id)
    root = upload_root()
    path = (root / Path(rel)).resolve()
    if not _is_under_root(path, root):
        raise ValueError("Refusing path outside upload root")
    return path


def media_url_for_public_id(public_id: str) -> str:
    """Build the browser-facing URL for a local asset (HMAC-signed when auth on)."""
    from app.services.media_access import sign_media_path

    settings = get_settings()
    rel = relative_path_from_public_id(public_id)
    path = f"/media/{rel}".replace("//", "/")
    if settings.MEDIA_REQUIRE_AUTH:
        path = sign_media_path(path)
    base = (settings.MEDIA_PUBLIC_BASE_URL or "").strip().rstrip("/")
    if base:
        return f"{base}{path}"
    # Relative path: frontend resolveMediaUrl() prefixes API_BASE_URL.
    return path


def local_asset_exists(public_id: str | None) -> bool:
    if not is_local_public_id(public_id):
        return False
    try:
        return disk_path_for_public_id(public_id).is_file()
    except Exception:
        return False


def delete_local_asset(public_id: str | None) -> bool:
    """Best-effort delete of the original plus preview/thumbnail siblings."""
    if not is_local_public_id(public_id):
        return False
    try:
        path = disk_path_for_public_id(public_id)
    except Exception as exc:
        logger.warning(f"[local-media] invalid public_id for delete: {public_id!r} ({exc})")
        return False
    deleted = False
    siblings = (
        path,
        # Thumbs live under …/thumbs/ so the capture folder is not cluttered.
        path.parent / "thumbs" / f"{path.stem}_thumb.jpg",
        # Legacy: thumb written beside the original.
        path.with_name(f"{path.stem}_thumb.jpg"),
        path.with_name(f"{path.stem}_preview.png"),
    )
    for candidate in siblings:
        try:
            if candidate.is_file():
                candidate.unlink()
                deleted = True
                logger.info(f"[local-media] deleted {candidate}")
        except Exception as exc:
            logger.warning(f"[local-media] failed to delete {candidate}: {exc!r}")
    return deleted


def _guess_format(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext:
        return ext
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"%PDF"):
        return "pdf"
    return "bin"


def _make_thumbnail_bytes(data: bytes, filename: str) -> Optional[bytes]:
    """Scale-to-width JPEG thumb for gallery cards. Skip non-raster / PDF."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf" or data[:4] == b"%PDF":
        return None
    try:
        img = Image.open(BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")
        w, h = img.size
        if w <= 0 or h <= 0:
            return None
        target_w = 640
        if w > target_w:
            target_h = max(1, int(h * (target_w / w)))
            img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=82, optimize=True)
        return buf.getvalue()
    except Exception as exc:
        logger.warning(f"[local-media] thumbnail skipped for {filename}: {exc!r}")
        return None


def _rasterize_pdf_page1(data: bytes, *, dpi: int = 300) -> Optional[tuple[bytes, int, int]]:
    """
    Render PDF page 1 to a high-res PNG.

    Matches Cloudinary's former floor-plan delivery (density≈300) so pin overlays
    and room-map extraction stay sharp. Caps the long edge to avoid huge files.
    """
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz  # legacy package name
        except ImportError:
            logger.warning("[local-media] PyMuPDF not installed; cannot rasterize PDF")
            return None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        if doc.page_count < 1:
            doc.close()
            return None
        page = doc.load_page(0)
        zoom = dpi / 72.0
        # Floor plans are often large sheets; keep a crisp long edge for zoom/pan.
        max_long_edge = 5000
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        long_edge = max(pix.width, pix.height)
        if long_edge > max_long_edge:
            shrink = max_long_edge / long_edge
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom * shrink, zoom * shrink), alpha=False)
        elif long_edge < 2800:
            # Small PDF page boxes still look soft when stretched on a tablet —
            # bump until the long edge is usable for overlays.
            boost = min(2800 / max(long_edge, 1), 3.0)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom * boost, zoom * boost), alpha=False)
        png = pix.tobytes("png")
        w, h = pix.width, pix.height
        doc.close()
        return png, w, h
    except Exception as exc:
        logger.warning(f"[local-media] PDF rasterize failed: {exc!r}")
        return None


def _write_local_sync(
    *,
    data: bytes,
    filename: str,
    folder: str,
) -> dict:
    root = ensure_upload_root()
    safe_folder = _safe_folder(folder)
    safe_name = _safe_filename(filename)
    unique = f"{uuid.uuid4().hex[:12]}_{safe_name}"
    rel = f"{safe_folder}/{unique}".replace("\\", "/")
    dest = (root / Path(rel)).resolve()
    if not _is_under_root(dest, root):
        raise RuntimeError("Refusing to write outside upload root")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    public_id = f"{_LOCAL_PUBLIC_ID_PREFIX}{rel}"
    fmt = _guess_format(filename, data)
    original_url = media_url_for_public_id(public_id)
    raw_pdf_url = None
    thumb_url = original_url
    width = height = None
    pages = None

    # PDFs: keep the PDF on disk for PDF.js, but expose a PNG of page 1 as
    # original_url — same contract Cloudinary used (room-map + simple <img>).
    if fmt == "pdf" or data[:4] == b"%PDF":
        fmt = "pdf"
        raw_pdf_url = original_url
        rendered = _rasterize_pdf_page1(data)
        if rendered is not None:
            png_bytes, width, height = rendered
            preview_name = f"{dest.stem}_preview.png"
            preview_path = dest.with_name(preview_name)
            preview_path.write_bytes(png_bytes)
            preview_rel = f"{safe_folder}/{preview_name}".replace("\\", "/")
            original_url = media_url_for_public_id(f"{_LOCAL_PUBLIC_ID_PREFIX}{preview_rel}")
            thumb_bytes = _make_thumbnail_bytes(png_bytes, preview_name)
            if thumb_bytes is not None:
                thumb_name = f"{dest.stem}_thumb.jpg"
                thumb_dir = dest.parent / "thumbs"
                thumb_dir.mkdir(parents=True, exist_ok=True)
                (thumb_dir / thumb_name).write_bytes(thumb_bytes)
                thumb_rel = f"{safe_folder}/thumbs/{thumb_name}".replace("\\", "/")
                thumb_url = media_url_for_public_id(f"{_LOCAL_PUBLIC_ID_PREFIX}{thumb_rel}")
            else:
                thumb_url = original_url
            pages = 1
            logger.info(
                f"[local-media] PDF preview written {preview_name} "
                f"dimensions={width}x{height}"
            )
        else:
            logger.warning(
                "[local-media] PDF saved without raster preview — "
                "room-map extraction may fail until PyMuPDF can render it"
            )
    else:
        thumb_bytes = _make_thumbnail_bytes(data, filename)
        if thumb_bytes is not None:
            # Keep gallery thumbs out of the main captures folder so Explorer
            # shows one file per capture (not original + *_thumb.jpg twins).
            thumb_name = f"{Path(unique).stem}_thumb.jpg"
            thumb_dir = dest.parent / "thumbs"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            (thumb_dir / thumb_name).write_bytes(thumb_bytes)
            thumb_rel = f"{safe_folder}/thumbs/{thumb_name}".replace("\\", "/")
            thumb_url = media_url_for_public_id(f"{_LOCAL_PUBLIC_ID_PREFIX}{thumb_rel}")
        try:
            with Image.open(BytesIO(data)) as img:
                width, height = img.size
        except Exception:
            pass

    logger.info(
        f"[local-media] saved public_id={public_id} bytes={len(data)} "
        f"url={original_url}"
    )
    return {
        "original_url": original_url,
        "thumbnail_url": thumb_url,
        "public_id": public_id,
        "format": fmt,
        "size": len(data),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "resource_type": "image" if fmt != "bin" else "raw",
        "width": width,
        "height": height,
        "pages": pages,
        "original_filename": filename,
        "raw_pdf_url": raw_pdf_url,
        "storage": "local",
    }


async def save_media_locally(
    *,
    data: bytes,
    filename: str,
    folder: str,
) -> dict:
    return await to_thread.run_sync(
        lambda: _write_local_sync(data=data, filename=filename, folder=folder)
    )
