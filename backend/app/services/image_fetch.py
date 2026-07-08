from __future__ import annotations

import io
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


def validate_image_url(url: str, *, settings: Settings | None = None) -> str:
    """Validate and return a safe HTTPS image URL."""
    settings = settings or get_settings()
    parsed = urlparse((url or "").strip())

    if parsed.scheme != "https":
        raise ValueError("Image URL must use HTTPS")

    host = (parsed.hostname or "").lower()
    allowed_hosts = set(ALLOWED_IMAGE_HOSTS)
    cloud_name = (settings.CLOUDINARY_CLOUD_NAME or "").strip().lower()
    if cloud_name:
        allowed_hosts.add(f"{cloud_name}.cloudinary.com")

    if not any(host == h or host.endswith(f".{h}") for h in allowed_hosts):
        raise ValueError("Image URL must be from an allowed Cloudinary host")

    if not parsed.path or parsed.path == "/":
        raise ValueError("Image URL path is invalid")

    return url.strip()


async def download_image(url: str, *, timeout: float) -> tuple[bytes, str]:
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


def resize_if_needed(image_bytes: bytes) -> bytes:
    if len(image_bytes) <= MAX_IMAGE_BYTES:
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

        if len(result) <= MAX_IMAGE_BYTES:
            return result

        quality = max(50, quality - 8)
        scale = max(0.35, scale - 0.1)

    return result
