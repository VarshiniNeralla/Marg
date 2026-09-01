"""Hybrid media routing: floor plans → Cloudinary; captures → local."""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.services.cloudinary_service import (
    _media_kind_from_folder,
    _resolve_media_storage,
)


@pytest.fixture()
def local_mode(monkeypatch):
    monkeypatch.setenv("MEDIA_STORAGE", "local")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def cloudinary_mode(monkeypatch):
    monkeypatch.setenv("MEDIA_STORAGE", "cloudinary")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_kind_from_folder():
    assert _media_kind_from_folder("SiteVision/floorplans/org/fp-1") == "floorplans"
    assert _media_kind_from_folder("SiteVision/captures/org/c-1") == "captures"
    assert _media_kind_from_folder("SiteVision/thumbnails") == "thumbnails"


def test_floorplans_always_cloudinary(local_mode):
    assert (
        _resolve_media_storage(folder="SiteVision/floorplans/org/fp-1") == "cloudinary"
    )


def test_captures_local_when_media_storage_local(local_mode):
    assert _resolve_media_storage(folder="SiteVision/captures/org/c-1") == "local"


def test_captures_cloudinary_when_media_storage_cloudinary(cloudinary_mode):
    assert (
        _resolve_media_storage(folder="SiteVision/captures/org/c-1") == "cloudinary"
    )


def test_force_override(local_mode):
    assert (
        _resolve_media_storage(
            folder="SiteVision/floorplans/org/fp-1", force="local"
        )
        == "local"
    )
    assert (
        _resolve_media_storage(
            folder="SiteVision/captures/org/c-1", force="cloudinary"
        )
        == "cloudinary"
    )
