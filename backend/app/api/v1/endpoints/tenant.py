"""Which tenant does THIS server resolve for THIS request? (public, read-only, no data)"""
from fastapi import APIRouter

from app.core import tenancy
from app.core.config import get_settings

router = APIRouter(tags=["Tenant"])


@router.get("/tenant", summary="Tenant resolved by the server for this request")
async def current_tenant_info():
    """
    The tenant comes ONLY from the request Host header (server-side allowlist); nothing the client sends
    can change it. Single-tenant servers report ``multiTenant: false``. Used by the login page to refuse to
    present one organization's sign-in against another organization's backend. Exposes no records.
    The database name is included in non-production environments only, as a configuration check.
    """
    settings = get_settings()
    if not tenancy.multi_tenant_enabled():
        return {"multiTenant": False, "routing": None, "tenant": None}
    if tenancy.email_routing():
        # The tenant is chosen at login from the e-mail domain, so there is none to report before that.
        return {"multiTenant": True, "routing": "email", "tenant": None}
    tenant = tenancy.require_tenant()
    body = {"multiTenant": True, "routing": "host", "tenant": tenant.slug, "organization": tenant.domain}
    if not settings.is_production:
        body["database"] = tenant.db_name
    return body
