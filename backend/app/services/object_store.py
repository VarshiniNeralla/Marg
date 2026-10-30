"""
Amazon S3 object store behind the /media route.

Keys are the SAME relative paths the app uses on disk (``<tenant>/sites|users/<kind>/<org>/...``, legacy
``SiteVision/...``), so ``public_id`` / ``/media/...`` URLs stored in Mongo mean the same thing whether the bytes
are on disk or in S3. Credentials come from the standard AWS chain (EC2/ECS role, env, profile): never from code.
"""
from __future__ import annotations

import mimetypes
from functools import lru_cache
from typing import Any, Optional

from loguru import logger

from app.core.config import get_settings

_CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf"}


def s3_enabled() -> bool:
    s = get_settings()
    return getattr(s, "MEDIA_OBJECT_STORE", "disk") == "s3" and bool((getattr(s, "S3_BUCKET", "") or "").strip())


def bucket_name() -> str:
    return get_settings().S3_BUCKET.strip()


@lru_cache(maxsize=1)
def _client():
    import boto3
    from botocore.config import Config

    s = get_settings()
    return boto3.client(
        "s3",
        region_name=s.S3_REGION,
        config=Config(retries={"max_attempts": 5, "mode": "standard"}, signature_version="s3v4"),
    )


def reset_client() -> None:
    _client.cache_clear()


def safe_key(key: str) -> str:
    """Normalize a relative path into an object key; refuse anything that could escape its prefix."""
    k = (key or "").replace("\\", "/").strip("/")
    parts = [p for p in k.split("/") if p]
    if not parts or any(p in {".", ".."} for p in parts):
        raise ValueError(f"Unsafe object key: {key!r}")
    return "/".join(parts)


def content_type_for(key: str) -> str:
    low = key.lower()
    for ext, ct in _CONTENT_TYPES.items():
        if low.endswith(ext):
            return ct
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


def candidate_keys(rel: str) -> list[str]:
    """
    Object keys to try for a stored relative path. S3 holds the tenant layout only, so a legacy
    ``SiteVision/<kind>/<org>/...`` path (the form stored in Mongo for older captures) is looked up by its
    verified tenant copy ``<tenant>/sites|users/<kind>/<org>/...``, never under its legacy name.
    """
    from app.core.tenancy import legacy_to_tenant_relpath

    alias = legacy_to_tenant_relpath(rel)
    return [alias] if alias else [rel]


def _is_missing(exc: Exception) -> bool:
    """
    True when S3 says the key is not there. S3 answers 403 instead of 404 for a key the caller may not list
    (the instance role has no access outside the tenant folders), so a denial is treated as "not found" here and
    logged, rather than surfacing as a 500 on an image request.
    """
    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    if code in {"AccessDenied", "403", "Forbidden"}:
        logger.warning(f"[object-store] access denied treated as not found: {exc!r}")
        return True
    return code in {"NoSuchKey", "404", "NotFound"}


def put_object(key: str, data: bytes, *, content_type: Optional[str] = None, metadata: Optional[dict[str, str]] = None) -> None:
    """Write one object. S3 verifies a SHA-256 of the body server-side, so a corrupted transfer is rejected."""
    k = safe_key(key)
    _client().put_object(
        Bucket=bucket_name(),
        Key=k,
        Body=data,
        ContentType=content_type or content_type_for(k),
        ChecksumAlgorithm="SHA256",
        Metadata=metadata or {},
    )


def head_object(key: str) -> Optional[dict[str, Any]]:
    try:
        return _client().head_object(Bucket=bucket_name(), Key=safe_key(key), ChecksumMode="ENABLED")
    except Exception as exc:
        if _is_missing(exc):
            return None
        raise


def object_exists(key: str) -> bool:
    try:
        return head_object(key) is not None
    except ValueError:
        return False
    except Exception as exc:
        logger.warning(f"[object-store] exists check failed for {key!r}: {exc!r}")
        return False


def get_object(key: str) -> Optional[dict[str, Any]]:
    """The S3 GetObject response (streaming ``Body``), or None when the key does not exist."""
    try:
        return _client().get_object(Bucket=bucket_name(), Key=safe_key(key))
    except ValueError:
        return None
    except Exception as exc:
        if _is_missing(exc):
            return None
        raise


def read_bytes(rel: str, *, max_bytes: Optional[int] = None) -> Optional[bytes]:
    """The bytes stored for a relative media path (legacy paths resolve to their tenant copy), or None."""
    for key in candidate_keys(rel):
        obj = get_object(key)
        if obj is None:
            continue
        body = obj["Body"]
        try:
            if max_bytes is not None and int(obj.get("ContentLength") or 0) > max_bytes:
                raise ValueError("Image download exceeds maximum allowed size")
            return body.read()
        finally:
            body.close()
    return None


def delete_object(key: str) -> bool:
    """Delete one key (on a versioned bucket this adds a delete marker; earlier versions stay recoverable)."""
    try:
        k = safe_key(key)
    except ValueError:
        return False
    if head_object(k) is None:
        return False
    _client().delete_object(Bucket=bucket_name(), Key=k)
    return True
