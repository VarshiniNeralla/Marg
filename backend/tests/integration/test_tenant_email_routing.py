"""E-mail based tenant routing: the e-mail domain picks the tenant at login, the signed token carries it afterwards.

No dependency overrides: the REAL tenant database selection runs against two mock databases on one mock cluster,
and every request goes to the SAME host, so the Host header demonstrably plays no part."""
import mongomock_motor
import pytest
import pytest_asyncio
from bson import ObjectId
from httpx import ASGITransport, AsyncClient

from app.core import tenancy
from app.core.config import get_settings
from app.core.security import hash_password
from tests.integration.test_tenant_auth import ACCOUNTS, PW, _seed

HOST = "api.example.test"            # one URL for every tenant
MY, KO = "myhome", "kohinoor"
MARK = {MY: "EMAIL-MODE-MYHOME-MARKER", KO: "EMAIL-MODE-KOHINOOR-MARKER"}
ADMIN = {MY: "admin@myhomeconstructions.com", KO: "admin@kohinoorpune.com"}


@pytest_asyncio.fixture
async def er(monkeypatch, tmp_path):
    from app.db import mongodb
    from app.main import create_app
    from app.services import local_media_service as lms

    monkeypatch.setattr(lms, "upload_root", lambda: tmp_path)       # before create_app: the /media route captures it

    s = get_settings()
    for k, v in {"MULTI_TENANT_ENABLED": True, "TENANT_RESOLUTION": "email", "TENANT_ALLOW_SELF_REGISTRATION": False,
                 "TENANT_DEV_DEFAULT": "", "DEBUG": True}.items():
        monkeypatch.setattr(s, k, v)
    client = mongomock_motor.AsyncMongoMockClient()
    monkeypatch.setattr(mongodb, "_tenant_clients", {MY: client, KO: client})
    dbs = {MY: client["SiteVisionMyHome"], KO: client["SiteVisionKohinoor"]}
    org = {MY: await _seed(dbs[MY], MY, extra_users=[("stray@kohinoorpune.com", "user")]), KO: await _seed(dbs[KO], KO)}
    for slug in (MY, KO):
        await dbs[slug].projects.insert_one({"_id": f"proj-{slug}", "id": f"proj-{slug}", "orgId": str(org[slug]), "name": MARK[slug]})
    app = create_app()
    if getattr(app.state, "limiter", None) is not None:
        app.state.limiter.enabled = False

    class Env:
        pass

    e = Env()
    e.app, e.dbs, e.org, e.upload_root = app, dbs, org, tmp_path

    async def call(method, path, token=None, host=HOST, **kw):
        hdr = {"Authorization": f"Bearer {token}"} if token else {}
        async with AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}") as c:
            return await getattr(c, method)(path, headers=hdr, **kw)

    async def login(email, password=PW, host=HOST):
        return await call("post", "/api/v1/auth/login", host=host, json={"email": email, "password": password})

    e.call, e.login = call, login
    return e


# ── Login: the e-mail domain decides the database ─────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", [MY, KO])
async def test_each_email_domain_logs_in_against_its_own_tenant_through_the_same_url(er, slug):
    r = await er.login(ADMIN[slug])
    assert r.status_code == 200
    user = r.json()["data"]["user"]
    assert user["org_slug"] == slug and user["org_id"] == str(er.org[slug])
    with tenancy.use_tenant(tenancy.tenant_by_slug(slug)):
        from app.core.security import decode_access_token
        assert decode_access_token(r.json()["data"]["access_token"])["tid"] == slug


@pytest.mark.asyncio
async def test_roles_come_from_the_selected_tenants_database(er):
    for email, role in ACCOUNTS[KO]:
        assert (await er.login(email)).json()["data"]["user"]["role"] == role
    for email, role in ACCOUNTS[MY]:
        assert (await er.login(email)).json()["data"]["user"]["role"] == role


@pytest.mark.asyncio
async def test_the_host_header_plays_no_part(er):
    for host in ("evil.example", "localhost:8010", "kohinoorpune.com", "myhomeconstructions.com"):
        r = await er.login(ADMIN[KO], host=host)
        assert r.status_code == 200 and r.json()["data"]["user"]["org_slug"] == KO       # even on the OTHER tenant's domain


@pytest.mark.asyncio
@pytest.mark.parametrize("email", ["a@evil.com", "a@kohinoorpune.com.evil.com", "a@sub.kohinoorpune.com", "admin@myhomeconstructions.org", "no-at-sign"])
async def test_unknown_email_domains_are_rejected_like_a_wrong_password(er, email):
    r = await er.login(email)
    assert r.status_code in (401, 422)
    if r.status_code == 401:
        assert r.json() == (await er.login("nobody@myhomeconstructions.com")).json()   # indistinguishable from an unknown user


@pytest.mark.asyncio
async def test_a_password_from_the_other_tenant_is_not_accepted_and_users_never_cross(er):
    await er.dbs[KO].users.update_one({"email": ADMIN[KO]}, {"$set": {"password_hash": hash_password("Kohinoor!Only1")}})
    assert (await er.login(ADMIN[KO], PW)).status_code == 401                 # My Home-era password does not work
    assert (await er.login(ADMIN[KO], "Kohinoor!Only1")).status_code == 200
    # an account that exists ONLY in the other tenant's database is invisible: stray@kohinoorpune.com sits in the My Home DB
    assert (await er.login("stray@kohinoorpune.com")).status_code == 401      # Kohinoor domain -> Kohinoor DB -> not there


# ── Tokens carry the tenant; nothing else can select it ───────────────────────

@pytest.mark.asyncio
async def test_me_and_data_follow_the_tokens_tenant_and_stay_separate(er):
    for slug, other in ((MY, KO), (KO, MY)):
        tok = (await er.login(ADMIN[slug])).json()["data"]["access_token"]
        me = await er.call("get", "/api/v1/auth/me", tok)
        assert me.status_code == 200 and me.json()["data"]["org_slug"] == slug
        snap = (await er.call("get", "/api/v1/workflow/snapshot", tok)).text
        assert MARK[slug] in snap and MARK[other] not in snap
        # guessed id of the other tenant's project: not found, nothing changes
        before = await er.dbs[other].projects.find_one({"_id": f"proj-{other}"})
        assert (await er.call("get", f"/api/v1/projects/proj-{other}", tok)).status_code == 404
        await er.call("delete", f"/api/v1/projects/proj-{other}", tok)
        assert await er.dbs[other].projects.find_one({"_id": f"proj-{other}"}) == before


@pytest.mark.asyncio
async def test_forged_wrong_or_missing_tenant_credentials_get_401_never_data_or_500(er):
    from jose import jwt as jose_jwt

    my_tok = (await er.login(ADMIN[MY])).json()["data"]["access_token"]
    claims = jose_jwt.get_unverified_claims(my_tok)
    secret = get_settings().JWT_SECRET
    with tenancy.use_tenant(tenancy.tenant_by_slug(MY)):
        my_key = tenancy.derive_key(secret, "access")
    forged = {
        "claims tid=kohinoor, signed with the My Home key": jose_jwt.encode({**claims, "tid": KO}, my_key, algorithm="HS256"),
        "claims tid=kohinoor, signed with the plain secret": jose_jwt.encode({**claims, "tid": KO}, secret, algorithm="HS256"),
        "unknown tenant claim": jose_jwt.encode({**claims, "tid": "evil"}, secret, algorithm="HS256"),
        "no tenant claim": jose_jwt.encode({k: v for k, v in claims.items() if k != "tid"}, secret, algorithm="HS256"),
        "garbage": "not.a.jwt",
    }
    for label, tok in forged.items():
        for path in ("/api/v1/auth/me", "/api/v1/workflow/snapshot", f"/api/v1/projects/proj-{KO}"):
            assert (await er.call("get", path, tok)).status_code == 401, (label, path)
    for path in ("/api/v1/auth/me", "/api/v1/workflow/snapshot"):
        assert (await er.call("get", path)).status_code == 401, path             # no token at all


@pytest.mark.asyncio
async def test_tenant_handshake_endpoint_reports_email_routing(er):
    assert (await er.call("get", "/api/v1/tenant", host="anything.example")).json() == {"multiTenant": True, "routing": "email", "tenant": None}


# ── Sessions: refresh, logout, revocation ─────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("slug", [MY, KO])
async def test_refresh_and_logout_follow_the_refresh_cookies_tenant(er, slug):
    async with AsyncClient(transport=ASGITransport(app=er.app), base_url=f"http://{HOST}") as c:
        r = await c.post("/api/v1/auth/login", json={"email": ADMIN[slug], "password": PW})
        cookie = r.cookies.get("refresh_token")
        r2 = await c.post("/api/v1/auth/refresh", cookies={"refresh_token": cookie})
        assert r2.status_code == 200
        new_access, new_cookie = r2.json()["data"]["access_token"], r2.cookies.get("refresh_token")
        assert (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_access}"})).json()["data"]["org_slug"] == slug
        assert (await c.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {new_access}"}, cookies={"refresh_token": new_cookie})).status_code in (200, 204)
        assert (await c.post("/api/v1/auth/refresh", cookies={"refresh_token": new_cookie})).status_code == 401


# ── Registration and password reset ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_registration_is_admin_only_and_domain_bound(er):
    new = {"name": "New Person", "email": "new.person@kohinoorpune.com", "password": PW, "org_slug": "kohinoor"}
    assert (await er.call("post", "/api/v1/auth/register", json=new)).status_code == 403                      # anonymous: closed
    assert (await er.call("post", "/api/v1/auth/register", json={**new, "email": "x@evil.com"})).status_code == 422
    ko_admin = (await er.login(ADMIN[KO])).json()["data"]["access_token"]
    assert (await er.call("post", "/api/v1/auth/register", ko_admin, json={**new, "role": "field_engineer"})).status_code == 201
    assert await er.dbs[KO].users.count_documents({"email": new["email"]}) == 1
    assert await er.dbs[MY].users.count_documents({"email": new["email"]}) == 0
    # a My Home admin cannot create a Kohinoor-domain user: the e-mail selects Kohinoor, the My Home token fails there
    my_admin = (await er.login(ADMIN[MY])).json()["data"]["access_token"]
    r = await er.call("post", "/api/v1/auth/register", my_admin, json={**new, "email": "other@kohinoorpune.com"})
    assert r.status_code in (401, 403) and await er.dbs[KO].users.count_documents({"email": "other@kohinoorpune.com"}) == 0


@pytest.mark.asyncio
async def test_password_reset_finds_its_tenant_and_ignores_unknown_domains(er, monkeypatch):
    from app.services import auth_service

    sent = []

    async def fake_send(to_email, to_name, raw_token):
        sent.append((to_email, raw_token))

    monkeypatch.setattr(auth_service, "send_password_reset_email", fake_send)
    assert (await er.call("post", "/api/v1/auth/forgot-password", json={"email": "fe@kohinoorpune.com"})).status_code == 200
    assert (await er.call("post", "/api/v1/auth/forgot-password", json={"email": "someone@evil.com"})).status_code == 200   # generic
    assert [e for e, _ in sent] == ["fe@kohinoorpune.com"]
    emailed = sent[0][1]
    assert emailed.startswith("kohinoor.")                                    # the link names the tenant database to use
    new = "N3w!StrongPassw0rd"
    assert (await er.call("post", "/api/v1/auth/reset-password", json={"token": "myhome." + emailed.split(".", 1)[1], "new_password": new})).status_code >= 400
    assert (await er.call("post", "/api/v1/auth/reset-password", json={"token": emailed.split(".", 1)[1], "new_password": new})).status_code >= 400   # no prefix
    assert (await er.login("fe@kohinoorpune.com")).status_code == 200                                              # unchanged so far
    assert (await er.call("post", "/api/v1/auth/reset-password", json={"token": emailed, "new_password": new})).status_code == 200
    assert (await er.login("fe@kohinoorpune.com", new)).status_code == 200


# ── Files: tenant comes from the token or the signed path ─────────────────────

@pytest.mark.asyncio
async def test_media_is_served_only_inside_the_callers_tenant(er):
    from app.services.media_access import sign_media_path

    root = er.upload_root
    org = {slug: str(er.org[slug]) for slug in (MY, KO)}
    for slug in (MY, KO):                                      # new-style tenant keys: <slug>/sites/<kind>/<org>/...
        d = root / slug / "sites" / "captures" / org[slug] / "i"
        d.mkdir(parents=True)
        (d / "a.jpg").write_bytes(slug.encode())
    legacy = root / "SiteVision" / "captures" / org[MY] / "i"  # legacy keys belong to My Home only
    legacy.mkdir(parents=True)
    (legacy / "legacy.jpg").write_bytes(b"legacy")
    ko_tok = (await er.login(ADMIN[KO])).json()["data"]["access_token"]
    my_tok = (await er.login(ADMIN[MY])).json()["data"]["access_token"]
    own = f"/media/{KO}/sites/captures/{org[KO]}/i/a.jpg"
    other = f"/media/{MY}/sites/captures/{org[MY]}/i/a.jpg"
    # signed URL: the tenant is read from the path and the signature must verify under THAT tenant's key
    with tenancy.use_tenant(tenancy.tenant_by_slug(KO)):
        signed_own = sign_media_path(own)
    assert (await er.call("get", signed_own)).status_code == 200
    forged = signed_own.replace(f"{KO}/sites", f"{MY}/sites").replace(org[KO], org[MY])   # same signature, other tenant's path
    assert (await er.call("get", forged)).status_code == 401
    # token: the tenant comes from the token; other tenants' paths and legacy files are 404
    assert (await er.call("get", own, ko_tok)).status_code == 200
    assert (await er.call("get", other, ko_tok)).status_code == 404
    assert (await er.call("get", f"/media/SiteVision/captures/{org[MY]}/i/legacy.jpg", ko_tok)).status_code == 404
    assert (await er.call("get", other, my_tok)).status_code == 200
    assert (await er.call("get", f"/media/SiteVision/captures/{org[MY]}/i/legacy.jpg", my_tok)).status_code == 200
    assert (await er.call("get", other)).status_code == 401                    # no credential at all
