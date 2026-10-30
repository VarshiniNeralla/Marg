from __future__ import annotations

import io
from pathlib import Path
from urllib.parse import urlparse

import httpx
from PIL import Image

from app.core.config import Settings, get_settings

# Groq base64 image limit is ~4 MB per image; keep headroom for two images in one request.
MAX_IMAGE_BYTES = 1_800_000
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_IMAGE_HOSTS = (
    "res.cloudinary.com",
    "cloudinary.com",
)
_LOCAL_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
    }.get(ext, "application/octet-stream")


def _try_local_media_path(url: str, *, settings: Settings) -> Path | None:
    """
    Map a /media/... URL (relative or absolute against our public base / loopback)
    to a path under UPLOAD_ROOT. Returns None when the URL is not local media.
    """
    from app.services.local_media_service import upload_root

    raw = (url or "").strip()
    if not raw:
        return None

    media_path: str | None = None
    if raw.startswith("/media/"):
        # Signed media URLs append ?exp=&sig= — strip before resolving the path.
        media_path = raw.split("?", 1)[0].split("#", 1)[0]
    else:
        parsed = urlparse(raw)
        if parsed.path.startswith("/media/"):
            host = (parsed.hostname or "").lower()
            base = (settings.MEDIA_PUBLIC_BASE_URL or "").strip()
            base_host = urlparse(base).hostname.lower() if base else None
            if host in _LOCAL_LOOPBACK_HOSTS or (base_host and host == base_host):
                media_path = parsed.path

    if not media_path:
        return None

    rel = media_path[len("/media/") :].lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("Image URL path is invalid")

    from app.core.tenancy import media_path_allowed

    # A tenant may only read its own stored files (fails closed without a tenant).
    if not media_path_allowed(rel):
        raise ValueError("Image URL path is invalid")

    root = upload_root()
    path = (root / Path(rel)).resolve()
    try:
        rel_resolved = path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Image URL path is invalid") from exc
    if not media_path_allowed(rel_resolved.as_posix()):
        raise ValueError("Image URL path is invalid")
    if not path.is_file():
        from app.services.local_media_service import resolve_stored_file

        path = resolve_stored_file(rel_resolved.as_posix()) or path   # legacy path -> verified tenant copy
    return path


def _cloudinary_public_id(path: str) -> str | None:
    """public_id (without extension) from a Cloudinary delivery path, else None."""
    import re
    from urllib.parse import unquote

    segs = [s for s in unquote(path).split("/") if s]
    for i, s in enumerate(segs):
        if s in {"upload", "authenticated", "private"} and i >= 2 and segs[i - 1] in {"image", "video", "raw"}:
            rest = segs[i + 1:]
            for j, t in enumerate(rest):
                if re.fullmatch(r"v\d+", t):
                    rest = rest[j + 1:]
                    break
            else:
                while len(rest) > 1 and re.match(r"^[a-z]{1,3}_", rest[0]):
                    rest = rest[1:]
            return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", "/".join(rest)) or None
    return None


def validate_image_url(url: str, *, settings: Settings | None = None) -> str:
    """Validate and return a safe image URL (Cloudinary HTTPS or local /media)."""
    settings = settings or get_settings()
    raw = (url or "").strip()
    if not raw:
        raise ValueError("Image URL is empty")

    # Relative local media paths are served by this API.
    if raw.startswith("/media/"):
        path = _try_local_media_path(raw, settings=settings)
        if path is None:
            raise ValueError("Image URL path is invalid")
        return raw

    parsed = urlparse(raw)
    local_path = _try_local_media_path(raw, settings=settings)
    if local_path is not None:
        return raw

    if parsed.scheme != "https":
        raise ValueError("Image URL must use HTTPS")

    host = (parsed.hostname or "").lower()
    allowed_hosts = set(ALLOWED_IMAGE_HOSTS)
    cloud_name = (settings.CLOUDINARY_CLOUD_NAME or "").strip().lower()
    if cloud_name:
        allowed_hosts.add(f"{cloud_name}.cloudinary.com")

    if not any(host == h or host.endswith(f".{h}") for h in allowed_hosts):
        raise ValueError("Image URL must be from an allowed Cloudinary host or local /media")

    if not parsed.path or parsed.path == "/":
        raise ValueError("Image URL path is invalid")

    # Multi-tenant: the shared Cloudinary account holds both tenants' files, so only
    # URLs for this tenant's own assets may be fetched for analysis.
    from app.core.tenancy import asset_owned, multi_tenant_enabled

    if multi_tenant_enabled() and host.endswith("cloudinary.com"):
        pid = _cloudinary_public_id(parsed.path)
        if pid is None or not asset_owned(pid):
            raise ValueError("Image URL is not available to this organization")

    return raw


async def download_image(url: str, *, timeout: float) -> tuple[bytes, str]:
    settings = get_settings()
    local_path = _try_local_media_path(url, settings=settings)
    if local_path is not None:
        if local_path.is_file():
            data = local_path.read_bytes()
        else:
            # Object-store mode: the file lives in S3 under the same relative path.
            from anyio import to_thread

            from app.services import object_store
            from app.services.local_media_service import upload_root

            data = None
            if object_store.s3_enabled():
                rel = local_path.resolve().relative_to(upload_root().resolve()).as_posix()
                data = await to_thread.run_sync(lambda: object_store.read_bytes(rel, max_bytes=MAX_DOWNLOAD_BYTES))
            if data is None:
                raise ValueError(f"Local media file not found: {local_path.name}")
        if len(data) > MAX_DOWNLOAD_BYTES:
            raise ValueError("Image download exceeds maximum allowed size")
        return data, _mime_for_path(local_path)

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=4),
    ) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            content_type = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
            if not content_type.startswith("image/"):
                raise ValueError(f"URL did not return an image (content-type={content_type})")

            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise ValueError("Image download exceeds maximum allowed size")
                chunks.append(chunk)

    return b"".join(chunks), content_type


def resize_if_needed(image_bytes: bytes, *, max_bytes: int = MAX_IMAGE_BYTES) -> bytes:
    if len(image_bytes) <= max_bytes:
        return image_bytes

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    quality = 85
    scale = 1.0
    current = img

    for _ in range(12):
        if scale < 1.0:
            w, h = current.size
            current = current.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )

        buf = io.BytesIO()
        current.save(buf, format="JPEG", quality=quality, optimize=True)
        result = buf.getvalue()

        if len(result) <= max_bytes:
            return result

        quality = max(50, quality - 8)
        scale = max(0.35, scale - 0.1)

    return result
