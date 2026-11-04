"""Raw 360 captures are copied to <tenant>/sites/captures/rawfiles/ so a stitch can be inspected later."""
import asyncio

import pytest

from app.core.config import get_settings
from app.services import capture_stitch_service as css
from app.services import object_store

DEDUP = "6a3a28dd0915399ba5cb6922:abcdef12" + "0" * 56      # "<org id>:<sha256>", as built in workflow.py


@pytest.fixture
def s3_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "RETAIN_RAW_CAPTURES", True)
    monkeypatch.setattr(object_store, "s3_enabled", lambda: True)
    monkeypatch.setattr("app.core.tenancy.storage_root_segments", lambda kind=None: ["myhome", "sites"])


class TestKey:
    def test_lives_in_the_rawfiles_folder_next_to_the_org_folders(self, s3_on):
        key = css._raw_archive_key("IMG_20261031_111320_00_112.insp", DEDUP)
        assert key == "myhome/sites/captures/rawfiles/abcdef12_IMG_20261031_111320_00_112.insp"

    def test_the_prefix_is_the_file_hash_not_the_org_id(self, s3_on):
        a = css._raw_archive_key("IMG_1.insp", "6a3a28dd0915399ba5cb6922:" + "a" * 64)
        b = css._raw_archive_key("IMG_1.insp", "6a3a28dd0915399ba5cb6922:" + "b" * 64)
        assert a != b and a.endswith("/aaaaaaaa_IMG_1.insp") and b.endswith("/bbbbbbbb_IMG_1.insp")

    def test_unsafe_names_cannot_escape_the_folder(self, s3_on):
        key = css._raw_archive_key("../../other tenant/evil name.INSP", DEDUP)
        assert key.startswith("myhome/sites/captures/rawfiles/abcdef12_")
        assert ".." not in key and key.count("/") == 4

    def test_off_when_the_setting_is_false(self, s3_on, monkeypatch):
        monkeypatch.setattr(get_settings(), "RETAIN_RAW_CAPTURES", False)
        assert css._raw_archive_key("a.insp", DEDUP) is None

    def test_off_when_media_is_not_in_s3(self, s3_on, monkeypatch):
        monkeypatch.setattr(object_store, "s3_enabled", lambda: False)
        assert css._raw_archive_key("a.insp", DEDUP) is None


class _Store:
    def __init__(self, exists=False, fail=False):
        self.exists, self.fail, self.puts = exists, fail, []

    def install(self, monkeypatch):
        monkeypatch.setattr(object_store, "object_exists", lambda key: self.exists)

        def put(key, data, *, content_type=None, metadata=None):
            if self.fail:
                raise RuntimeError("AccessDenied")
            self.puts.append((key, data, content_type, metadata))

        monkeypatch.setattr(object_store, "put_object", put)


@pytest.mark.asyncio
async def test_copies_the_raw_bytes_under_the_key(monkeypatch, tmp_path):
    raw = tmp_path / "x.insp"
    raw.write_bytes(b"RAWBYTES")
    store = _Store()
    store.install(monkeypatch)
    await css._archive_raw_copy("myhome/sites/captures/rawfiles/k.insp", raw, "job1")
    assert store.puts == [("myhome/sites/captures/rawfiles/k.insp", b"RAWBYTES", "application/octet-stream", {"stitch-job": "job1"})]


@pytest.mark.asyncio
async def test_does_not_upload_again_when_the_copy_already_exists(monkeypatch, tmp_path):
    raw = tmp_path / "x.insp"
    raw.write_bytes(b"RAWBYTES")
    store = _Store(exists=True)
    store.install(monkeypatch)
    await css._archive_raw_copy("k", raw, "job1")
    assert store.puts == []


@pytest.mark.asyncio
async def test_nothing_happens_without_a_key(monkeypatch, tmp_path):
    store = _Store()
    store.install(monkeypatch)
    await css._archive_raw_copy(None, tmp_path / "missing.insp", "job1")
    assert store.puts == []


@pytest.mark.asyncio
async def test_a_storage_error_never_stops_the_stitch(monkeypatch, tmp_path):
    raw = tmp_path / "x.insp"
    raw.write_bytes(b"RAWBYTES")
    _Store(fail=True).install(monkeypatch)
    await css._archive_raw_copy("k", raw, "job1")        # must not raise


@pytest.mark.asyncio
async def test_a_missing_spool_file_never_stops_the_stitch(monkeypatch, tmp_path):
    _Store().install(monkeypatch)
    await css._archive_raw_copy("k", tmp_path / "gone.insp", "job1")   # must not raise


@pytest.mark.asyncio
async def test_a_hung_upload_is_abandoned_after_the_timeout(monkeypatch, tmp_path):
    import time

    raw = tmp_path / "x.insp"
    raw.write_bytes(b"x")
    monkeypatch.setattr(css, "_RAW_ARCHIVE_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(object_store, "object_exists", lambda key: False)
    monkeypatch.setattr(object_store, "put_object", lambda *a, **k: time.sleep(0.5))
    t = asyncio.get_running_loop().time()
    await css._archive_raw_copy("k", raw, "job1")
    assert asyncio.get_running_loop().time() - t < 0.4
