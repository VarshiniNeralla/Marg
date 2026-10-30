"""GET /api/v1/tenant: the server tells the client which tenant IT resolved (the client can never choose)."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import tenancy
from app.core.config import get_settings
from tests.integration.test_tenant_auth import KO_HOST, MY_HOST, env  # noqa: F401  (fixture)


async def _get(app, host, path="/api/v1/tenant", **kw):
    async with AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}") as c:
        return await c.get(path, **kw)


@pytest.mark.asyncio
async def test_each_host_reports_its_own_tenant_and_database(env):
    assert (await _get(env.app, MY_HOST)).json() == {"multiTenant": True, "routing": "host", "tenant": "myhome", "organization": "myhomeconstructions.com", "database": "SiteVisionMyHome"}
    assert (await _get(env.app, KO_HOST)).json() == {"multiTenant": True, "routing": "host", "tenant": "kohinoor", "organization": "kohinoorpune.com", "database": "SiteVisionKohinoor"}
    assert (await _get(env.app, "kohinoor.localhost")).json()["tenant"] == "kohinoor"
    assert (await _get(env.app, "myhome.localhost")).json()["database"] == "SiteVisionMyHome"


@pytest.mark.asyncio
async def test_client_supplied_hints_cannot_change_the_answer(env):
    r = await _get(env.app, KO_HOST, "/api/v1/tenant?tenant=myhome&tid=myhome",
                   headers={"X-Tenant-Id": "myhome", "X-Forwarded-Host": MY_HOST, "Origin": "https://myhomeconstructions.com"})
    assert r.json()["tenant"] == "kohinoor"


@pytest.mark.asyncio
async def test_unknown_host_fails_closed(env):
    assert (await _get(env.app, "evil.example")).status_code == 421


@pytest.mark.asyncio
async def test_database_name_is_hidden_in_production(env, monkeypatch):
    monkeypatch.setattr(type(get_settings()), "is_production", property(lambda self: True))
    body = (await _get(env.app, KO_HOST)).json()
    assert body["tenant"] == "kohinoor" and "database" not in body


@pytest.mark.asyncio
async def test_single_tenant_server_reports_no_tenant(env, monkeypatch):
    monkeypatch.setattr(get_settings(), "MULTI_TENANT_ENABLED", False)
    assert (await _get(env.app, "anything.example")).json() == {"multiTenant": False, "routing": None, "tenant": None}
