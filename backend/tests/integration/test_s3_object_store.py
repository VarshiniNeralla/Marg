"""S3 object store behind /media: same keys as the disk layout, same authorization, no database rewrite."""
import importlib.util
import io
import pathlib

import pytest
import pytest_asyncio
from PIL import Image

from app.core import tenancy
from app.core.config import get_settings
from app.services import local_media_service as lms
from app.services import object_store
from tests.conftest import ORG_ID

ORG = "6a3a28dd0915399ba5cb6922"
MY, KO = tenancy.tenant_by_slug("myhome"), tenancy.tenant_by_slug("kohinoor")


class _Missing(Exception):
    def __init__(self):
        self.response = {"Error": {"Code": "NoSuchKey"}}


class _Body:
    def __init__(self, data):
        self._d, self.closed = data, False

    def iter_chunks(self, n):
        for i in range(0, len(self._d), n):
            yield self._d[i:i + n]

    def read(self):
        return self._d

    def close(self):
        self.closed = True


class _Denied(Exception):
    def __init__(self):
        self.response = {"Error": {"Code": "AccessDenied"}}


class FakeS3:
    """In-memory S3 that behaves like the production instance role: only <tenant>/... keys are accessible, anything
    else (for example a legacy SiteVision/... key) is answered with AccessDenied, exactly as real S3 does."""

    ALLOWED = ("myhome/", "kohinoor/")

    def __init__(self):
        self.objects: dict[str, dict] = {}
        self.deleted: list[str] = []

    def _check(self, Key):
        if not Key.startswith(self.ALLOWED):
            raise _Denied()

    def put_object(self, *, Bucket, Key, Body, ContentType, ChecksumAlgorithm, Metadata):
        assert ChecksumAlgorithm == "SHA256"
        self._check(Key)
        self.objects[Key] = {"data": bytes(Body), "ct": ContentType}

    def head_object(self, *, Bucket, Key, ChecksumMode=None):
        self._check(Key)
        if Key not in self.objects:
            raise _Missing()
        return {"ContentLength": len(self.objects[Key]["data"])}

    def get_object(self, *, Bucket, Key):
        self._check(Key)
        if Key not in self.objects:
            raise _Missing()
        o = self.objects[Key]
        return {"Body": _Body(o["data"]), "ContentLength": len(o["data"]), "ContentType": o["ct"], "ETag": '"abc"'}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)
        self.deleted.append(Key)


def _jpeg(color=(10, 20, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (64, 32), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def s3(tmp_path, monkeypatch):
    fake = FakeS3()
    s = get_settings()
    monkeypatch.setattr(s, "MEDIA_OBJECT_STORE", "s3")
    monkeypatch.setattr(s, "S3_BUCKET", "sitevision-test")
    monkeypatch.setattr(object_store, "_client", lambda: fake)
    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    return fake


# ── configuration ─────────────────────────────────────────────────────────────

def test_s3_mode_requires_a_bucket_and_values_are_validated():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(MEDIA_OBJECT_STORE="s3", S3_BUCKET="")
    with pytest.raises(ValidationError):
        Settings(MEDIA_OBJECT_STORE="ftp")
    with pytest.raises(ValidationError):
        Settings(FLOORPLAN_STORAGE="dropbox")
    assert Settings(MEDIA_OBJECT_STORE="s3", S3_BUCKET="b").MEDIA_OBJECT_STORE == "s3"


def test_default_is_disk_and_nothing_touches_s3(tmp_path, monkeypatch):
    assert get_settings().MEDIA_OBJECT_STORE == "disk" and not object_store.s3_enabled()


@pytest.mark.parametrize("bad", ["", "../x", "a/../b", "/..", "a/./b/.."])
def test_object_keys_cannot_escape(bad):
    with pytest.raises(ValueError):
        object_store.safe_key(bad)
    assert object_store.safe_key("\\myhome\\sites//captures/x.jpg") == "myhome/sites/captures/x.jpg"


# ── writes ────────────────────────────────────────────────────────────────────

def test_save_media_writes_the_same_keys_to_s3_and_nothing_to_disk(s3, tmp_path):
    asset = lms._write_local_sync(data=_jpeg(), filename="p.jpg", folder=f"myhome/sites/captures/{ORG}")
    key = asset["public_id"][len("local/"):]
    assert key.startswith(f"myhome/sites/captures/{ORG}/") and key in s3.objects
    assert any("/thumbs/" in k for k in s3.objects)                       # thumbnail beside it
    assert asset["storage"] == "local" and asset["store"] == "s3"
    assert not any(tmp_path.rglob("*.jpg"))                                  # nothing on disk
    assert s3.objects[key]["ct"] == "image/jpeg" and s3.objects[key]["data"] == _jpeg()


def test_pdf_floor_plan_stores_pdf_preview_and_thumbnail_in_s3(s3):
    pytest.importorskip("pymupdf")
    import pymupdf as fitz

    doc = fitz.open()
    doc.new_page(width=300, height=200).insert_text((20, 40), "plan")
    pdf = doc.tobytes()
    asset = lms._write_local_sync(data=pdf, filename="Floor plan.pdf", folder=f"myhome/sites/floorplans/{ORG}/fp1")
    keys = sorted(s3.objects)
    assert sum(k.endswith(".pdf") for k in keys) == 1 and sum(k.endswith("_preview.png") for k in keys) == 1
    assert asset["format"] == "pdf" and asset["raw_pdf_url"] and asset["pages"] == 1


# ── deletes ───────────────────────────────────────────────────────────────────

def test_delete_removes_original_thumbnails_preview_and_the_legacy_copy(s3, monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    for k in (f"myhome/sites/captures/{ORG}/a.jpg", f"myhome/sites/captures/{ORG}/thumbs/a_thumb.jpg",
              f"myhome/sites/floorplans/{ORG}/fp1/a_preview.png", f"myhome/sites/captures/{ORG}/keep.jpg"):
        s3.objects[k] = {"data": b"x", "ct": "image/jpeg"}
    assert lms.delete_local_asset(f"local/SiteVision/captures/{ORG}/a.jpg") is True
    assert sorted(s3.objects) == [f"myhome/sites/captures/{ORG}/keep.jpg", f"myhome/sites/floorplans/{ORG}/fp1/a_preview.png"]
    assert lms.local_asset_exists(f"local/myhome/sites/captures/{ORG}/keep.jpg") is True
    assert lms.local_asset_exists(f"local/myhome/sites/captures/{ORG}/a.jpg") is False


def test_cross_tenant_delete_is_refused_in_s3_too(s3, monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", True)
    k = f"myhome/sites/captures/{ORG}/a.jpg"
    s3.objects[k] = {"data": b"x", "ct": "image/jpeg"}
    with tenancy.use_tenant(KO):
        assert lms.delete_local_asset(f"local/{k}") is False
    assert k in s3.objects


# ── the /media route ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def media_client(s3, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()
    s = get_settings()
    monkeypatch.setattr(s, "MULTI_TENANT_ENABLED", True)
    monkeypatch.setattr(s, "TENANT_RESOLUTION", "email")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://api.test") as c:
        yield c


def _signed(tenant, path):
    from app.services.media_access import sign_media_path

    with tenancy.use_tenant(tenant):
        return sign_media_path(path)


@pytest.mark.asyncio
async def test_route_streams_from_s3_for_the_owner_and_refuses_everyone_else(media_client, s3):
    key = f"myhome/sites/captures/{ORG}/a.jpg"
    s3.objects[key] = {"data": _jpeg(), "ct": "image/jpeg"}
    r = await media_client.get(_signed(MY, f"/media/{key}"))
    assert r.status_code == 200 and r.content == _jpeg() and r.headers["content-type"] == "image/jpeg"
    assert r.headers["content-length"] == str(len(_jpeg())) and r.headers["cross-origin-resource-policy"] == "cross-origin"
    assert (await media_client.get(_signed(KO, f"/media/{key}"))).status_code in (401, 404)   # another tenant: refused
    assert (await media_client.get(f"/media/{key}")).status_code == 401                      # unsigned: refused


@pytest.mark.asyncio
async def test_large_objects_are_streamed_and_small_ones_sent_in_one_response(media_client, s3, monkeypatch):
    import app.main as app_main

    key = f"myhome/sites/captures/{ORG}/big.jpg"
    s3.objects[key] = {"data": _jpeg() * 50, "ct": "image/jpeg"}
    url = _signed(MY, f"/media/{key}")
    small = await media_client.get(url)
    assert small.status_code == 200 and small.content == _jpeg() * 50 and "content-length" in small.headers
    monkeypatch.setattr(app_main, "_MEDIA_SINGLE_RESPONSE_MAX_BYTES", 10)           # force the streaming path
    big = await media_client.get(url)
    assert big.status_code == 200 and big.content == _jpeg() * 50 and big.headers["content-length"] == str(len(_jpeg() * 50))


@pytest.mark.asyncio
async def test_route_serves_legacy_urls_from_the_tenant_key_without_a_database_rewrite(media_client, s3):
    s3.objects[f"myhome/sites/captures/{ORG}/a.jpg"] = {"data": _jpeg(), "ct": "image/jpeg"}
    r = await media_client.get(_signed(MY, f"/media/SiteVision/captures/{ORG}/a.jpg"))        # the URL stored in Mongo today
    assert r.status_code == 200 and r.content == _jpeg()
    assert (await media_client.get(_signed(KO, f"/media/SiteVision/captures/{ORG}/a.jpg"))).status_code in (401, 404)


@pytest.mark.asyncio
async def test_legacy_urls_never_ask_s3_for_the_legacy_key_and_a_missing_file_is_404_not_500(media_client, s3):
    """Regression: production answered 500 for every legacy /media/SiteVision/... image because the first S3 lookup used
    the legacy key, which the instance role may not access (S3 answers AccessDenied)."""
    asked = []
    real_get = s3.get_object
    s3.get_object = lambda **kw: (asked.append(kw["Key"]), real_get(**kw))[1]
    s3.objects[f"myhome/sites/captures/{ORG}/thumbs/t_thumb.jpg"] = {"data": _jpeg(), "ct": "image/jpeg"}
    ok = await media_client.get(_signed(MY, f"/media/SiteVision/captures/{ORG}/thumbs/t_thumb.jpg"))
    assert ok.status_code == 200 and ok.content == _jpeg()
    assert asked == [f"myhome/sites/captures/{ORG}/thumbs/t_thumb.jpg"]                 # only the tenant key was requested
    gone = await media_client.get(_signed(MY, f"/media/SiteVision/captures/{ORG}/never-existed.jpg"))
    assert gone.status_code == 404                                                       # not a 500
    outside = await media_client.get(_signed(MY, "/media/SiteVision/odd.jpg"))
    assert outside.status_code in (401, 404)


@pytest.mark.asyncio
async def test_image_fetch_for_analysis_reads_media_from_s3(s3, tmp_path, monkeypatch):
    """AI analysis / room-map extraction download images by their /media URL; in S3 mode they must come from the bucket."""
    from app.services import image_fetch

    s3.objects[f"myhome/sites/captures/{ORG}/pano.jpg"] = {"data": _jpeg(), "ct": "image/jpeg"}
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", True)
    with tenancy.use_tenant(MY):
        data, mime = await image_fetch.download_image(f"/media/myhome/sites/captures/{ORG}/pano.jpg?exp=1&sig=x", timeout=5)
        legacy, _ = await image_fetch.download_image(f"/media/SiteVision/captures/{ORG}/pano.jpg", timeout=5)
        assert data == legacy == _jpeg() and mime == "image/jpeg"
        with pytest.raises(ValueError):
            await image_fetch.download_image(f"/media/myhome/sites/captures/{ORG}/missing.jpg", timeout=5)
    with tenancy.use_tenant(KO):                                                         # another tenant: refused
        with pytest.raises(ValueError):
            await image_fetch.download_image(f"/media/myhome/sites/captures/{ORG}/pano.jpg", timeout=5)


@pytest.mark.asyncio
async def test_private_work_objects_are_never_served(media_client, s3):
    key = f"myhome/_work/stitch-spool/raw.insp"
    s3.objects[key] = {"data": b"raw", "ct": "application/octet-stream"}
    assert (await media_client.get(_signed(MY, f"/media/{key}"))).status_code == 404


@pytest.mark.asyncio
async def test_disk_fallback_during_migration_and_strict_mode(media_client, s3, tmp_path, monkeypatch):
    rel = f"myhome/sites/captures/{ORG}/only-on-disk.jpg"
    (tmp_path / rel).parent.mkdir(parents=True)
    (tmp_path / rel).write_bytes(_jpeg((1, 2, 3)))
    url = _signed(MY, f"/media/{rel}")
    s = get_settings()
    monkeypatch.setattr(s, "S3_READ_FALLBACK_TO_DISK", True)
    assert (await media_client.get(url)).status_code == 200                                    # not in S3 yet: disk answers
    monkeypatch.setattr(s, "S3_READ_FALLBACK_TO_DISK", False)
    assert (await media_client.get(url)).status_code == 404                                    # strict: S3 only
    assert (await media_client.get(_signed(MY, f"/media/myhome/sites/captures/{ORG}/missing.jpg"))).status_code == 404


# ── the migration tool's mapping rules ────────────────────────────────────────

_spec = importlib.util.spec_from_file_location("migrate_media_to_s3", pathlib.Path(__file__).resolve().parents[2] / "scripts" / "migrate_media_to_s3.py")
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


@pytest.mark.parametrize("pid,fmt,org,expected", [
    (f"SiteVision/floorplans/{ORG}/fp-1/Floor_plan_abc", "pdf", None, f"myhome/sites/floorplans/{ORG}/fp-1/Floor_plan_abc.pdf"),
    (f"floorplans/{ORG}/fp-1/x_cropped_q", "png", None, f"myhome/sites/floorplans/{ORG}/fp-1/x_cropped_q.png"),
    (f"captures/{ORG}/IMG_1_abc", "jpg", None, f"myhome/sites/captures/{ORG}/IMG_1_abc.jpg"),
    ("horizon/thumbnails/abc123", "webp", ORG, f"myhome/sites/thumbnails/{ORG}/abc123.webp"),
    ("sitevision/thumbnails/zzz", "jpg", ORG, f"myhome/sites/thumbnails/{ORG}/zzz.jpg"),
    (f"SiteVision/avatars/{ORG}/me", "jpg", None, f"myhome/users/avatars/{ORG}/me.jpg"),
])
def test_cloudinary_public_ids_map_into_the_tenant_layout(pid, fmt, org, expected):
    assert mig.map_key(pid, fmt, org)[0] == expected


def test_unmappable_assets_are_reported_not_guessed():
    assert mig.map_key("random/folder/x", "jpg", ORG)[0] is None
    assert mig.map_key("horizon/thumbnails/x", "jpg", None)[0] is None


def test_cloudinary_url_parsing_and_render_classification():
    u = "https://res.cloudinary.com/cld/image/upload/dn_300,dpr_3.0,f_png,fl_attachment:false,pg_1,q_100/v1/SiteVision/floorplans/o/e/n_abc"
    cloud, rtype, tr, ver, pid, ext = mig.parse_cloudinary_url(u)
    assert (cloud, rtype, ver, pid, ext) == ("cld", "image", "v1", "SiteVision/floorplans/o/e/n_abc", "") and mig.classify_render(tr) == "preview"
    t = mig.parse_cloudinary_url("https://res.cloudinary.com/cld/image/upload/c_fill,f_png,h_320,pg_1,q_auto,w_480/v1/SiteVision/floorplans/o/e/n_abc")
    assert mig.classify_render(t[2]) == "thumb"
    p = mig.parse_cloudinary_url("https://res.cloudinary.com/cld/image/upload/v178/captures/o/IMG.jpg")
    assert p[2] == "" and p[4] == "captures/o/IMG" and p[5] == ".jpg"
    assert mig.classify_render("c_scale,f_auto,q_auto,w_640") is None
    assert mig.parse_cloudinary_url("https://example.com/x.jpg") is None


def test_apply_refuses_without_confirmation(tmp_path, monkeypatch):
    monkeypatch.delenv(mig.CONFIRM_ENV, raising=False)
    assert mig.main(["apply", "--out", str(tmp_path)]) == 2
