"""Unit tests for HMAC media URL signing / verification."""
from __future__ import annotations

import time

import pytest
from fastapi import HTTPException, Request

from app.core.security import create_access_token
from app.services.media_access import (
    authorize_media_request,
    refresh_media_url,
    refresh_media_urls_in,
    sign_media_path,
    verify_media_signature,
)


def _request(headers: dict[str, str] | None = None) -> Request:
    raw_headers = [
        (k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/media/x",
        "headers": raw_headers,
        "query_string": b"",
    }
    return Request(scope)


def test_sign_and_verify_roundtrip():
    signed = sign_media_path("/media/SiteVision/captures/org/file.jpg", ttl_seconds=3600)
    assert "sig=" in signed
    assert "exp=" in signed
    # extract query
    from urllib.parse import parse_qs, urlsplit

    q = parse_qs(urlsplit(signed).query)
    assert verify_media_signature(
        "/media/SiteVision/captures/org/file.jpg",
        exp=q["exp"][0],
        sig=q["sig"][0],
    )


def test_verify_rejects_tampered_sig():
    signed = sign_media_path("/media/a.jpg", ttl_seconds=3600)
    from urllib.parse import parse_qs, urlsplit

    q = parse_qs(urlsplit(signed).query)
    assert not verify_media_signature(
        "/media/a.jpg",
        exp=q["exp"][0],
        sig="0" * 32,
    )


def test_verify_rejects_expired():
    path = "/media/a.jpg"
    exp = str(int(time.time()) - 10)
    assert not verify_media_signature(path, exp=exp, sig="deadbeef")


def test_authorize_media_request_rejects_cross_org_token():
    token = create_access_token(subject="user1", org_id="orgA", role="user")
    request = _request({"authorization": f"Bearer {token}"})
    with pytest.raises(HTTPException) as exc_info:
        authorize_media_request(request, "SiteVision/captures/orgB/entity1/file.jpg")
    assert exc_info.value.status_code == 401


def test_authorize_media_request_allows_same_org_token():
    token = create_access_token(subject="user1", org_id="orgA", role="user")
    request = _request({"authorization": f"Bearer {token}"})
    # Should not raise.
    authorize_media_request(request, "SiteVision/captures/orgA/entity1/file.jpg")


def test_authorize_media_request_allows_path_without_org_segment():
    token = create_access_token(subject="user1", org_id="orgA", role="user")
    request = _request({"authorization": f"Bearer {token}"})
    # Legacy/short paths with no recognizable org segment fall back to
    # "any authenticated user" rather than being blocked outright.
    authorize_media_request(request, "misc.jpg")


def test_authorize_allows_jwt_when_hmac_expired():
    """Tour viewer: stored exp/sig is stale, but ?access_token= still works."""
    token = create_access_token(subject="user1", org_id="orgA", role="user")
    authorize_media_request(
        _request(),
        "SiteVision/captures/orgA/file.jpg",
        access_token=token,
        exp=str(int(time.time()) - 10),
        sig="deadbeefdeadbeefdeadbeefdeadbeef",
    )


def test_refresh_media_url_replaces_expired_signature(monkeypatch):
    monkeypatch.setenv("MEDIA_REQUIRE_AUTH", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()
    stale = "/media/SiteVision/captures/org/file.jpg?exp=1&sig=deadbeefdeadbeefdeadbeefdeadbeef"
    fresh = refresh_media_url(stale)
    from urllib.parse import parse_qs, urlsplit

    assert fresh.startswith("/media/SiteVision/captures/org/file.jpg?")
    q = parse_qs(urlsplit(fresh).query)
    assert verify_media_signature(
        "/media/SiteVision/captures/org/file.jpg",
        exp=q["exp"][0],
        sig=q["sig"][0],
    )
    assert q["sig"][0] != "deadbeefdeadbeefdeadbeefdeadbeef"
    get_settings.cache_clear()


def test_refresh_media_url_leaves_cloudinary_alone():
    url = "https://res.cloudinary.com/demo/image/upload/v1/room.jpg"
    assert refresh_media_url(url) == url


def test_refresh_media_urls_in_nested_capture(monkeypatch):
    monkeypatch.setenv("MEDIA_REQUIRE_AUTH", "true")
    from app.core.config import get_settings
    get_settings.cache_clear()
    stale = "/media/SiteVision/captures/org/pano.jpg?exp=1&sig=" + ("ab" * 16)
    doc = {
        "processedPanoramaUrl": stale,
        "mediaAssets": [{"original_url": stale, "thumbnail_url": stale}],
    }
    out = refresh_media_urls_in(doc)
    assert "sig=" in out["processedPanoramaUrl"]
    assert out["processedPanoramaUrl"] != stale
    assert out["mediaAssets"][0]["original_url"] != stale
    get_settings.cache_clear()
