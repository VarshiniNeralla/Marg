"""End-to-end: two independent tenant databases behind the real application."""
from datetime import datetime, timezone

import mongomock_motor
import pytest
import pytest_asyncio
from bson import ObjectId
from httpx import ASGITransport, AsyncClient

from app.core import tenancy
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.dependencies import get_auth_db
from app.db.mongodb import get_db, get_db_or_none
from app.models.organization import OrgSettings

PW = "Str0ng!Passw0rd1"
MY_HOST, KO_HOST = "myhomeconstructions.com", "kohinoorpune.com"

ACCOUNTS = {
    "myhome": [("admin@myhomeconstructions.com", "admin"), ("mgr@myhomeconstructions.com", "manager"),
               ("fe@myhomeconstructions.com", "field_engineer")],
    "kohinoor": [("admin@kohinoorpune.com", "admin"), ("mgr@kohinoorpune.com", "manager"),
                 ("fe@kohinoorpune.com", "field_engineer")],
}


async def _seed(db, slug, extra_users=()):
    org_id = ObjectId()
    now = datetime.now(timezone.utc)
    await db.organizations.insert_one({
        "_id": org_id, "name": slug, "slug": slug, "plan": "professional", "status": "active", "logo_url": None,
        "owner_id": None, "settings": OrgSettings().model_dump(), "created_at": now, "updated_at": now})
    for email, role in [*ACCOUNTS[slug], *extra_users]:
        await db.users.insert_one({
            "_id": ObjectId(), "org_id": org_id, "name": email.split("@")[0].title() + " User", "email": email, "role": role,
            "password_hash": hash_password(PW), "is_active": True, "avatar_url": None, "last_login": None,
            "reset_token_hash": None, "reset_token_exp": None, "created_at": now, "updated_at": now})
    return org_id


@pytest_asyncio.fixture
async def env(monkeypatch):
    s = get_settings()
    for k, v in {"MULTI_TENANT_ENABLED": True, "TENANT_TRUST_FORWARDED_HOST": False, "TENANT_DEV_DEFAULT": "",
                 "TENANT_MYHOME_EXTRA_HOSTS": "", "TENANT_KOHINOOR_EXTRA_HOSTS": "", "TENANT_ALLOW_SELF_REGISTRATION": False,
                 "DEBUG": True}.items():
        monkeypatch.setattr(s, k, v)
    client = mongomock_motor.AsyncMongoMockClient()
    dbs = {"myhome": client["SiteVisionMyHome"], "kohinoor": client["SiteVisionKohinoor"]}
    # a My Home database that wrongly contains a Kohinoor-domain account must still not authenticate
    await _seed(dbs["myhome"], "myhome", extra_users=[("stray@kohinoorpune.com", "user")])
    await _seed(dbs["kohinoor"], "kohinoor")

    from app.main import create_app

    app = create_app()
    if getattr(app.state, "limiter", None) is not None:
        app.state.limiter.enabled = False

    async def _db():
        yield dbs[tenancy.require_tenant().slug]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_auth_db] = _db
    app.dependency_overrides[get_db_or_none] = _db

    def http(host):
        return AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}")

    yield SimpleNamespaceEnv(app, dbs, http)
    app.dependency_overrides.clear()


class SimpleNamespaceEnv:
    def __init__(self, app, dbs, http):
        self.app, self.dbs, self.http = app, dbs, http

    async def login(self, host, email, password=PW):
        async with self.http(host) as c:
            return await c.post("/api/v1/auth/login", json={"email": email, "password": password})


@pytest.mark.asyncio
async def test_each_tenant_logs_in_to_its_own_database(env):
    r = await env.login(MY_HOST, "admin@myhomeconstructions.com")
    assert r.status_code == 200 and r.json()["data"]["user"]["org_slug"] == "myhome"
    r = await env.login(KO_HOST, "admin@kohinoorpune.com")
    assert r.status_code == 200 and r.json()["data"]["user"]["org_slug"] == "kohinoor"


@pytest.mark.asyncio
@pytest.mark.parametrize("host,email", [
    (MY_HOST, "admin@kohinoorpune.com"),     # other tenant's domain
    (MY_HOST, "stray@kohinoorpune.com"),     # exists in the My Home DB, still rejected by domain
    (KO_HOST, "admin@myhomeconstructions.com"),
    (KO_HOST, "admin@kohinoorpune.com.evil.com"),
    (MY_HOST, "admin@sub.myhomeconstructions.com"),
])
async def test_email_domain_mismatch_is_rejected_with_the_generic_error(env, host, email):
    r = await env.login(host, email)
    assert r.status_code == 401
    unknown = await env.login(host, "nobody@" + email.split("@")[1])
    assert r.json() == unknown.json()  # indistinguishable from an unknown user


@pytest.mark.asyncio
async def test_wrong_password_and_unknown_host(env):
    assert (await env.login(KO_HOST, "admin@kohinoorpune.com", "wrong-password")).status_code == 401
    assert (await env.login("evil.example", "admin@kohinoorpune.com")).status_code == 421


@pytest.mark.asyncio
async def test_access_token_cannot_cross_tenants(env):
    mine = (await env.login(MY_HOST, "admin@myhomeconstructions.com")).json()["data"]["access_token"]
    kohi = (await env.login(KO_HOST, "admin@kohinoorpune.com")).json()["data"]["access_token"]
    async with env.http(MY_HOST) as c:
        assert (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {mine}"})).status_code == 200
        assert (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {kohi}"})).status_code == 401
    async with env.http(KO_HOST) as c:
        assert (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {kohi}"})).status_code == 200
        assert (await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {mine}"})).status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_cannot_cross_tenants(env):
    async with env.http(MY_HOST) as c:
        r = await c.post("/api/v1/auth/login", json={"email": "admin@myhomeconstructions.com", "password": PW})
        cookie = r.cookies.get("refresh_token")
        assert cookie
    async with env.http(KO_HOST) as c:
        r = await c.post("/api/v1/auth/refresh", cookies={"refresh_token": cookie})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_roles_are_enforced_per_tenant(env):
    target = await env.dbs["kohinoor"].users.find_one({"email": "fe@kohinoorpune.com"})
    body = {"new_password": "An0ther!StrongPass1"}
    tokens = {}
    for email in ("admin@kohinoorpune.com", "mgr@kohinoorpune.com", "fe@kohinoorpune.com"):   # log in first: the admin's reset changes the target's password
        tokens[email.split("@")[0]] = (await env.login(KO_HOST, email)).json()["data"]["access_token"]
    results = {}
    # least privilege first (must be refused), the administrator last
    for who in ("mgr", "fe", "admin"):
        async with env.http(KO_HOST) as c:
            r = await c.put(f"/api/v1/users/{target['_id']}/password", json=body, headers={"Authorization": f"Bearer {tokens[who]}"})
        results[who] = r.status_code
    assert results["admin"] == 200 and results["mgr"] == 403 and results["fe"] == 403


@pytest.mark.asyncio
async def test_self_registration_is_closed_and_admin_provisioning_is_domain_bound(env):
    payload = {"name": "New Person", "email": "new.person@kohinoorpune.com", "password": PW, "org_slug": "kohinoor"}
    async with env.http(KO_HOST) as c:
        assert (await c.post("/api/v1/auth/register", json=payload)).status_code == 403   # unverified mailbox
    admin = (await env.login(KO_HOST, "admin@kohinoorpune.com")).json()["data"]["access_token"]
    hdr = {"Authorization": f"Bearer {admin}"}
    async with env.http(KO_HOST) as c:
        bad = await c.post("/api/v1/auth/register", json={**payload, "email": "x@myhomeconstructions.com"}, headers=hdr)
        assert bad.status_code == 422                                                        # other tenant's domain
        ok = await c.post("/api/v1/auth/register", json={**payload, "role": "field_engineer"}, headers=hdr)
        assert ok.status_code == 201 and ok.json()["data"]["role"] == "field_engineer"
    assert await env.dbs["kohinoor"].users.count_documents({"email": "new.person@kohinoorpune.com"}) == 1
    assert await env.dbs["myhome"].users.count_documents({"email": "new.person@kohinoorpune.com"}) == 0


@pytest.mark.asyncio
async def test_password_reset_uses_the_tenants_own_site_and_ignores_foreign_domains(env, monkeypatch):
    from app.utils import email as email_mod

    sent = []
    real = email_mod.logger

    class _L:
        def info(self, m, *a, **k): sent.append(m)
        def __getattr__(self, n): return getattr(real, n)

    monkeypatch.setattr(email_mod, "logger", _L())
    monkeypatch.setattr(get_settings(), "TENANT_MYHOME_FRONTEND_URL", "")
    for host, mail in ((KO_HOST, "admin@kohinoorpune.com"), (MY_HOST, "admin@myhomeconstructions.com"),
                       (KO_HOST, "admin@myhomeconstructions.com")):
        async with env.http(host) as c:
            r = await c.post("/api/v1/auth/forgot-password", json={"email": mail})
            assert r.status_code == 200   # always generic
    text = "\n".join(sent)
    assert "https://kohinoorpune.com/reset-password?token=" in text
    assert "https://myhomeconstructions.com/reset-password?token=" in text
    assert text.count("Password reset link for") == 2   # the cross-domain request sent nothing
    assert "admin@myhomeconstructions.com" not in text.split("https://kohinoorpune.com")[0].split("Password reset link for")[-1]


@pytest.mark.asyncio
async def test_single_tenant_mode_is_unchanged(monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    assert tenancy.email_allowed_for_current_tenant("anyone@anywhere.example") is True


def test_tenant_for_email_is_an_exact_server_side_allowlist():
    assert tenancy.tenant_for_email(" Admin@KohinoorPune.com ").slug == "kohinoor"
    assert tenancy.tenant_for_email("a@myhomeconstructions.com").slug == "myhome"
    for bad in ("a@evil.com", "a@kohinoorpune.com.evil.com", "a@sub.kohinoorpune.com", "a@@kohinoorpune.com", "kohinoorpune.com",
                "a b@kohinoorpune.com", "", None, "@kohinoorpune.com", "a@kohinoorpune"):
        assert tenancy.tenant_for_email(bad) is None
