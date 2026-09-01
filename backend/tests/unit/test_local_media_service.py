"""Tests for local-disk media persistence (path safety + URL shape)."""
from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.core.config import get_settings
from app.services import local_media_service as lms


@pytest.fixture()
def upload_tmpdir(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    monkeypatch.setenv("MEDIA_STORAGE", "local")
    monkeypatch.setenv("MEDIA_PUBLIC_BASE_URL", "")
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _jpeg_bytes(size=(32, 24)) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    Image.new("RGB", size, color=(40, 120, 200)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_save_media_locally_writes_under_root(upload_tmpdir):
    data = _jpeg_bytes()
    asset = await lms.save_media_locally(
        data=data,
        filename="room shot.jpg",
        folder="SiteVision/captures/org1",
    )
    assert asset["storage"] == "local"
    assert asset["public_id"].startswith("local/")
    assert asset["original_url"].startswith("/media/")
    assert asset["size"] == len(data)

    path = lms.disk_path_for_public_id(asset["public_id"])
    assert path.is_file()
    assert path.read_bytes() == data
    assert str(path).startswith(str(upload_tmpdir.resolve()))


@pytest.mark.asyncio
async def test_path_traversal_rejected(upload_tmpdir):
    with pytest.raises(ValueError):
        lms.disk_path_for_public_id("local/../../etc/passwd")


def test_safe_folder_strips_dots():
    assert ".." not in lms._safe_folder("../SiteVision/captures")
    assert lms._safe_folder("a/b/c") == "a/b/c"


@pytest.mark.asyncio
async def test_save_pdf_writes_png_preview(upload_tmpdir):
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=200, height=100)
    page.insert_text((20, 50), "Flat 01")
    pdf_bytes = doc.tobytes()
    doc.close()

    asset = await lms.save_media_locally(
        data=pdf_bytes,
        filename="plan.pdf",
        folder="SiteVision/floorplans/org1",
    )
    assert asset["format"] == "pdf"
    raw_pdf = asset["raw_pdf_url"].split("?", 1)[0]
    original = asset["original_url"].split("?", 1)[0]
    assert raw_pdf.endswith(".pdf")
    assert original.endswith("_preview.png")
    assert asset["width"] and asset["height"]
    preview = lms.upload_root() / Path(original.removeprefix("/media/"))
    assert preview.is_file()
    assert preview.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.asyncio
async def test_delete_local_asset(upload_tmpdir):
    asset = await lms.save_media_locally(
        data=_jpeg_bytes(),
        filename="x.jpg",
        folder="SiteVision/avatars",
    )
    assert lms.local_asset_exists(asset["public_id"])
    assert lms.delete_local_asset(asset["public_id"])
    assert not lms.local_asset_exists(asset["public_id"])
