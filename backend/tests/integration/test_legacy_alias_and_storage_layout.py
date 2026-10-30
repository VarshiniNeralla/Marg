"""Legacy SiteVision/ files and their verified tenant copies; the single-tenant STORAGE_LAYOUT switch."""
import io

import pytest
from PIL import Image

from app.core import tenancy
from app.core.config import get_settings
from app.services import local_media_service as lms
from tests.conftest import ORG_ID, auth_headers

ORG = "6a3a28dd0915399ba5cb6922"
MY, KO = tenancy.tenant_by_slug("myhome"), tenancy.tenant_by_slug("kohinoor")


def _jpeg(color=(10, 20, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (40, 20), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    return tmp_path


def _put(root, rel, data=b"x"):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


# ── legacy path -> verified copy ──────────────────────────────────────────────

def test_resolver_prefers_the_original_then_falls_back_to_the_verified_copy(root):
    rel = f"SiteVision/captures/{ORG}/a.jpg"
    assert lms.resolve_stored_file(rel) is None                                       # nothing anywhere
    copy = _put(root, f"myhome/sites/captures/{ORG}/a.jpg", b"copy")
    assert lms.resolve_stored_file(rel) == copy.resolve()                             # original retired: the copy answers
    orig = _put(root, rel, b"orig")
    assert lms.resolve_stored_file(rel) == orig.resolve()                             # original present: it wins
    assert lms.resolve_stored_file("SiteVision/../../outside.txt") is None            # never leaves the upload root


def test_legacy_alias_only_maps_legacy_paths_to_the_legacy_tenant(root):
    assert tenancy.legacy_to_tenant_relpath(f"SiteVision/captures/{ORG}/thumbs/a_thumb.jpg") == f"myhome/sites/captures/{ORG}/thumbs/a_thumb.jpg"
    assert tenancy.legacy_to_tenant_relpath(f"SiteVision/avatars/{ORG}/me.jpg") == f"myhome/users/avatars/{ORG}/me.jpg"
    for rel in (f"kohinoor/sites/captures/{ORG}/a.jpg", "SiteVision", "SiteVision/captures", "other/captures/o/a.jpg"):
        assert tenancy.legacy_to_tenant_relpath(rel) is None


@pytest.mark.parametrize("multi", [False, True])
def test_deleting_a_legacy_asset_removes_the_original_and_its_copy_and_thumbnails(root, monkeypatch, multi):
    s = get_settings()
    monkeypatch.setattr(s, "MULTI_TENANT_ENABLED", multi)
    for rel in (f"SiteVision/captures/{ORG}/a.jpg", f"SiteVision/captures/{ORG}/thumbs/a_thumb.jpg",
                f"myhome/sites/captures/{ORG}/a.jpg", f"myhome/sites/captures/{ORG}/thumbs/a_thumb.jpg"):
        _put(root, rel)
    keep = _put(root, f"kohinoor/sites/captures/other/a.jpg")                         # another tenant's file with the same name
    if multi:
        with tenancy.use_tenant(MY):
            assert lms.delete_local_asset(f"local/SiteVision/captures/{ORG}/a.jpg") is True
    else:
        assert lms.delete_local_asset(f"local/SiteVision/captures/{ORG}/a.jpg") is True
    left = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    assert left == ["kohinoor/sites/captures/other/a.jpg"] and keep.exists()          # no orphaned duplicate, nothing else touched


def test_kohinoor_cannot_delete_legacy_or_my_home_files(root, monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", True)
    legacy = _put(root, f"SiteVision/captures/{ORG}/a.jpg")
    copy = _put(root, f"myhome/sites/captures/{ORG}/a.jpg")
    with tenancy.use_tenant(KO):
        assert lms.delete_local_asset(f"local/SiteVision/captures/{ORG}/a.jpg") is False
        assert lms.delete_local_asset(f"local/myhome/sites/captures/{ORG}/a.jpg") is False
    assert legacy.exists() and copy.exists()


# ── the /media route serves the copy when the original has been retired ───────

@pytest.mark.asyncio
async def test_media_route_serves_the_copy_for_a_retired_legacy_original(tmp_path, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app
    from app.services.media_access import sign_media_path

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    _put(tmp_path, f"myhome/sites/captures/{ORG}/a.jpg", _jpeg())          # only the verified copy exists
    app = create_app()
    s = get_settings()
    monkeypatch.setattr(s, "MULTI_TENANT_ENABLED", True)
    monkeypatch.setattr(s, "TENANT_RESOLUTION", "email")
    with tenancy.use_tenant(MY):
        signed = sign_media_path(f"/media/SiteVision/captures/{ORG}/a.jpg")   # the URL stored in the database
    with tenancy.use_tenant(KO):
        foreign = sign_media_path(f"/media/SiteVision/captures/{ORG}/a.jpg")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://api.test") as c:
        r = await c.get(signed)
        assert r.status_code == 200 and r.content == _jpeg()
        assert (await c.get(foreign)).status_code in (401, 404)               # Kohinoor never gets legacy / My Home files


# ── single-tenant deployment: STORAGE_LAYOUT decides where NEW uploads go ─────

@pytest.mark.asyncio
@pytest.mark.parametrize("layout,expected_prefix", [("legacy", f"SiteVision/captures/{ORG_ID}/"), ("tenant", f"myhome/sites/captures/{ORG_ID}/")])
async def test_storage_layout_switch_on_the_single_tenant_deployment(client, admin_token, root, monkeypatch, layout, expected_prefix):
    monkeypatch.setattr(get_settings(), "STORAGE_LAYOUT", layout)
    r = await client.post("/api/v1/uploads/captures", headers=auth_headers(admin_token), files={"files": ("p.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 201, r.text[:300]
    files = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
    assert files and all(f.startswith(expected_prefix) for f in files), files
    if layout == "tenant":
        assert not (root / "SiteVision").exists()                              # nothing new lands in the legacy folder
