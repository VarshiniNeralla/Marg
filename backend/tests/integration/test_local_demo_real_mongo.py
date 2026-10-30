"""
LOCAL DEMO verification against a REAL MongoDB (not a mock): the Kohinoor and My Home demo accounts,
tenant routing, and cross-tenant isolation through the real multi-tenant database layer.

Skipped unless SV_LOCAL_DEMO_URI points at the loopback demo server AND the LOCAL-DEMO credentials files
exist under %USERPROFILE%\\.sitevision-secrets. Passwords are read in-process and never printed.
This never touches a production database: it refuses any non-loopback URI.
"""
import glob
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core import tenancy
from app.core.config import get_settings

URI = os.environ.get("SV_LOCAL_DEMO_URI", "")
SECRETS = Path(os.environ.get("USERPROFILE", "")) / ".sitevision-secrets"
MY_HOST, KO_HOST = "myhomeconstructions.com", "kohinoorpune.com"
MY_MARK, KO_MARK = "LOCALDEMO-MYHOME-MARKER-9001", "LOCALDEMO-KOHINOOR-MARKER-9002"


def _creds(tenant: str) -> dict:
    files = sorted(glob.glob(str(SECRETS / f"{tenant}-LOCAL-DEMO-credentials-*.txt")))
    out = {}
    for line in (Path(files[-1]).read_text(encoding="utf-8").splitlines() if files else []):
        parts = line.split("\t")
        if len(parts) == 3:
            out[parts[1]] = (parts[0], parts[2])         # email -> (role, password)
    return out


KO_CREDS, MY_CREDS = _creds("kohinoor"), _creds("myhome")
pytestmark = pytest.mark.skipif(
    not URI or (urlparse(URI).hostname or "") not in {"127.0.0.1", "localhost"} or len(KO_CREDS) != 3 or len(MY_CREDS) < 2,
    reason="local demo MongoDB / credentials files not present")


@pytest_asyncio.fixture
async def live(monkeypatch):
    from pymongo import MongoClient

    from app.db import mongodb
    from app.main import create_app

    s = get_settings()
    for k, v in {"MULTI_TENANT_ENABLED": True, "TENANT_MYHOME_MONGO_URI": URI, "TENANT_KOHINOOR_MONGO_URI": URI,
                 "TENANT_TRUST_FORWARDED_HOST": False, "TENANT_DEV_DEFAULT": "", "TENANT_MYHOME_EXTRA_HOSTS": "",
                 "TENANT_KOHINOOR_EXTRA_HOSTS": "", "TENANT_ALLOW_SELF_REGISTRATION": False}.items():
        monkeypatch.setattr(s, k, v)
    monkeypatch.setattr(mongodb, "_tenant_clients", {})
    await mongodb.connect_db(retries=1, base_delay=0)
    sync = MongoClient(URI, serverSelectionTimeoutMS=5000)
    dbs = {"myhome": sync["SiteVisionMyHome"], "kohinoor": sync["SiteVisionKohinoor"]}
    ids = {}
    for slug, mark in (("myhome", MY_MARK), ("kohinoor", KO_MARK)):
        org = dbs[slug].organizations.find_one({})
        ids[slug] = f"proj-{slug}-localdemo"
        dbs[slug].projects.replace_one({"_id": ids[slug]}, {"_id": ids[slug], "id": ids[slug], "orgId": str(org["_id"]),
                                                            "name": f"{mark} project"}, upsert=True)
    app = create_app()
    if getattr(app.state, "limiter", None) is not None:
        app.state.limiter.enabled = False

    class Live:
        pass

    live = Live()
    live.dbs, live.ids, live.sync = dbs, ids, sync

    def http(host):
        return AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}")

    async def login(host, email, password):
        async with http(host) as c:
            return await c.post("/api/v1/auth/login", json={"email": email, "password": password})

    async def call(host, method, path, token=None, **kw):
        async with http(host) as c:
            return await getattr(c, method)(path, headers={"Authorization": f"Bearer {token}"} if token else {}, **kw)

    live.http, live.login, live.call = http, login, call
    yield live
    for slug in dbs:                                   # remove only the marker documents this test added
        dbs[slug].projects.delete_one({"_id": ids[slug]})
    await mongodb.close_db()
    sync.close()


@pytest.mark.asyncio
async def test_kohinoor_demo_accounts_sign_in_with_the_right_roles_against_the_kohinoor_database(live):
    want = {"admin@kohinoorpune.com": "admin", "manager@kohinoorpune.com": "manager", "engineerdemo@kohinoorpune.com": "field_engineer"}
    assert set(KO_CREDS) == set(want)
    for email, role in want.items():
        r = await live.login(KO_HOST, email, KO_CREDS[email][1])
        assert r.status_code == 200, email
        user = r.json()["data"]["user"]
        assert user["role"] == role and user["org_slug"] == "kohinoor" and user["email"] == email
        assert user["org_id"] == str(live.dbs["kohinoor"].organizations.find_one({})["_id"])


@pytest.mark.asyncio
async def test_my_home_local_demo_accounts_still_use_the_my_home_database(live):
    for email, (role, pw) in MY_CREDS.items():
        r = await live.login(MY_HOST, email, pw)
        assert r.status_code == 200 and r.json()["data"]["user"]["org_slug"] == "myhome"
        assert r.json()["data"]["user"]["org_id"] == str(live.dbs["myhome"].organizations.find_one({})["_id"])


@pytest.mark.asyncio
async def test_neither_tenants_accounts_can_sign_in_to_the_other(live):
    for email, (_, pw) in KO_CREDS.items():
        assert (await live.login(MY_HOST, email, pw)).status_code == 401
    for email, (_, pw) in MY_CREDS.items():
        assert (await live.login(KO_HOST, email, pw)).status_code == 401


@pytest.mark.asyncio
async def test_tokens_do_not_cross_and_each_tenant_sees_only_its_own_data(live):
    ko_email = "admin@kohinoorpune.com"
    my_email = next(e for e, (r, _) in MY_CREDS.items() if r == "admin")
    ko_tok = (await live.login(KO_HOST, ko_email, KO_CREDS[ko_email][1])).json()["data"]["access_token"]
    my_tok = (await live.login(MY_HOST, my_email, MY_CREDS[my_email][1])).json()["data"]["access_token"]
    assert (await live.call(MY_HOST, "get", "/api/v1/auth/me", ko_tok)).status_code == 401
    assert (await live.call(KO_HOST, "get", "/api/v1/auth/me", my_tok)).status_code == 401
    ko_snap = (await live.call(KO_HOST, "get", "/api/v1/workflow/snapshot", ko_tok)).text
    my_snap = (await live.call(MY_HOST, "get", "/api/v1/workflow/snapshot", my_tok)).text
    assert KO_MARK in ko_snap and MY_MARK not in ko_snap
    assert MY_MARK in my_snap and KO_MARK not in my_snap
    # a Kohinoor admin guessing/forcing a My Home id changes nothing in My Home (and vice versa)
    before_my = live.dbs["myhome"].projects.find_one({"_id": live.ids["myhome"]})
    before_ko = live.dbs["kohinoor"].projects.find_one({"_id": live.ids["kohinoor"]})
    assert (await live.call(KO_HOST, "get", f"/api/v1/projects/{live.ids['myhome']}", ko_tok)).status_code == 404
    await live.call(KO_HOST, "put", f"/api/v1/projects/{live.ids['myhome']}", ko_tok, json={"id": live.ids["myhome"], "name": "hijack"})
    await live.call(KO_HOST, "delete", f"/api/v1/projects/{live.ids['myhome']}", ko_tok)
    assert (await live.call(MY_HOST, "get", f"/api/v1/projects/{live.ids['kohinoor']}", my_tok)).status_code == 404
    await live.call(MY_HOST, "delete", f"/api/v1/projects/{live.ids['kohinoor']}", my_tok)
    assert live.dbs["myhome"].projects.find_one({"_id": live.ids["myhome"]}) == before_my
    assert live.dbs["kohinoor"].projects.find_one({"_id": live.ids["kohinoor"]}) == before_ko
    for slug in ("myhome", "kohinoor"):               # the hijack attempts left no stray documents either
        assert live.dbs[slug].projects.count_documents({}) == 1


def test_stored_data_is_separate_hashed_and_has_no_fallback_database(live):
    ko_users = list(live.dbs["kohinoor"].users.find({}))
    my_users = list(live.dbs["myhome"].users.find({}))
    assert len(ko_users) == 3 and all(u["email"].endswith("@kohinoorpune.com") for u in ko_users)
    assert my_users and all(u["email"].endswith("@myhomeconstructions.com") for u in my_users)
    assert all(u.get("is_demo") for u in ko_users)
    pws = {pw for _, pw in KO_CREDS.values()} | {pw for _, pw in MY_CREDS.values()}
    for u in ko_users + my_users:
        assert u["password_hash"].startswith("$2") and u["password_hash"] not in pws
    assert len(pws) == len(KO_CREDS) + len(MY_CREDS)                        # every demo password is unique
    names = [n for n in live.sync.list_database_names() if n not in {"admin", "local", "config"}]
    assert sorted(names) == ["SiteVisionKohinoor", "SiteVisionMyHome"]    # no virtual_tour / shared database was created


@pytest.mark.asyncio
async def test_unknown_host_and_wrong_domain_fail_closed(live):
    email, (_, pw) = next(iter(KO_CREDS.items()))
    assert (await live.login("evil.example", email, pw)).status_code == 421
    assert (await live.login(MY_HOST, email, pw)).status_code == 401
