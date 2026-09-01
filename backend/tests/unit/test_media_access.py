"""Unit tests for HMAC media URL signing / verification."""
from __future__ import annotations

import time

from app.services.media_access import sign_media_path, verify_media_signature


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
