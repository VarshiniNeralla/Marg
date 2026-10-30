"""Binds every request to a tenant (fail closed).

Two modes (settings.TENANT_RESOLUTION), both only when MULTI_TENANT_ENABLED:
  host  - the tenant comes from the Host header against an explicit hostname allowlist; unknown hosts get 421.
  email - the Host header is NOT used. The login/register/forgot-password endpoints choose the tenant from the
          e-mail domain (explicit allowlist); every other request takes it from the signed token's tenant claim
          (access token, refresh cookie, or the token of a media URL), or from the path of a signed /media URL.
          The claim only selects which tenant's key/database to use; the signature is then verified with that
          tenant's own key, so a forged claim fails before any data is read.
"""
from __future__ import annotations

import json
from http.cookies import SimpleCookie
from urllib.parse import parse_qs

from app.core.tenancy import (
    email_routing,
    multi_tenant_enabled,
    reset_current_tenant,
    resolve_tenant,
    set_current_tenant,
    tenant_from_media_path,
    tenant_from_unverified_token,
)

# Liveness/readiness and the root banner carry no tenant data.
_EXEMPT_PATHS = frozenset({"/", "/health", "/health/ready"})
# Public handshake: tells the client how this server routes tenants (no data, works before any login).
_EMAIL_MODE_EXEMPT = _EXEMPT_PATHS | {"/api/v1/tenant"}


def _headers(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


def _tenant_from_credentials(scope, headers):
    """Email mode: the tenant a request's own signed credential claims (None = not bound yet)."""
    auth = headers.get("authorization", "")
    parts = auth.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        t = tenant_from_unverified_token(parts[1])
        if t:
            return t
    query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
    for tok in query.get("access_token", []):
        t = tenant_from_unverified_token(tok)
        if t:
            return t
    cookie = headers.get("cookie")
    if cookie:
        try:
            jar = SimpleCookie(cookie)
            if "refresh_token" in jar:
                t = tenant_from_unverified_token(jar["refresh_token"].value)
                if t:
                    return t
        except Exception:
            pass
    path = scope.get("path", "")
    if path.startswith("/media/"):
        return tenant_from_media_path(path[len("/media/"):])
    return None


class TenantMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket") or not multi_tenant_enabled():
            await self.app(scope, receive, send)
            return
        headers = _headers(scope)

        if email_routing():
            if scope["type"] == "http" and scope.get("path") in _EMAIL_MODE_EXEMPT:
                await self.app(scope, receive, send)
                return
            tenant = _tenant_from_credentials(scope, headers)
            token = set_current_tenant(tenant) if tenant else None
            try:
                await self.app(scope, receive, send)
            finally:
                if token is not None:
                    reset_current_tenant(token)
            return

        if scope["type"] == "http" and scope.get("path") in _EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return
        tenant = resolve_tenant(headers.get("host"), headers.get("x-forwarded-host"))
        if tenant is None:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = json.dumps({"success": False, "detail": "Unknown host"}).encode()
            await send({"type": "http.response.start", "status": 421,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return

        token = set_current_tenant(tenant)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_current_tenant(token)
