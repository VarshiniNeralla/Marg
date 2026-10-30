"""Strict My Home <-> Kohinoor isolation, tested in BOTH directions with separate marker data."""
import json

import pytest
import pytest_asyncio
from bson import ObjectId

from app.core import tenancy
from app.core.config import get_settings
from tests.integration.test_tenant_auth import KO_HOST, MY_HOST, PW, env  # noqa: F401  (fixture)

MY, KO = tenancy.tenant_by_slug("myhome"), tenancy.tenant_by_slug("kohinoor")
MY_MARK, KO_MARK = "MYHOME-ONLY-MARKER-7731", "KOHINOOR-ONLY-MARKER-4482"
ADMIN = {"myhome": "admin@myhomeconstructions.com", "kohinoor": "admin@kohinoorpune.com"}
HOST = {"myhome": MY_HOST, "kohinoor": KO_HOST}
OTHER = {"myhome": "kohinoor", "kohinoor": "myhome"}


async def _token(env, slug, email=None):
    r = await env.login(HOST[slug], email or ADMIN[slug])
    return r.json()["data"]["access_token"]


async def _org_id(env, slug):
    return str((await env.dbs[slug].organizations.find_one({}))["_id"])


async def _req(env, host, method, path, token=None, **kw):
    hdr = {"Authorization": f"Bearer {token}"} if token else {}
    async with env.http(host) as c:
        return await getattr(c, method)(path, headers=hdr, **kw)


@pytest_asyncio.fixture
async def data(env):
    """One project per tenant, in each tenant's own database, with its own marker."""
    ids = {}
    for slug, mark in (("myhome", MY_MARK), ("kohinoor", KO_MARK)):
        org = await _org_id(env, slug)
        pid = str(ObjectId())
        await env.dbs[slug].projects.insert_one({"_id": pid, "id": pid, "orgId": org, "name": f"{mark} project", "status": "active"})
        await env.dbs[slug].towers.insert_one({"_id": f"t-{slug}", "id": f"t-{slug}", "orgId": org, "projectId": pid, "name": f"{mark} tower"})
        ids[slug] = pid
    return ids


# ── Positive: each tenant manages its own data ────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_each_tenant_reads_lists_and_manages_only_its_own_projects(env, data, slug):
    tok = await _token(env, slug)
    r = await _req(env, HOST[slug], "get", "/api/v1/projects", tok)
    assert r.status_code == 200 and data[slug] in r.text
    r = await _req(env, HOST[slug], "get", f"/api/v1/projects/{data[slug]}", tok)
    assert r.status_code == 200
    new = str(ObjectId())
    r = await _req(env, HOST[slug], "post", "/api/v1/projects", tok, json={"id": new, "name": f"{slug} created"})
    assert r.status_code == 201
    assert await env.dbs[slug].projects.count_documents({"_id": new}) == 1
    assert await env.dbs[OTHER[slug]].projects.count_documents({"_id": new}) == 0       # never in the other database
    r = await _req(env, HOST[slug], "delete", f"/api/v1/projects/{new}", tok)
    assert r.status_code in (200, 204) and await env.dbs[slug].projects.count_documents({"_id": new}) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_snapshot_dashboard_data_contains_only_the_tenants_own_records(env, data, slug):
    tok = await _token(env, slug)
    r = await _req(env, HOST[slug], "get", "/api/v1/workflow/snapshot", tok)
    assert r.status_code == 200
    body = r.text
    own, foreign = (MY_MARK, KO_MARK) if slug == "myhome" else (KO_MARK, MY_MARK)
    assert own in body and foreign not in body and data[OTHER[slug]] not in body


# ── Negative, both directions: guessed ids and manipulated requests ───────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_guessed_foreign_ids_are_invisible_and_untouchable(env, data, slug):
    other = OTHER[slug]
    tok = await _token(env, slug)
    foreign = data[other]
    before = await env.dbs[other].projects.find_one({"_id": foreign})
    assert (await _req(env, HOST[slug], "get", f"/api/v1/projects/{foreign}", tok)).status_code == 404
    r = await _req(env, HOST[slug], "put", f"/api/v1/projects/{foreign}", tok, json={"id": foreign, "name": "hijacked"})
    assert r.status_code in (200, 404)           # an upsert in OWN database at most; never the other tenant's record
    assert await env.dbs[other].projects.find_one({"_id": foreign}) == before
    assert (await _req(env, HOST[slug], "delete", f"/api/v1/projects/{foreign}", tok)).status_code in (200, 204, 404)
    assert await env.dbs[other].projects.find_one({"_id": foreign}) == before
    assert await env.dbs[other].towers.count_documents({}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_token_from_one_tenant_is_useless_on_the_other_and_changes_nothing(env, data, slug):
    other = OTHER[slug]
    tok = await _token(env, slug)
    snap = {c: await env.dbs[other][c].count_documents({}) for c in ("projects", "towers", "users", "audit_logs")}
    for method, path, kw in (("get", "/api/v1/projects", {}), ("get", f"/api/v1/projects/{data[other]}", {}),
                             ("get", "/api/v1/workflow/snapshot", {}), ("get", "/api/v1/auth/me", {}),
                             ("post", "/api/v1/projects", {"json": {"id": "x1", "name": "injected"}}),
                             ("delete", f"/api/v1/projects/{data[other]}", {})):
        r = await _req(env, HOST[other], method, path, tok, **kw)
        assert r.status_code == 401, (slug, method, path)
    assert snap == {c: await env.dbs[other][c].count_documents({}) for c in snap}


@pytest.mark.asyncio
async def test_identical_ids_in_both_databases_never_collide(env):
    shared = "6a3a28dd0915399ba5cb6922-collision"
    for slug, mark in (("myhome", MY_MARK), ("kohinoor", KO_MARK)):
        org = await _org_id(env, slug)
        await env.dbs[slug].projects.insert_one({"_id": shared, "id": shared, "orgId": org, "name": mark})
    for slug in ("myhome", "kohinoor"):
        r = await _req(env, HOST[slug], "get", f"/api/v1/projects/{shared}", await _token(env, slug))
        assert r.status_code == 200 and (MY_MARK if slug == "myhome" else KO_MARK) in r.text
        assert (KO_MARK if slug == "myhome" else MY_MARK) not in r.text
    await _req(env, KO_HOST, "put", f"/api/v1/projects/{shared}", await _token(env, "kohinoor"), json={"id": shared, "name": "renamed in kohinoor"})
    assert (await env.dbs["myhome"].projects.find_one({"_id": shared}))["name"] == MY_MARK


# ── Admin operations stay inside the tenant ───────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_admin_cannot_manage_the_other_tenants_users(env, slug):
    other = OTHER[slug]
    target = await env.dbs[other].users.find_one({"role": "field_engineer"})
    before = target["password_hash"]
    tok = await _token(env, slug)
    r = await _req(env, HOST[slug], "put", f"/api/v1/users/{target['_id']}/password", tok, json={"new_password": "An0ther!StrongPass1"})
    assert r.status_code == 404                                                     # not a user of THIS tenant
    assert (await env.dbs[other].users.find_one({"_id": target["_id"]}))["password_hash"] == before
    assert (await env.login(HOST[other], target["email"])).status_code == 200      # their login still works
    # cannot provision users of the other tenant, nor target the other tenant's organization
    me = await _req(env, HOST[slug], "get", "/api/v1/auth/me", tok)
    assert me.status_code == 200 and me.json()["data"]["org_slug"] == slug
    payload = {"name": "Intruder", "password": PW, "org_slug": OTHER[slug]}
    r = await _req(env, HOST[slug], "post", "/api/v1/auth/register", tok, json={**payload, "email": f"x@{tenancy.tenant_by_slug(other).domain}"})
    assert r.status_code in (404, 422)
    assert await env.dbs[other].users.count_documents({"email": f"x@{tenancy.tenant_by_slug(other).domain}"}) == 0


@pytest.mark.asyncio
async def test_actions_are_audited_in_their_own_database_only(env, data):
    ko = await _token(env, "kohinoor")
    await _req(env, KO_HOST, "post", "/api/v1/projects", ko, json={"id": "audit-ko", "name": "audit probe"})
    my_logs = json.dumps([d async for d in env.dbs["myhome"].audit_logs.find({}, {"_id": 0})], default=str)
    ko_logs = json.dumps([d async for d in env.dbs["kohinoor"].audit_logs.find({}, {"_id": 0})], default=str)
    assert "kohinoorpune.com" not in my_logs and "myhomeconstructions.com" not in ko_logs
    assert await env.dbs["kohinoor"].audit_logs.count_documents({}) >= 1


# ── Password reset cannot cross tenants ───────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_token_only_works_on_the_tenant_that_issued_it(env, monkeypatch):
    from app.services import auth_service

    tokens = []

    async def fake_send(to_email, to_name, raw_token):
        tokens.append((to_email, raw_token))

    monkeypatch.setattr(auth_service, "send_password_reset_email", fake_send)
    await _req(env, KO_HOST, "post", "/api/v1/auth/forgot-password", json={"email": "fe@kohinoorpune.com"})
    assert [e for e, _ in tokens] == ["fe@kohinoorpune.com"]
    raw = tokens[0][1]
    new = "N3w!StrongPassw0rd"
    bad = await _req(env, MY_HOST, "post", "/api/v1/auth/reset-password", json={"token": raw, "new_password": new})
    assert bad.status_code >= 400
    assert (await env.login(KO_HOST, "fe@kohinoorpune.com")).status_code == 200      # password unchanged
    ok = await _req(env, KO_HOST, "post", "/api/v1/auth/reset-password", json={"token": raw, "new_password": new})
    assert ok.status_code == 200 and (await env.login(KO_HOST, "fe@kohinoorpune.com", new)).status_code == 200


# ── CORS and caching ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cors_allows_only_the_tenants_own_origins(env, monkeypatch):
    monkeypatch.setattr(get_settings(), "APP_ENV", "production")
    monkeypatch.setattr(type(get_settings()), "is_development", property(lambda self: False))
    monkeypatch.setattr(get_settings(), "CORS_ORIGINS", "https://myhomeconstructions.com,https://kohinoorpune.com")

    from app.main import create_app

    app = create_app()                                    # built AFTER the settings above (own app, own client)
    hdr = lambda o: {"Origin": o, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"}

    from httpx import ASGITransport, AsyncClient

    async def preflight(host, origin):
        async with AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}") as c:
            return await c.options("/api/v1/projects", headers=hdr(origin))

    assert (await preflight(MY_HOST, "https://myhomeconstructions.com")).status_code == 200
    assert (await preflight(KO_HOST, "https://kohinoorpune.com")).status_code == 200
    assert (await preflight(MY_HOST, "https://kohinoorpune.com")).status_code == 400      # other tenant's SPA origin
    assert (await preflight(KO_HOST, "https://myhomeconstructions.com")).status_code == 400
    assert (await preflight(KO_HOST, "https://evil.example")).status_code == 400
    assert (await preflight("evil.example", "https://kohinoorpune.com")).status_code == 421


@pytest.mark.asyncio
async def test_api_responses_are_not_cacheable_across_tenants(env, data):
    r = await _req(env, KO_HOST, "get", "/api/v1/projects", await _token(env, "kohinoor"))
    assert r.headers.get("cache-control") == "no-store" and "host" in r.headers.get("vary", "").lower()


# ── Files: deletion, AI fetch, review log, spool ──────────────────────────────

@pytest.fixture
def destroyed(monkeypatch):
    from app.services import cloudinary_service as cs

    calls = []
    monkeypatch.setattr(cs, "configure_cloudinary", lambda: None)
    monkeypatch.setattr(cs.cloudinary.uploader, "destroy", lambda pid, resource_type="image": calls.append(pid) or {"result": "ok"})
    return calls


@pytest.mark.asyncio
@pytest.mark.parametrize("tenant,asset,org,should_delete", [
    (KO, "kohinoor/sites/captures/orgK/e1/a", "orgK", True),
    (KO, "kohinoor/sites/captures/ORG-OTHER/e1/a", "orgK", False),   # another organization's file
    (KO, "myhome/sites/captures/orgM/e1/a", "orgK", False),          # the other tenant's new-style file
    (KO, "SiteVision/captures/orgM/e1/a", "orgK", False),              # the other tenant's legacy file
    (MY, "SiteVision/captures/orgM/e1/a", "orgM", True),
    (MY, "kohinoor/sites/captures/orgK/e1/a", "orgM", False),
    (MY, "SiteVision/captures/orgK/e1/a", "orgM", False),
])
async def test_cloudinary_destroy_is_limited_to_the_callers_own_assets(env, destroyed, tenant, asset, org, should_delete):
    from app.services.cloudinary_service import delete_media_assets

    with tenancy.use_tenant(tenant):
        await delete_media_assets([{"public_id": asset, "resource_type": "image"}], org_id=org)
    assert (destroyed == [asset]) is should_delete and (destroyed == []) is (not should_delete)


@pytest.mark.asyncio
async def test_deleting_a_capture_with_an_injected_foreign_asset_destroys_nothing(env, destroyed):
    org = await _org_id(env, "kohinoor")
    foreign = "SiteVision/captures/6a3a28dd0915399ba5cb6922/e1/stolen"
    await env.dbs["kohinoor"].captures.insert_one({"_id": "cap-1", "id": "cap-1", "orgId": org,
                                                   "mediaAssets": [{"public_id": foreign, "resource_type": "image"}]})
    r = await _req(env, KO_HOST, "delete", "/api/v1/captures/cap-1", await _token(env, "kohinoor"))
    assert r.status_code in (200, 204)
    assert await env.dbs["kohinoor"].captures.count_documents({"_id": "cap-1"}) == 0
    assert destroyed == []                                              # the My Home file was NOT destroyed


@pytest.mark.parametrize("tenant,path,ok", [
    (KO, "/demo/image/upload/v1/kohinoor/sites/floorplans/orgK/a.jpg", True),
    (KO, "/demo/image/upload/v1/SiteVision/floorplans/orgM/a.jpg", False),
    (KO, "/demo/image/upload/v1/myhome/sites/floorplans/orgM/a.jpg", False),
    (MY, "/demo/image/upload/v1/SiteVision/floorplans/orgM/a.jpg", True),
    (MY, "/demo/image/upload/v1/kohinoor/sites/floorplans/orgK/a.jpg", False),
])
def test_ai_analysis_fetches_only_the_tenants_own_cloudinary_assets(env, tenant, path, ok):
    from app.services.image_fetch import validate_image_url

    url = "https://res.cloudinary.com" + path
    with tenancy.use_tenant(tenant):
        if ok:
            assert validate_image_url(url) == url
        else:
            with pytest.raises(ValueError):
                validate_image_url(url)


def test_manual_review_log_is_separate_per_tenant(env, tmp_path, monkeypatch):
    from app.services import construction_progress_review_service as svc
    from app.services import local_media_service as lms

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)
    with tenancy.use_tenant(MY):
        p_my = svc.append_manual_review_json({"_id": "r1", "note": MY_MARK})
    with tenancy.use_tenant(KO):
        p_ko = svc.append_manual_review_json({"_id": "r2", "note": KO_MARK})
    assert p_my != p_ko and "_work" in p_my.parts and "_work" in p_ko.parts
    assert MY_MARK in p_my.read_text(encoding="utf-8") and KO_MARK not in p_my.read_text(encoding="utf-8")
    assert KO_MARK in p_ko.read_text(encoding="utf-8") and MY_MARK not in p_ko.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_each_tenant_connects_with_its_own_credential_only(monkeypatch):
    """Per-tenant Mongo credentials: the legacy shared MONGO_URI is never used when multi-tenant."""
    from app.db import mongodb

    s = get_settings()
    monkeypatch.setattr(s, "MULTI_TENANT_ENABLED", True)
    monkeypatch.setattr(s, "TENANT_MYHOME_MONGO_URI", "mongodb://myhome-user:x@host-a/SiteVisionMyHome")
    monkeypatch.setattr(s, "TENANT_KOHINOOR_MONGO_URI", "mongodb://kohinoor-user:y@host-a/SiteVisionKohinoor")
    monkeypatch.setattr(mongodb, "_tenant_clients", {})
    used = []

    class FakeAdmin:
        async def command(self, *_a, **_k):
            return {"ok": 1}

    class FakeClient:
        def __init__(self, uri, **_k):
            used.append(uri)
            self.admin = FakeAdmin()

        def __getitem__(self, name):
            return ("db", name, self)

        def close(self):
            pass

    monkeypatch.setattr(mongodb, "AsyncIOMotorClient", FakeClient)
    await mongodb.connect_db(retries=1, base_delay=0)
    assert sorted(used) == sorted([s.TENANT_MYHOME_MONGO_URI, s.TENANT_KOHINOOR_MONGO_URI])
    assert s.MONGO_URI not in used and mongodb._mongo.client is None          # legacy handle untouched
    with tenancy.use_tenant(MY):
        assert mongodb.get_database()[1] == "SiteVisionMyHome" and mongodb.get_database()[2].__class__ is FakeClient
    clients = {slug: c for slug, c in mongodb._tenant_clients.items()}
    assert clients["myhome"] is not clients["kohinoor"]
    with tenancy.use_tenant(KO):
        assert mongodb.get_database()[1] == "SiteVisionKohinoor"
        assert mongodb.get_database()[2] is clients["kohinoor"]


@pytest.mark.asyncio
async def test_unknown_missing_or_mismatched_tenant_fails_closed(env):
    for host in ("evil.example", "localhost", "127.0.0.1", "myhomeconstructions.com.evil.com"):
        assert (await _req(env, host, "get", "/api/v1/projects")).status_code == 421
        assert (await env.login(host, "admin@kohinoorpune.com")).status_code == 421
    assert (await env.login(MY_HOST, "admin@kohinoorpune.com")).status_code == 401
    assert (await env.login(KO_HOST, "admin@myhomeconstructions.com")).status_code == 401


@pytest.mark.asyncio
async def test_positive_control_capture_delete_does_destroy_the_tenants_own_asset(env, destroyed):
    """Proves the negative test above is not vacuous: the same flow destroys an asset the tenant owns."""
    org = await _org_id(env, "kohinoor")
    own = f"kohinoor/sites/captures/{org}/e1/own"
    await env.dbs["kohinoor"].captures.insert_one({"_id": "cap-2", "id": "cap-2", "orgId": org,
                                                   "mediaAssets": [{"public_id": own, "resource_type": "image"}]})
    r = await _req(env, KO_HOST, "delete", "/api/v1/captures/cap-2", await _token(env, "kohinoor"))
    assert r.status_code in (200, 204) and destroyed == [own]


# ── Session lifecycle inside a tenant: refresh, logout, revocation ────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["myhome", "kohinoor"])
async def test_refresh_logout_and_revocation_work_inside_each_tenant(env, slug):
    from app.core.security import decode_access_token

    host = HOST[slug]
    async with env.http(host) as c:
        r = await c.post("/api/v1/auth/login", json={"email": ADMIN[slug], "password": PW})
        assert r.status_code == 200
        access, cookie = r.json()["data"]["access_token"], r.cookies.get("refresh_token")
        assert cookie
        r2 = await c.post("/api/v1/auth/refresh", cookies={"refresh_token": cookie})
        assert r2.status_code == 200
        new_access, new_cookie = r2.json()["data"]["access_token"], r2.cookies.get("refresh_token")
        assert new_access and new_cookie and new_cookie != cookie
        with tenancy.use_tenant(tenancy.tenant_by_slug(slug)):
            assert decode_access_token(new_access)["tid"] == slug                      # still bound to this tenant
        assert (await c.post("/api/v1/auth/refresh", cookies={"refresh_token": cookie})).status_code == 401   # rotation: old one dead
        out = await c.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {new_access}"}, cookies={"refresh_token": new_cookie})
        assert out.status_code in (200, 204)
        assert (await c.post("/api/v1/auth/refresh", cookies={"refresh_token": new_cookie})).status_code == 401   # revoked by logout
