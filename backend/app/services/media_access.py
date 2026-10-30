"""
Authorize and sign local /media/... URLs.

Browser <img> / Photo Sphere Viewer cannot send Authorization headers, so we:
  1. HMAC-sign URLs (exp + sig query params) — refreshed on API read so Mongo
     documents older than MEDIA_URL_TTL_SECONDS still load, and
  2. Also accept a JWT via Authorization Bearer or ?access_token= when the
     HMAC is missing or expired (Photo Sphere Viewer / <img> cannot send headers).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Optional
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.core.tenancy import TenantResolutionError, derive_key, media_path_allowed


PRIVATE_MEDIA_SEGMENT = "_work"
_MAX_DECODE_ROUNDS = 5


def is_private_media_path(file_path: str) -> bool:
    """
    True when any path segment is the private ``_work`` directory.

    Checked on the raw requested path, before any filesystem resolution, so it
    cannot be sidestepped with case changes, repeated percent-encoding, mixed
    separators, ``..`` hops, or Windows name quirks (trailing dots/spaces,
    ``_work:stream``).
    """
    decoded = file_path or ""
    for _ in range(_MAX_DECODE_ROUNDS):
        nxt = unquote(decoded)
        if nxt == decoded:
            break
        decoded = nxt
    for segment in decoded.replace("\\", "/").split("/"):
        # Windows ignores trailing dots/spaces and treats ':' as a stream marker.
        name = segment.split(":", 1)[0].rstrip(". ").strip()
        if name.casefold() == PRIVATE_MEDIA_SEGMENT:
            return True
    return False


def _signing_secret() -> bytes:
    settings = get_settings()
    raw = (settings.JWT_SECRET or "").encode("utf-8")
    if not raw:
        raw = b"sitevision-media-dev-secret"
    # Multi-tenant: a URL signed for one tenant never verifies for another.
    return derive_key(raw.decode("utf-8"), "media").encode("utf-8")


def sign_media_path(path: str, *, ttl_seconds: Optional[int] = None) -> str:
    """
    Append exp+sig to a /media/... path (or absolute URL whose path starts with /media/).
    """
    settings = get_settings()
    ttl = int(ttl_seconds if ttl_seconds is not None else settings.MEDIA_URL_TTL_SECONDS)
    parts = urlsplit(path)
    media_path = parts.path
    if not media_path.startswith("/media/"):
        return path
    exp = int(time.time()) + max(60, ttl)
    msg = f"{media_path}:{exp}".encode("utf-8")
    sig = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()[:32]
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    q["exp"] = str(exp)
    q["sig"] = sig
    return urlunsplit((parts.scheme, parts.netloc, media_path, urlencode(q), parts.fragment))


def refresh_media_url(url: str) -> str:
    """
    Drop a stale exp/sig/access_token query and re-sign a /media URL.

    Write-time HMAC baked into Mongo expires after MEDIA_URL_TTL_SECONDS
    (default 7 days). Re-signing on every API response keeps panoramas loadable
    without requiring the client to send a JWT.
    Non-media URLs (Cloudinary, empty, unrelated strings) are returned unchanged.
    """
    raw = (url or "").strip()
    if not raw:
        return url

    parts = urlsplit(raw)
    media_path = parts.path if parts.scheme or parts.netloc else raw.split("?", 1)[0].split("#", 1)[0]
    if not media_path.startswith("/media/"):
        return url

    settings = get_settings()
    clean = urlunsplit((parts.scheme, parts.netloc, media_path, "", parts.fragment))
    if not settings.MEDIA_REQUIRE_AUTH:
        return clean
    return sign_media_path(clean)


def refresh_media_urls_in(value: Any) -> Any:
    """Recursively re-sign /media URLs inside a JSON-shaped dict/list."""
    if isinstance(value, str):
        return refresh_media_url(value)
    if isinstance(value, dict):
        return {k: refresh_media_urls_in(v) for k, v in value.items()}
    if isinstance(value, list):
        return [refresh_media_urls_in(v) for v in value]
    if isinstance(value, tuple):
        return tuple(refresh_media_urls_in(v) for v in value)
    return value


def verify_media_signature(media_path: str, *, exp: Optional[str], sig: Optional[str]) -> bool:
    if not exp or not sig:
        return False
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < int(time.time()):
        return False
    path = media_path if media_path.startswith("/") else f"/{media_path}"
    if not path.startswith("/media/"):
        path = f"/media/{path.lstrip('/')}"
    msg = f"{path}:{exp_i}".encode("utf-8")
    expected = hmac.new(_signing_secret(), msg, hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expected, sig)


def _token_from_request(request: Request, access_token: Optional[str]) -> Optional[str]:
    if access_token and access_token.strip():
        return access_token.strip()
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth:
        parts = auth.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
    return None


def _org_id_from_file_path(file_path: str) -> Optional[str]:
    """
    Local media is stored under SiteVision/{kind}/{org_id}/{entity_id}/...
    (see cloudinary_folder()/_safe_folder()), so the org id is always the
    third path segment. Returns None if the path doesn't match that shape.
    """
    from app.core.tenancy import tenant_by_slug

    segments = [p for p in file_path.strip("/").split("/") if p]
    if segments and tenant_by_slug(segments[0]) is not None:
        # {tenant}/{sites|users}/{kind}/{org_id}/...
        return segments[3] if len(segments) >= 4 else None
    if len(segments) < 3:
        return None
    return segments[2]


def authorize_media_request(
    request: Request,
    file_path: str,
    *,
    access_token: Optional[str] = None,
    exp: Optional[str] = None,
    sig: Optional[str] = None,
) -> None:
    """
    Raise HTTPException 401 when media auth is required and the request is invalid.
    """
    settings = get_settings()
    # Tenant ownership first: applies to signed URLs and JWTs alike, and even when
    # MEDIA_REQUIRE_AUTH is off, so one tenant can never read another's files.
    if not media_path_allowed(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not settings.MEDIA_REQUIRE_AUTH:
        return

    media_path = f"/media/{file_path.lstrip('/')}"
    try:
        if verify_media_signature(media_path, exp=exp, sig=sig):
            return
    except TenantResolutionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    token = _token_from_request(request, access_token)
    if token:
        try:
            payload = decode_access_token(token)
            token_org = payload.get("org")
            if payload.get("sub") and token_org:
                path_org = _org_id_from_file_path(file_path)
                # Legacy paths that don't carry a recognizable org segment
                # (e.g. avatars, misc uploads) fall back to "any authenticated
                # user" — but org-scoped paths must match the caller's org.
                if path_org is None or str(path_org) == str(token_org):
                    return
                logger.warning(
                    f"[media-access] org mismatch for {media_path}: "
                    f"token_org={token_org!r} path_org={path_org!r}"
                )
        except Exception as exc:
            logger.debug(f"[media-access] JWT rejected for {media_path}: {exc!r}")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required to access media",
    )
