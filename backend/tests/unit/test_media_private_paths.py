"""The /media route must never serve the private ``_work`` directory."""
from __future__ import annotations

from urllib.parse import quote

import pytest
from httpx import ASGITransport, AsyncClient

from app.services.media_access import is_private_media_path, sign_media_path

ORG = "org1"


@pytest.mark.parametrize(
    "path",
    [
        "_work/stitch-spool/a.insp",
        "myhome/_work/stitch-spool/a.insp",
        "a/b/_work/c.jpg",
        "_WORK/x.jpg",
        "MyHome/_Work/x.jpg",
        "a/_work",  # the directory itself
        "a\\_work\\x.jpg",  # Windows separators
        "a/..\\_work/x.jpg",
        "a/../_work/x.jpg",  # traversal hop still names _work
        "%5Fwork/x.jpg",  # encoded underscore
        "myhome/%5fWORK/x.jpg",
        "a%2F_work%2Fx.jpg",  # encoded separator
        "a%5C_work%5Cx.jpg",  # encoded backslash
        "%255Fwork/x.jpg",  # double encoded
        "%25255Fwork/x.jpg",  # triple encoded
        "_work./x.jpg",  # Windows trailing dot
        "_work /x.jpg",  # Windows trailing space
        "_work::$INDEX_ALLOCATION/x.jpg",  # NTFS stream syntax
    ],
)
def test_private_paths_are_detected(path):
    assert is_private_media_path(path)


@pytest.mark.parametrize(
    "path",
    [
        "SiteVision/captures/org1/file.jpg",
        "myhome/sites/s1/captures/c1/thumbs/x_thumb.jpg",
        "kohinoor/users/u1/avatar/me.png",
        "a/work/x.jpg",  # no leading underscore
        "a/_workbench/x.jpg",  # prefix only, not an exact segment
        "a/my_work/x.jpg",
        "a/x_work.jpg",  # filename merely contains the text
        "",
    ],
)
def test_normal_paths_are_not_flagged(path):
    assert not is_private_media_path(path)


@pytest.fixture
def media_app(tmp_path, monkeypatch):
    """The real app (and real /media route) rooted at a temp uploads dir."""
    import app.services.local_media_service as lms

    (tmp_path / "SiteVision" / "captures" / ORG).mkdir(parents=True)
    (tmp_path / "SiteVision" / "captures" / ORG / "ok.jpg").write_bytes(b"jpeg")
    (tmp_path / "myhome" / "_work" / "stitch-spool").mkdir(parents=True)
    (tmp_path / "myhome" / "_work" / "stitch-spool" / "secret.insp").write_bytes(b"raw")
    (tmp_path / "_work").mkdir()
    (tmp_path / "_work" / "top.txt").write_bytes(b"raw")

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    monkeypatch.setattr(lms, "ensure_upload_root", lambda: tmp_path)

    from app.main import create_app

    return create_app()


async def _get(app, url: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(url)


def _signed(path: str) -> str:
    """A VALID signed URL, so a 404 can only come from the _work rule."""
    return sign_media_path(f"/media/{path}")


@pytest.mark.asyncio
async def test_legitimate_signed_media_still_served(media_app):
    resp = await _get(media_app, _signed(f"SiteVision/captures/{ORG}/ok.jpg"))
    assert resp.status_code == 200
    assert resp.content == b"jpeg"


@pytest.mark.asyncio
async def test_legitimate_media_still_requires_auth(media_app):
    resp = await _get(media_app, f"/media/SiteVision/captures/{ORG}/ok.jpg")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "myhome/_work/stitch-spool/secret.insp",  # nested
        "_work/top.txt",  # direct
        "MYHOME/_WORK/stitch-spool/secret.insp",  # case
        "myhome/%5Fwork/stitch-spool/secret.insp",  # encoded
        "myhome/%255Fwork/stitch-spool/secret.insp",  # double encoded
        "myhome%2F_work%2Fstitch-spool%2Fsecret.insp",  # encoded separators
        "myhome\\_work\\stitch-spool\\secret.insp",  # backslashes
        f"SiteVision/captures/{ORG}/../../../myhome/_work/stitch-spool/secret.insp",  # traversal
    ],
)
async def test_work_paths_return_404_even_with_valid_signature(media_app, path):
    resp = await _get(media_app, _signed(quote(path, safe="/%\\")))
    assert resp.status_code == 404
    assert b"raw" not in resp.content


@pytest.mark.asyncio
async def test_work_path_404_without_credentials(media_app):
    """Rejected before auth: unauthenticated probes learn nothing either way."""
    resp = await _get(media_app, "/media/myhome/_work/stitch-spool/secret.insp")
    assert resp.status_code == 404
