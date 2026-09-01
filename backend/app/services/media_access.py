"""
Authorize and sign local /media/... URLs.

Browser <img> / Photo Sphere Viewer cannot send Authorization headers, so we:
  1. HMAC-sign URLs at write time (exp + sig query params), and
  2. Also accept a JWT via Authorization Bearer or ?access_token= for legacy
     unsigned paths already stored in Mongo.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.config import get_settings
from app.core.security import decode_access_token


def _signing_secret() -> bytes:
    settings = get_settings()
    raw = (settings.JWT_SECRET or "").encode("utf-8")
    if not raw:
        raw = b"sitevision-media-dev-secret"
    return raw


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
    if not settings.MEDIA_REQUIRE_AUTH:
        return

    media_path = f"/media/{file_path.lstrip('/')}"
    if verify_media_signature(media_path, exp=exp, sig=sig):
        return

    token = _token_from_request(request, access_token)
    if token:
        try:
            payload = decode_access_token(token)
            if payload.get("sub") and payload.get("org"):
                return
        except Exception as exc:
            logger.debug(f"[media-access] JWT rejected for {media_path}: {exc!r}")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required to access media",
    )
