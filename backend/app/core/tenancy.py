"""
Server-side tenant resolution (database per tenant).

The tenant is resolved from the request Host header against an explicit
allowlist. Client-supplied tenant ids are never consulted. When multi-tenancy is
enabled every database access, token, signed media URL and storage key is bound
to the resolved tenant and fails closed if no tenant is in context.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator, Optional

from app.core.config import get_settings

_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")


@dataclass(frozen=True)
class Tenant:
    slug: str
    db_name: str
    domain: str
    mongo_uri_setting: str
    extra_hosts_setting: str
    frontend_url_setting: str = ""
    # Legacy uploads live under SiteVision/... and belong to this tenant only.
    legacy_media: bool = False
    # Exact organization e-mail domains that may hold accounts in this tenant.
    email_domains: tuple[str, ...] = ()

    def allowed_email_domains(self) -> frozenset[str]:
        return frozenset(self.email_domains or (self.domain,))

    def built_in_hosts(self) -> frozenset[str]:
        return frozenset({self.domain, f"www.{self.domain}", f"api.{self.domain}", f"app.{self.domain}"})


# Explicit allowlist: the only tenants that can exist.
TENANTS: tuple[Tenant, ...] = (
    Tenant("myhome", "SiteVisionMyHome", "myhomeconstructions.com",
           "TENANT_MYHOME_MONGO_URI", "TENANT_MYHOME_EXTRA_HOSTS", "TENANT_MYHOME_FRONTEND_URL",
           legacy_media=True),
    Tenant("kohinoor", "SiteVisionKohinoor", "kohinoorpune.com",
           "TENANT_KOHINOOR_MONGO_URI", "TENANT_KOHINOOR_EXTRA_HOSTS", "TENANT_KOHINOOR_FRONTEND_URL"),
)
_BY_SLUG = {t.slug: t for t in TENANTS}

_current: ContextVar[Optional[Tenant]] = ContextVar("sitevision_tenant", default=None)


class TenantResolutionError(Exception):
    """Raised when tenant context is required but absent (fail closed)."""


def routing_mode() -> str:
    mode = str(getattr(get_settings(), "TENANT_RESOLUTION", "host") or "host").strip().lower()
    return mode if mode in ("host", "email") else "host"


def email_routing() -> bool:
    """Multi-tenant with the tenant chosen from the e-mail domain / signed token instead of the Host header."""
    return multi_tenant_enabled() and routing_mode() == "email"


def multi_tenant_enabled() -> bool:
    # getattr: a process that loaded an older Settings class (no such field) must behave as
    # single-tenant instead of crashing when this module is imported lazily after a code update.
    return bool(getattr(get_settings(), "MULTI_TENANT_ENABLED", False))


def tenant_by_slug(slug: str) -> Optional[Tenant]:
    return _BY_SLUG.get((slug or "").strip().lower())


def _normalise_host(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    if "," in raw:  # a chain of hosts is ambiguous and its first entry is client-controlled
        return None
    host = raw.strip().lower()
    if host.startswith("["):  # IPv6 literals are never tenant hosts
        return None
    if ":" in host:
        host, _, port = host.rpartition(":")
        if not port.isdigit():
            return None
    host = host.rstrip(".")
    return host if _HOST_RE.match(host) else None


def host_map() -> dict[str, Tenant]:
    """Exact-host -> tenant. Built per call so tests/config changes apply."""
    s = get_settings()
    out: dict[str, Tenant] = {}
    for t in TENANTS:
        hosts = set(t.built_in_hosts())
        for h in (getattr(s, t.extra_hosts_setting, "") or "").split(","):
            h = _normalise_host(h)
            if h:
                hosts.add(h)
        for h in hosts:
            if h in out and out[h].slug != t.slug:
                raise ValueError(f"host {h!r} is mapped to two tenants")
            out[h] = t
    if not s.is_production:
        # Explicit per-tenant local-development hosts (browsers resolve *.localhost to loopback), so a
        # developer can run BOTH tenants side by side without any default tenant: the Host header alone
        # selects the database. Never mapped in production.
        for t in TENANTS:
            out.setdefault(f"{t.slug}.localhost", t)
        dev = tenant_by_slug(s.TENANT_DEV_DEFAULT)
        if dev:
            for h in ("localhost", "127.0.0.1"):
                out.setdefault(h, dev)
    return out


def resolve_tenant(host_header: Optional[str], forwarded_host: Optional[str] = None) -> Optional[Tenant]:
    """Resolve a tenant from request headers. None means: reject the request."""
    s = get_settings()
    raw = forwarded_host if (s.TENANT_TRUST_FORWARDED_HOST and forwarded_host) else host_header
    host = _normalise_host(raw)
    return host_map().get(host) if host else None


def tenant_from_unverified_token(token: Optional[str]) -> Optional[Tenant]:
    """
    The tenant a (JWT) token CLAIMS. Unverified on purpose: it only selects which tenant's signing key and
    database to use; the signature is then verified with THAT tenant's derived key, so a forged claim fails.
    Returns None for malformed tokens or unknown tenants.
    """
    if not token:
        return None
    try:
        from jose import jwt

        claims = jwt.get_unverified_claims(token)
    except Exception:
        return None
    return tenant_by_slug(str(claims.get("tid") or ""))


def legacy_tenant() -> Optional[Tenant]:
    """The tenant that owns the legacy SiteVision/ files (My Home)."""
    return next((t for t in TENANTS if t.legacy_media), None)


def tenant_from_media_path(file_path: str) -> Optional[Tenant]:
    """<slug>/... belongs to that tenant; legacy SiteVision/... and other legacy paths to the legacy tenant."""
    segs = [p for p in (file_path or "").replace("\\", "/").strip("/").split("/") if p]
    if not segs:
        return None
    return tenant_by_slug(segs[0]) or legacy_tenant()


def bind_tenant_from_email(email: Optional[str]) -> Optional[Tenant]:
    """Server-side allowlist lookup by e-mail domain; binds the tenant for the rest of this request."""
    tenant = tenant_for_email(email)
    if tenant is not None:
        set_current_tenant(tenant)
    return tenant


def current_tenant() -> Optional[Tenant]:
    return _current.get()


def require_tenant() -> Tenant:
    t = _current.get()
    if t is None:
        raise TenantResolutionError("no tenant in context")
    return t


@contextmanager
def use_tenant(tenant: Tenant) -> Iterator[Tenant]:
    token = _current.set(tenant)
    try:
        yield tenant
    finally:
        _current.reset(token)


def set_current_tenant(tenant: Optional[Tenant]):
    return _current.set(tenant)


def reset_current_tenant(token) -> None:
    _current.reset(token)


def normalise_email(email: Optional[str]) -> Optional[str]:
    """Lower-cased address with exactly one '@' and no whitespace/control characters, else None."""
    e = (email or "").strip().lower()
    if not e or e.count("@") != 1 or any(ch.isspace() or ord(ch) < 32 for ch in e):
        return None
    local, domain = e.split("@")
    return e if local and domain and "." in domain else None


def tenant_for_email(email: Optional[str]) -> Optional[Tenant]:
    """Server-side allowlist lookup: which tenant owns this e-mail domain (exact match)?"""
    e = normalise_email(email)
    if not e:
        return None
    domain = e.split("@")[1]
    for t in TENANTS:
        if domain in t.allowed_email_domains():
            return t
    return None


def email_allowed_for_current_tenant(email: Optional[str]) -> bool:
    """
    True when the e-mail's domain belongs to the tenant bound to this request.
    Single-tenant mode: always True (behaviour unchanged). A domain is not proof of
    mailbox ownership; it only decides which tenant an address may belong to.
    """
    if not multi_tenant_enabled():
        return True
    owner = tenant_for_email(email)
    current = current_tenant()
    return owner is not None and current is not None and owner.slug == current.slug


def frontend_base_url() -> str:
    """Public SPA base URL for links sent to users (e.g. password reset), per tenant."""
    s = get_settings()
    if not multi_tenant_enabled():
        return s.FRONTEND_URL
    t = require_tenant()
    configured = (getattr(s, t.frontend_url_setting, "") or "").strip().rstrip("/")
    return configured or f"https://{t.domain}"


def namespace() -> str:
    """Key-namespace for shared stores (Redis etc.); empty in single-tenant mode."""
    if not multi_tenant_enabled():
        return ""
    return f"{require_tenant().slug}:"


def derive_key(secret: str, purpose: str) -> str:
    """Per-tenant signing key: a token/URL signed for one tenant never verifies for another."""
    if not multi_tenant_enabled():
        return secret
    t = require_tenant()
    return hmac.new(secret.encode("utf-8"), f"{purpose}:{t.slug}".encode("utf-8"), hashlib.sha256).hexdigest()


def origin_belongs_to_current_tenant(origin: Optional[str]) -> bool:
    """CORS: is this browser Origin one of the CURRENT tenant's own hosts? (fails closed)"""
    from urllib.parse import urlsplit

    cur = current_tenant()
    if cur is None or not origin:
        return False
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    host = _normalise_host(parts.netloc) if parts.scheme in ("http", "https") and not parts.path.strip("/") else None
    owner = host_map().get(host) if host else None
    return owner is not None and owner.slug == cur.slug


def asset_owned(public_id: Optional[str], org_id: Optional[str] = None) -> bool:
    """
    May the current tenant (and, when given, organization) act on this stored asset id?
    Guards destructive/AI operations whose asset ids come from client-controlled documents,
    because both tenants share one Cloudinary account and one upload volume.
    Single-tenant mode: always True (behaviour unchanged).
    """
    if not multi_tenant_enabled():
        return True
    pid = (public_id or "").strip()
    if pid.startswith("local/"):
        pid = pid[len("local/"):]
    if not pid or not media_path_allowed(pid):
        return False
    segs = [p for p in pid.strip("/").split("/") if p]
    if org_id and segs:
        head = segs[0].casefold()
        if tenant_by_slug(head) is not None and len(segs) >= 4:     # <tenant>/<sites|users>/<kind>/<org>/...
            return segs[3] == str(org_id)
        if head == "sitevision" and len(segs) >= 3:                   # SiteVision/<kind>/<org>/...
            return segs[2] == str(org_id)
    return True


LEGACY_STORAGE_ROOT = "SiteVision"
# Kinds stored under <tenant>/users/; every other kind (captures, floorplans, tours, projects, thumbnails...)
# lives under <tenant>/sites/. Processing files live under the private <tenant>/_work/.
STORAGE_USER_KINDS = frozenset({"avatars"})


def storage_tenant() -> Optional[Tenant]:
    """
    The tenant whose folder NEW uploads go to, or None for the legacy SiteVision/ layout.
    Multi-tenant: always the authenticated request's tenant (from the trusted server-side context).
    Single-tenant: the legacy tenant, once STORAGE_LAYOUT=tenant has been switched on.
    """
    if multi_tenant_enabled():
        return require_tenant()
    if str(getattr(get_settings(), "STORAGE_LAYOUT", "legacy") or "legacy").strip().lower() == "tenant":
        return legacy_tenant()
    return None


def storage_root_segments(kind: Optional[str] = None) -> list[str]:
    """Leading storage-key segments for NEW uploads of the given kind."""
    t = storage_tenant()
    if t is None:
        return [LEGACY_STORAGE_ROOT]
    return [t.slug, "users" if (kind or "") in STORAGE_USER_KINDS else "sites"]


def legacy_to_tenant_relpath(rel: str) -> Optional[str]:
    """SiteVision/<kind>/<rest> -> <legacy tenant>/<sites|users>/<kind>/<rest> (where migrated copies live)."""
    segs = [p for p in (rel or "").replace("\\", "/").strip("/").split("/") if p]
    t = legacy_tenant()
    if t is None or len(segs) < 3 or segs[0] != LEGACY_STORAGE_ROOT:
        return None
    bucket = "users" if segs[1] in STORAGE_USER_KINDS else "sites"
    return "/".join([t.slug, bucket, *segs[1:]])


def media_path_allowed(file_path: str) -> bool:
    """
    May the current tenant read/delete this stored path?
    <slug>/... only for that slug; legacy (SiteVision/..., misc) only for the legacy
    tenant. Traversal segments are always refused.
    """
    if not multi_tenant_enabled():
        return True
    t = current_tenant()
    if t is None:
        return False
    segs = [p for p in (file_path or "").replace("\\", "/").strip("/").split("/") if p]
    if not segs or any(p in {".", ".."} for p in segs):
        return False
    owner = tenant_by_slug(segs[0])
    if owner is not None:                                   # <slug>/<sites|users|_work>/...
        return len(segs) >= 3 and owner.slug == t.slug
    return t.legacy_media
