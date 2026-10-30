"""Domain-based tenant routing and isolation (My Home vs Kohinoor)."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.core import tenancy
from app.core.config import get_settings
from app.core.exceptions import InvalidTokenException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)
from app.middleware.tenant import TenantMiddleware

MY = tenancy.tenant_by_slug("myhome")
KO = tenancy.tenant_by_slug("kohinoor")
ORG = "6a3a28dd0915399ba5cb6922"


@pytest.fixture
def mt(monkeypatch):
    """Multi-tenant mode on, no real Mongo (Motor clients are lazy)."""
    s = get_settings()
    monkeypatch.setattr(s, "MULTI_TENANT_ENABLED", True)
    monkeypatch.setattr(s, "TENANT_TRUST_FORWARDED_HOST", False)
    monkeypatch.setattr(s, "TENANT_DEV_DEFAULT", "")
    monkeypatch.setattr(s, "TENANT_MYHOME_EXTRA_HOSTS", "")
    monkeypatch.setattr(s, "TENANT_KOHINOOR_EXTRA_HOSTS", "")
    from app.db import mongodb

    monkeypatch.setattr(mongodb, "_tenant_clients", {
        "myhome": AsyncIOMotorClient("mongodb://127.0.0.1:1", serverSelectionTimeoutMS=100),
        "kohinoor": AsyncIOMotorClient("mongodb://127.0.0.1:2", serverSelectionTimeoutMS=100),
    })
    return s


# ── Host -> tenant resolution ─────────────────────────────────────────────────

@pytest.mark.parametrize("host,slug", [
    ("myhomeconstructions.com", "myhome"),
    ("MyHomeConstructions.com", "myhome"),
    ("myhomeconstructions.com:8002", "myhome"),
    ("myhomeconstructions.com.", "myhome"),
    ("www.myhomeconstructions.com", "myhome"),
    ("api.myhomeconstructions.com", "myhome"),
    ("kohinoorpune.com", "kohinoor"),
    ("api.kohinoorpune.com:443", "kohinoor"),
])
def test_known_hosts_resolve(mt, host, slug):
    assert tenancy.resolve_tenant(host).slug == slug


@pytest.mark.parametrize("host", [
    None, "", "localhost", "127.0.0.1", "example.com",
    "evilmyhomeconstructions.com", "myhomeconstructions.com.evil.com",
    "myhomeconstructions.com@evil.com", "kohinoorpune.com:notaport", "[::1]:8002",
    "myhomeconstructions.com\r\nX: y", "evil.com/myhomeconstructions.com",
    "sub.myhomeconstructions.com", "kohinoorpune.com,evil.com",
])
def test_unknown_or_spoofed_hosts_rejected(mt, host):
    assert tenancy.resolve_tenant(host) is None


def test_forwarded_host_ignored_unless_trusted(mt, monkeypatch):
    assert tenancy.resolve_tenant("kohinoorpune.com", "myhomeconstructions.com").slug == "kohinoor"
    monkeypatch.setattr(mt, "TENANT_TRUST_FORWARDED_HOST", True)
    assert tenancy.resolve_tenant("kohinoorpune.com", "myhomeconstructions.com").slug == "myhome"
    assert tenancy.resolve_tenant("kohinoorpune.com", "evil.com") is None


def test_extra_hosts_are_exact_and_cannot_cross_tenants(mt, monkeypatch):
    monkeypatch.setattr(mt, "TENANT_KOHINOOR_EXTRA_HOSTS", "staging.kohinoorpune.com")
    assert tenancy.resolve_tenant("staging.kohinoorpune.com").slug == "kohinoor"
    assert tenancy.resolve_tenant("x.staging.kohinoorpune.com") is None
    monkeypatch.setattr(mt, "TENANT_MYHOME_EXTRA_HOSTS", "staging.kohinoorpune.com")
    with pytest.raises(ValueError):
        tenancy.host_map()


def test_dev_default_applies_to_localhost_only_outside_production(mt, monkeypatch):
    monkeypatch.setattr(mt, "TENANT_DEV_DEFAULT", "myhome")
    assert tenancy.resolve_tenant("localhost:5173").slug == "myhome"
    monkeypatch.setattr(type(mt), "is_production", property(lambda self: True))
    assert tenancy.resolve_tenant("localhost:5173") is None


# ── Middleware ────────────────────────────────────────────────────────────────

def _app():
    app = FastAPI()
    app.add_middleware(TenantMiddleware)

    @app.get("/whoami")
    async def whoami():
        t = tenancy.current_tenant()
        return {"tenant": t.slug if t else None}

    @app.get("/health")
    async def health():
        return {"tenant": tenancy.current_tenant().slug if tenancy.current_tenant() else None}

    return app


async def _get(app, host, path, **kw):
    async with AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}") as c:
        return await c.get(path, **kw)


@pytest.mark.asyncio
async def test_middleware_binds_tenant_from_host(mt):
    assert (await _get(_app(), "myhomeconstructions.com", "/whoami")).json() == {"tenant": "myhome"}
    assert (await _get(_app(), "kohinoorpune.com", "/whoami")).json() == {"tenant": "kohinoor"}


@pytest.mark.asyncio
async def test_middleware_rejects_unknown_host_and_ignores_client_tenant_hints(mt):
    r = await _get(_app(), "evil.example", "/whoami")
    assert r.status_code == 421
    r = await _get(_app(), "kohinoorpune.com", "/whoami?tenant=myhome&tid=myhome",
                   headers={"X-Tenant-Id": "myhome", "X-Forwarded-Host": "myhomeconstructions.com"})
    assert r.json() == {"tenant": "kohinoor"}


@pytest.mark.asyncio
async def test_health_is_exempt_and_tenantless(mt):
    r = await _get(_app(), "evil.example", "/health")
    assert r.status_code == 200 and r.json() == {"tenant": None}


@pytest.mark.asyncio
async def test_disabled_mode_is_a_noop(monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    r = await _get(_app(), "anything.example", "/whoami")
    assert r.status_code == 200 and r.json() == {"tenant": None}


# ── Database selection (My Home ↔ SiteVisionMyHome, Kohinoor ↔ SiteVisionKohinoor) ─

def test_database_selected_per_tenant(mt):
    from app.db.mongodb import get_database

    with tenancy.use_tenant(MY):
        a = get_database()
    with tenancy.use_tenant(KO):
        b = get_database()
    assert (a.name, b.name) == ("SiteVisionMyHome", "SiteVisionKohinoor")
    assert a.client is not b.client


def test_database_access_fails_closed_without_tenant(mt, monkeypatch):
    from app.db import mongodb

    monkeypatch.setattr(mongodb._mongo, "db", object())  # a legacy handle must NOT be used
    with pytest.raises(tenancy.TenantResolutionError):
        mongodb.get_database()


@pytest.mark.asyncio
async def test_get_db_dependency_follows_request_host(mt):
    from app.core.dependencies import DB

    app = FastAPI()
    app.add_middleware(TenantMiddleware)

    @app.get("/db")
    async def which(db: DB):
        return {"db": db.name}

    assert (await _get(app, "myhomeconstructions.com", "/db")).json() == {"db": "SiteVisionMyHome"}
    assert (await _get(app, "kohinoorpune.com", "/db")).json() == {"db": "SiteVisionKohinoor"}


# ── Tokens ────────────────────────────────────────────────────────────────────

def test_token_issued_for_one_tenant_is_rejected_by_the_other(mt):
    with tenancy.use_tenant(MY):
        access = create_access_token("u1", ORG, "admin")
        refresh, _ = create_refresh_token("u1", ORG)
        assert decode_access_token(access)["tid"] == "myhome"
        assert decode_refresh_token(refresh)["tid"] == "myhome"
    with tenancy.use_tenant(KO):
        with pytest.raises(InvalidTokenException):
            decode_access_token(access)
        with pytest.raises(InvalidTokenException):
            decode_refresh_token(refresh)


def test_forged_token_signed_without_tenant_key_is_rejected(mt, monkeypatch):
    # A token minted in single-tenant mode (plain secret, no tid) must not authenticate.
    monkeypatch.setattr(mt, "MULTI_TENANT_ENABLED", False)
    legacy = create_access_token("u1", ORG, "admin")
    monkeypatch.setattr(mt, "MULTI_TENANT_ENABLED", True)
    with tenancy.use_tenant(MY):
        with pytest.raises(InvalidTokenException):
            decode_access_token(legacy)


def test_decode_without_tenant_context_is_rejected(mt):
    with tenancy.use_tenant(MY):
        token = create_access_token("u1", ORG, "admin")
    with pytest.raises(InvalidTokenException):
        decode_access_token(token)


def test_single_tenant_tokens_unchanged(monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    t = create_access_token("u1", ORG, "admin")
    payload = decode_access_token(t)
    assert "tid" not in payload and payload["org"] == ORG


@pytest.mark.asyncio
async def test_cross_tenant_token_rejected_through_real_auth_dependency(mt, monkeypatch):
    from app.core.dependencies import CurrentUser
    from app.repositories.user import UserRepository

    async def fake_find(self, user_id, org_id=None):
        return SimpleNamespace(id=user_id, org_id=org_id, role="admin", is_active=True)

    monkeypatch.setattr(UserRepository, "find_by_id", fake_find)
    app = FastAPI()
    app.add_middleware(TenantMiddleware)

    @app.get("/me")
    async def me(user: CurrentUser):
        return {"id": user.id}

    with tenancy.use_tenant(MY):
        my_token = create_access_token("u1", ORG, "admin")
    hdr = {"Authorization": f"Bearer {my_token}"}
    assert (await _get(app, "myhomeconstructions.com", "/me", headers=hdr)).status_code == 200
    assert (await _get(app, "kohinoorpune.com", "/me", headers=hdr)).status_code == 401


# ── Revocation store namespacing ──────────────────────────────────────────────

def test_token_revocation_is_per_tenant(mt):
    from app.core.token_store import token_store

    with tenancy.use_tenant(MY):
        token_store.revoke("jti-shared")
        token_store.revoke_user("user-1")
        assert token_store.is_revoked("jti-shared") and token_store.user_epoch("user-1") > 0
    with tenancy.use_tenant(KO):
        assert not token_store.is_revoked("jti-shared")
        assert token_store.user_epoch("user-1") == 0


# ── Media: tenant ownership, signing, storage keys ────────────────────────────

@pytest.mark.parametrize("tenant,path,ok", [
    (MY, "SiteVision/captures/org/id/a.jpg", True),
    (MY, "myhome/sites/captures/org/id/a.jpg", True),
    (MY, "kohinoor/sites/captures/org/id/a.jpg", False),
    (KO, "SiteVision/captures/org/id/a.jpg", False),       # legacy files are My Home's only
    (KO, "avatars/u1.png", False),
    (KO, "kohinoor/sites/captures/org/id/a.jpg", True),
    (KO, "myhome/sites/captures/org/id/a.jpg", False),
    (KO, "kohinoor/sites/../myhome/captures/x.jpg", False),
    (KO, "tenants\\kohinoor\\..\\myhome\\x.jpg", False),
    (KO, "KOHINOOR/sites/captures/o/i/a.jpg", True),
    (KO, "kohinoorx/sites/captures/o/i/a.jpg", False),
    (KO, "kohinoor", False),
    (MY, "", False),
])
def test_media_path_ownership(mt, tenant, path, ok):
    with tenancy.use_tenant(tenant):
        assert tenancy.media_path_allowed(path) is ok


def test_media_path_denied_without_tenant(mt):
    assert tenancy.media_path_allowed("kohinoor/sites/x.jpg") is False


def test_signed_media_url_valid_only_for_its_tenant(mt):
    from app.services.media_access import sign_media_path, verify_media_signature
    from urllib.parse import parse_qs, urlsplit

    with tenancy.use_tenant(KO):
        signed = sign_media_path("/media/kohinoor/sites/captures/o/i/a.jpg")
    q = parse_qs(urlsplit(signed).query)
    args = dict(exp=q["exp"][0], sig=q["sig"][0])
    with tenancy.use_tenant(KO):
        assert verify_media_signature("/media/kohinoor/sites/captures/o/i/a.jpg", **args)
    with tenancy.use_tenant(MY):
        assert not verify_media_signature("/media/kohinoor/sites/captures/o/i/a.jpg", **args)


def test_new_upload_keys_are_tenant_scoped(mt, monkeypatch):
    from app.services.cloudinary_service import cloudinary_folder

    with tenancy.use_tenant(KO):
        assert cloudinary_folder("captures", "orgK", "e1") == "kohinoor/sites/captures/orgK/e1"
        assert cloudinary_folder("floorplans", "orgK").startswith("kohinoor/sites/floorplans/")
        assert cloudinary_folder("avatars", "orgK") == "kohinoor/users/avatars/orgK"       # avatars live under users/
    with tenancy.use_tenant(MY):
        assert cloudinary_folder("captures", "orgM", "e1") == "myhome/sites/captures/orgM/e1"
    monkeypatch.setattr(mt, "MULTI_TENANT_ENABLED", False)
    assert cloudinary_folder("captures", "orgM", "e1") == "SiteVision/captures/orgM/e1"


def test_org_segment_parsed_for_both_key_shapes():
    from app.services.media_access import _org_id_from_file_path as org_of

    assert org_of("SiteVision/captures/ORG/id/a.jpg") == "ORG"
    assert org_of("kohinoor/sites/captures/ORG/id/a.jpg") == "ORG"


def test_cross_tenant_delete_is_refused(mt, monkeypatch):
    from app.services import local_media_service as lms

    touched = []
    monkeypatch.setattr(lms, "disk_path_for_public_id", lambda pid: touched.append(pid) or (_ for _ in ()).throw(RuntimeError("no fs")))
    with tenancy.use_tenant(KO):
        assert lms.delete_local_asset("local/SiteVision/captures/org/id/a.jpg") is False
        assert lms.delete_local_asset("local/myhome/sites/captures/org/id/a.jpg") is False
    assert touched == []  # refused before any filesystem lookup


@pytest.mark.asyncio
async def test_media_route_enforces_tenant_before_auth_and_after_resolve(mt, tmp_path, monkeypatch):
    from app.main import create_app
    from app.services import local_media_service as lms
    from app.services.media_access import sign_media_path

    (tmp_path / "kohinoor" / "sites" / "captures" / "o" / "i").mkdir(parents=True)
    (tmp_path / "kohinoor" / "sites" / "captures" / "o" / "i" / "a.jpg").write_bytes(b"x")
    (tmp_path / "myhome" / "sites" / "captures" / "o" / "i").mkdir(parents=True)
    (tmp_path / "myhome" / "sites" / "captures" / "o" / "i" / "secret.jpg").write_bytes(b"s")
    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    monkeypatch.setattr("app.main.upload_root", lms.upload_root, raising=False)
    app = create_app()

    with tenancy.use_tenant(KO):
        own = sign_media_path("/media/kohinoor/sites/captures/o/i/a.jpg")
        other = sign_media_path("/media/myhome/sites/captures/o/i/secret.jpg")
        hop = sign_media_path("/media/kohinoor/../myhome/sites/captures/o/i/secret.jpg")      # normalises to the OTHER tenant's folder
    assert (await _get(app, "kohinoorpune.com", own)).status_code == 200
    assert (await _get(app, "kohinoorpune.com", other)).status_code == 404      # another tenant's path
    assert (await _get(app, "kohinoorpune.com", hop)).status_code == 404        # traversal hop
    assert (await _get(app, "myhomeconstructions.com", own)).status_code == 404  # wrong host for the URL
    assert (await _get(app, "evil.example", own)).status_code == 421


@pytest.mark.asyncio
async def test_api_routes_gated_by_host_in_real_app(mt):
    from app.main import create_app

    app = create_app()
    assert (await _get(app, "evil.example", "/api/v1/workflow/snapshot")).status_code == 421
    assert (await _get(app, "kohinoorpune.com", "/api/v1/workflow/snapshot")).status_code == 401  # tenant ok, no token


# ── Background work keeps its tenant ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_startup_work_runs_once_per_tenant_in_that_tenants_context(mt, monkeypatch):
    import app.main as m

    seen = []
    monkeypatch.setattr(m, "get_database", lambda: SimpleNamespace(name=tenancy.require_tenant().db_name))

    async def job(db):
        seen.append((tenancy.current_tenant().slug, db.name))

    await m._for_each_database(job, "test")
    assert seen == [("myhome", "SiteVisionMyHome"), ("kohinoor", "SiteVisionKohinoor")]
    assert tenancy.current_tenant() is None


@pytest.mark.asyncio
async def test_one_tenant_failing_does_not_block_the_other(mt, monkeypatch):
    import app.main as m

    monkeypatch.setattr(m, "get_database", lambda: SimpleNamespace(name=tenancy.require_tenant().slug))
    done = []

    async def job(db):
        if db.name == "myhome":
            raise RuntimeError("boom")
        done.append(db.name)

    await m._for_each_database(job, "test")
    assert done == ["kohinoor"]


@pytest.mark.asyncio
async def test_spawned_task_keeps_the_tenant_it_was_created_under(mt):
    out = {}

    async def work(key):
        await asyncio.sleep(0.01)
        out[key] = tenancy.current_tenant().slug

    tasks = []
    for tenant in (MY, KO):
        with tenancy.use_tenant(tenant):
            tasks.append(asyncio.create_task(work(tenant.slug)))
    await asyncio.gather(*tasks)
    assert out == {"myhome": "myhome", "kohinoor": "kohinoor"}


# ── Media isolation: uploads, spool, failures, local image fetch ───────────────

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc0f01f0005000201a5f645400000000049454e44ae426082")


def test_private_work_dirs_are_tenant_scoped_and_never_served(mt, tmp_path, monkeypatch):
    from app.services import local_media_service as lms
    from app.services.media_access import is_private_media_path

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    with tenancy.use_tenant(KO):
        d = lms.private_work_dir("stitch-spool")
    assert d == tmp_path / "kohinoor" / "_work" / "stitch-spool"
    assert is_private_media_path(d.relative_to(tmp_path).as_posix())
    with tenancy.use_tenant(MY):
        assert lms.private_work_dir("stitch_failures") == tmp_path / "myhome" / "_work" / "stitch_failures"
    with pytest.raises(tenancy.TenantResolutionError):
        lms.private_work_dir("stitch-spool")  # no tenant -> fail closed


def test_private_work_dirs_unchanged_when_single_tenant(tmp_path, monkeypatch):
    from app.services import local_media_service as lms

    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    assert lms.private_work_dir("stitch-spool") == tmp_path / "stitch-spool"


def test_raw_spool_lands_in_the_tenants_private_dir(mt, tmp_path, monkeypatch):
    from app.api.v1.endpoints import workflow
    from app.services import local_media_service as lms

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    with tenancy.use_tenant(KO):
        p = workflow._spool_raw_upload("org:abc123", b"raw", ".insp")
    assert p == tmp_path / "kohinoor" / "_work" / "stitch-spool" / "abc123.insp" and p.read_bytes() == b"raw"


@pytest.mark.asyncio
async def test_image_upload_endpoint_uses_tenant_scoped_folder(mt, monkeypatch):
    from fastapi import UploadFile
    from io import BytesIO
    from starlette.datastructures import Headers

    from app.api.v1.endpoints import uploads

    seen = {}

    async def fake_persist(**kw):
        seen["folder"] = kw["folder"]
        return {"original_url": "u", "public_id": "p"}

    monkeypatch.setattr(uploads, "_persist_processed_bytes", fake_persist)
    f = UploadFile(file=BytesIO(_PNG), filename="a.png", headers=Headers({"content-type": "image/png"}))
    with tenancy.use_tenant(KO):
        await uploads.upload_image(file=f, folder="thumbnails", current_user=SimpleNamespace(id="u", org_id="orgK"))
    assert seen["folder"] == "kohinoor/sites/thumbnails/orgK"
    monkeypatch.setattr(mt, "MULTI_TENANT_ENABLED", False)
    f = UploadFile(file=BytesIO(_PNG), filename="a.png", headers=Headers({"content-type": "image/png"}))
    await uploads.upload_image(file=f, folder="thumbnails", current_user=SimpleNamespace(id="u"))
    assert seen["folder"] == "SiteVision/thumbnails"


@pytest.mark.parametrize("tenant,url,ok", [
    (MY, "/media/SiteVision/captures/o/i/a.jpg?exp=1&sig=2", True),
    (MY, "/media/myhome/sites/captures/o/i/a.jpg", True),
    (MY, "/media/kohinoor/sites/captures/o/i/a.jpg", False),
    (KO, "/media/SiteVision/captures/o/i/a.jpg", False),
    (KO, "/media/kohinoor/sites/captures/o/i/a.jpg", True),
    (KO, "/media/myhome/sites/captures/o/i/a.jpg", False),
])
def test_local_image_fetch_respects_tenant(mt, tenant, url, ok):
    from app.services.image_fetch import _try_local_media_path

    with tenancy.use_tenant(tenant):
        if ok:
            assert _try_local_media_path(url, settings=get_settings()) is not None
        else:
            with pytest.raises(ValueError):
                _try_local_media_path(url, settings=get_settings())


def test_local_image_fetch_fails_closed_without_tenant(mt):
    from app.services.image_fetch import _try_local_media_path

    with pytest.raises(ValueError):
        _try_local_media_path("/media/SiteVision/captures/o/i/a.jpg", settings=get_settings())


# ── Password-reset links point at the user's own tenant ───────────────────────

@pytest.mark.asyncio
async def test_reset_link_uses_the_tenants_own_site(mt, monkeypatch):
    from app.utils import email as email_mod

    monkeypatch.setattr(email_mod.settings, "DEBUG", True)
    monkeypatch.setattr(mt, "TENANT_MYHOME_FRONTEND_URL", "https://portal.myhomeconstructions.com/")
    logged = []
    monkeypatch.setattr(email_mod.logger, "info", lambda m, *a, **k: logged.append(m))
    with tenancy.use_tenant(KO):
        await email_mod.send_password_reset_email("a@kohinoorpune.com", "A", "tok1")
    with tenancy.use_tenant(MY):
        await email_mod.send_password_reset_email("a@myhomeconstructions.com", "A", "tok2")
    assert "https://kohinoorpune.com/reset-password?token=tok1" in logged[0]
    assert "https://portal.myhomeconstructions.com/reset-password?token=tok2" in logged[1]
    with pytest.raises(tenancy.TenantResolutionError):
        await email_mod.send_password_reset_email("x@y.z", "A", "tok3")   # no tenant: fail closed


def test_frontend_url_unchanged_when_single_tenant(monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    assert tenancy.frontend_base_url() == get_settings().FRONTEND_URL


# ── A process holding an OLDER Settings class (no tenant fields) must stay single-tenant ──

def test_stale_settings_without_tenant_fields_behave_as_single_tenant(monkeypatch):
    """Regression: refresh/logout/upload returned 500 'Settings has no attribute MULTI_TENANT_ENABLED'
    when a running backend lazily imported updated modules against its older Settings object."""
    from app.core import token_store as ts

    stale = SimpleNamespace(FRONTEND_URL="http://localhost:5177", is_production=False)   # no MULTI_TENANT_* fields
    monkeypatch.setattr(tenancy, "get_settings", lambda: stale)
    assert tenancy.multi_tenant_enabled() is False
    assert tenancy.namespace() == "" and tenancy.derive_key("s", "access") == "s"
    assert tenancy.media_path_allowed("SiteVision/captures/o/i/a.jpg") is True
    assert tenancy.asset_owned("SiteVision/captures/o/i/a.jpg", "o") is True
    assert tenancy.storage_root_segments() == ["SiteVision"] and tenancy.frontend_base_url() == "http://localhost:5177"
    assert tenancy.email_allowed_for_current_tenant("anyone@anywhere.example") is True
    # the exact call that failed in the traceback
    ts.token_store.revoke("jti-stale-check")
    assert ts.token_store.is_revoked("jti-stale-check") is True


# ── Explicit per-tenant local-development hosts (no default tenant needed) ───

@pytest.mark.parametrize("host,slug", [("kohinoor.localhost", "kohinoor"), ("myhome.localhost:5181", "myhome"), ("KOHINOOR.localhost", "kohinoor")])
def test_dev_tenant_hosts_resolve_outside_production(mt, host, slug):
    assert tenancy.resolve_tenant(host).slug == slug


@pytest.mark.parametrize("host", ["evil.localhost", "kohinoor.localhost.evil.com", "x.kohinoor.localhost", "localhost"])
def test_dev_tenant_hosts_do_not_leak_to_lookalikes_or_the_bare_host(mt, host):
    assert tenancy.resolve_tenant(host) is None


def test_dev_tenant_hosts_are_never_mapped_in_production(mt, monkeypatch):
    monkeypatch.setattr(type(mt), "is_production", property(lambda self: True))
    assert tenancy.resolve_tenant("kohinoor.localhost") is None and tenancy.resolve_tenant("myhome.localhost") is None
