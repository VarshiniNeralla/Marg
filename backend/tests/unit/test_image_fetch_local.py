"""Local /media path resolution — query strings must not break file lookup."""
from __future__ import annotations

from pathlib import Path

from app.core.config import get_settings
from app.services.image_fetch import _try_local_media_path


def test_try_local_media_path_strips_query_string(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    get_settings.cache_clear()
    settings = get_settings()
    rel = Path("SiteVision/captures/org/file.jpg")
    target = tmp_path / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"x")
    path = _try_local_media_path(
        f"/media/{rel.as_posix()}?exp=123&sig=abcdef",
        settings=settings,
    )
    assert path is not None
    assert path == target.resolve()
    get_settings.cache_clear()
