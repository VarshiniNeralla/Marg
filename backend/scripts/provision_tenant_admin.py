"""
Provision the initial accounts (administrator, manager, field engineer) of ONE tenant.

Safe by construction:
  * dry run unless --apply is given;
  * every address's e-mail domain must be the tenant's explicitly configured domain (the allowlist in
    app/core/tenancy.py): that configuration, not a DNS check, is what routes a login to this database;
  * every address must be under the tenant's own domain (kohinoorpune.com for kohinoor);
  * names and addresses come from an --accounts-file you approve; none are invented;
  * passwords are generated here with `secrets` (never derived from names/emails), hashed with
    the application's bcrypt helper, and written ONLY to an access-restricted handoff file under
    %USERPROFILE%\\.sitevision-secrets. They are never printed, logged or passed as arguments;
  * idempotent: an account whose e-mail already exists is left untouched (no password reset, no
    duplicate); a second administrator is never created;
  * the tenant connection string comes from the tenant's TENANT_*_MONGO_URI setting.

The user model has no forced-password-change flag, so first-login change is NOT enforced; tell users
to change the password with the application's change-password feature.

accounts file (JSON, no passwords):
  {"org_name": "...", "org_slug": "...",
   "accounts": [{"email": "...", "name": "...", "role": "administrator|manager|field_engineer"}, ...]}

usage:
  python scripts/provision_tenant_admin.py --tenant kohinoor --accounts-file accounts.json            (dry run)
  python scripts/provision_tenant_admin.py --tenant kohinoor --accounts-file accounts.json --apply

DOMAIN VERIFICATION is NOT required. Tenant routing keys on the e-mail domain against the server-side tenant
configuration, so a DNS ownership check is not needed to route a login to a database. What verification would add
is assurance that nobody else controls the mailboxes: a password-RESET e-mail goes to the address on the account.
Reset e-mails are not sent unless SMTP is configured, and the generated passwords are random, so the residual risk
is only "someone who controls this mailbox could reset this account's password once e-mail is enabled". If you want
the stricter behaviour, ask for it explicitly:
  --require-domain-verification   refuse unless --domain-verified (operator attestation) or --domain-txt-token
                                  (the domain owner published sitevision-verification=TOKEN as an apex TXT record)
  --domain-txt-token TOKEN        optional on its own: if given, the record MUST be present or the run is refused
--uri-env NAME reads the tenant database URI from that environment variable (instead of TENANT_*_MONGO_URI in
.env), e.g. when a wrapper decrypts it from the DPAPI secret store in memory.

LOCAL DEMO MODE (not production):
  --local-demo-uri-env NAME   read the MongoDB URI from the environment variable NAME and write the accounts
                              to that LOCAL database instead of the tenant's production database. The host
                              must be loopback (127.0.0.1 / localhost / ::1): anything else is refused. The
                              domain-verification flag is not needed because nothing is created in the real
                              tenant database; accounts are flagged is_demo and the credentials file is
                              named *-LOCAL-DEMO-credentials-*. The e-mail-domain and role rules still apply.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import string
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import tenancy  # noqa: E402

DNS_TXT_PREFIX = "sitevision-verification="


def _fetch_txt_google(domain: str) -> list[str]:
    """TXT strings of the apex domain from public DNS (DNS-over-HTTPS)."""
    import json
    import urllib.request

    req = urllib.request.Request(f"https://dns.google/resolve?name={domain}&type=TXT", headers={"accept": "application/dns-json"})
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - fixed https endpoint
        data = json.loads(r.read().decode("utf-8"))
    return [str(a.get("data", "")).strip('"') for a in data.get("Answer", []) if a.get("type") == 16]


def verify_domain_via_dns(domain: str, token: str, fetch=None) -> bool:
    """True only if the domain's public DNS publishes the exact TXT value sitevision-verification=<token>."""
    token = (token or "").strip()
    if len(token) < 16:
        return False
    try:
        records = (fetch or _fetch_txt_google)(domain)
    except Exception:
        return False
    # TXT data may arrive quoted and split into 255-byte chunks: normalise before comparing exactly
    return (DNS_TXT_PREFIX + token) in {str(r).replace('" "', "").strip().strip('"') for r in records}


ROLE_MAP = {"administrator": "admin", "admin": "admin", "manager": "manager", "field_engineer": "field_engineer"}
_SPECIALS = "@$!%*?&"  # the application's password policy accepts exactly these specials


def plan_provisioning(tenant_slug: str, email: str, domain_verified: bool = False, *, require_verified: bool = False) -> str:
    """Return the tenant slug if provisioning is allowed for this address; raise ValueError otherwise."""
    tenant = tenancy.tenant_by_slug(tenant_slug)
    if tenant is None:
        raise ValueError(f"unknown tenant {tenant_slug!r}")
    e = tenancy.normalise_email(email)
    if e is None:
        raise ValueError("invalid email address")
    if e.split("@")[1] not in tenant.allowed_email_domains():
        raise ValueError(f"email domain must be {tenant.domain} for tenant {tenant.slug}")
    if require_verified and not domain_verified:
        raise ValueError(
            f"{tenant.domain} is not confirmed as verified. Either confirm ownership and pass --domain-verified, or have the "
            f"domain owner publish the DNS TXT record 'sitevision-verification=<token>' on {tenant.domain} and pass --domain-txt-token <token>"
        )
    return tenant.slug


def validate_accounts(tenant_slug: str, accounts: list[dict], domain_verified: bool = False, *, require_verified: bool = False) -> list[dict]:
    """Normalise and validate the approved account list. Raises ValueError on any problem."""
    if not accounts:
        raise ValueError("no accounts supplied")
    out, seen = [], set()
    for a in accounts:
        email = tenancy.normalise_email(a.get("email"))
        plan_provisioning(tenant_slug, a.get("email"), domain_verified, require_verified=require_verified)
        role = ROLE_MAP.get(str(a.get("role", "")).strip().lower())
        name = " ".join(str(a.get("name", "")).split())
        if role is None:
            raise ValueError(f"unsupported role for {email}: {a.get('role')!r}")
        if len(name) < 2:
            raise ValueError(f"a display name is required for {email}")
        if email in seen:
            raise ValueError(f"duplicate address {email}")
        seen.add(email)
        out.append({"email": email, "name": name, "role": role})
    if sum(1 for a in out if a["role"] == "admin") != 1:
        raise ValueError("exactly one administrator is required")
    return out


def generate_password(*avoid: str) -> str:
    """20-character random password satisfying the app policy; never contains the given strings."""
    alphabet = string.ascii_letters + string.digits + _SPECIALS
    avoid_l = [x.lower() for x in avoid if x and len(x) >= 3]
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(20))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw)
                and any(c in _SPECIALS for c in pw) and not any(x in pw.lower() for x in avoid_l)):
            return pw


def write_handoff(path: Path, rows: list[dict]) -> None:
    """Create the credentials file exclusively and restrict it to the current Windows user."""
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("SiteVision initial credentials. Keep private; delete after handing over.\n"
                 "Users must change their password after first sign-in (not enforced by the application).\n\n")
        for r in rows:
            fh.write(f"{r['role']}\t{r['email']}\t{r['password']}\n")
    if os.name == "nt":
        user = os.environ.get("USERNAME", "")
        subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:(R,W)"],
                       check=True, capture_output=True)


def require_loopback(uri: str) -> None:
    """Local demo mode may only write to a MongoDB on this machine."""
    from urllib.parse import urlparse

    host = (urlparse(uri).hostname or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("local demo mode only writes to a loopback MongoDB (127.0.0.1 / localhost); refusing")


def provision(db, tenant_slug: str, org_name: str, org_slug: str, accounts: list[dict], *, apply: bool,
              hasher=None, handoff_path: Path | None = None, demo: bool = False) -> dict:
    """Create the organization and any missing accounts. Returns a summary WITHOUT passwords."""
    from bson import ObjectId

    from app.models.organization import OrganizationDocument
    from app.models.user import UserDocument

    if hasher is None:
        from app.core.security import hash_password as hasher
    summary = {"organization": None, "created": [], "existing": [], "skipped": []}
    org = db.organizations.find_one({"slug": org_slug})
    summary["organization"] = "reuse existing" if org else "create"
    admin_exists = db.users.count_documents({"role": {"$in": ["admin", "super_admin"]}}) > 0

    todo = []
    for a in accounts:
        if db.users.count_documents({"email": a["email"]}) > 0:
            summary["existing"].append(a["email"])
        elif a["role"] == "admin" and admin_exists:
            summary["skipped"].append((a["email"], "this tenant already has an administrator"))
        else:
            todo.append(a)
    summary["would_create" if not apply else "created_pending"] = [(a["email"], a["role"]) for a in todo]
    if not apply or not todo:
        return summary

    if org is None:
        org_doc = OrganizationDocument(name=org_name, slug=org_slug).to_mongo()
        if demo:
            org_doc["is_demo"] = True
        org_id = db.organizations.insert_one(org_doc).inserted_id
    else:
        org_id = org["_id"]
    rows = []
    for a in todo:
        pw = generate_password(a["email"].split("@")[0], a["name"].replace(" ", ""))
        user = UserDocument(org_id=org_id, name=a["name"], email=a["email"], password_hash=hasher(pw), role=a["role"], is_active=True)
        doc = user.to_mongo()
        doc["email"] = doc["email"].lower()
        doc["org_id"] = ObjectId(str(org_id))     # same as UserRepository.create: ObjectId, not str
        if demo:
            doc["is_demo"] = True
        uid = db.users.insert_one(doc).inserted_id
        if a["role"] == "admin":
            db.organizations.update_one({"_id": org_id, "owner_id": {"$in": [None, ""]}}, {"$set": {"owner_id": uid}})
        rows.append({"role": a["role"], "email": a["email"], "password": pw})
        summary["created"].append((a["email"], a["role"]))
    summary.pop("created_pending", None)
    if handoff_path is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        kind = "LOCAL-DEMO-credentials" if demo else "initial-credentials"
        handoff_path = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".sitevision-secrets" / f"{tenant_slug}-{kind}-{stamp}.txt"
    write_handoff(handoff_path, rows)
    summary["handoff_file"] = str(handoff_path)
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--accounts-file", required=True)
    ap.add_argument("--domain-verified", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--local-demo-uri-env", default="")
    ap.add_argument("--uri-env", default="")
    ap.add_argument("--domain-txt-token", default="")
    ap.add_argument("--require-domain-verification", action="store_true")
    a = ap.parse_args(argv)
    demo = bool(a.local_demo_uri_env)
    if demo and a.uri_env:
        print("REFUSED: --uri-env and --local-demo-uri-env are mutually exclusive")
        return 2
    verified, how = a.domain_verified, "attested by the operator (--domain-verified)" if a.domain_verified else ""
    if not demo and not verified and a.domain_txt_token:     # optional, but if requested it must hold
        t = tenancy.tenant_by_slug(a.tenant)
        if t is not None and verify_domain_via_dns(t.domain, a.domain_txt_token):
            verified, how = True, f"DNS TXT record found on {t.domain}"
        else:
            print(f"REFUSED: the TXT record 'sitevision-verification=<token>' was not found on {getattr(t, 'domain', '?')}")
            return 2

    try:
        spec = json.loads(Path(a.accounts_file).read_text(encoding="utf-8-sig"))
        accounts = validate_accounts(a.tenant, spec.get("accounts", []), verified, require_verified=a.require_domain_verification and not demo)
        org_name, org_slug = str(spec.get("org_name", "")).strip(), str(spec.get("org_slug", "")).strip().lower()
        if len(org_name) < 2 or len(org_slug) < 3:
            raise ValueError("org_name and org_slug are required in the accounts file")
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"REFUSED: {exc}")
        return 2
    tenant = tenancy.tenant_by_slug(a.tenant)

    from pymongo import MongoClient

    from app.core.config import get_settings

    if demo:
        uri = os.environ.get(a.local_demo_uri_env, "").strip()
        try:
            if not uri:
                raise ValueError(f"environment variable {a.local_demo_uri_env} is not set")
            require_loopback(uri)
        except ValueError as exc:
            print(f"REFUSED: {exc}")
            return 2
    elif a.uri_env:
        uri = os.environ.get(a.uri_env, "").strip()
        if not uri:
            print(f"REFUSED: environment variable {a.uri_env} is not set")
            return 2
    else:
        uri = (getattr(get_settings(), tenant.mongo_uri_setting, "") or "").strip()
        if not uri:
            print(f"REFUSED: {tenant.mongo_uri_setting} is not set")
            return 2
    db = MongoClient(uri, serverSelectionTimeoutMS=20000)[tenant.db_name]
    result = provision(db, tenant.slug, org_name, org_slug, accounts, apply=a.apply, demo=demo)
    if demo and a.apply:
        # same schema/indexes as the application creates at startup (unique e-mail, unique org slug, ...)
        import asyncio

        from motor.motor_asyncio import AsyncIOMotorClient

        from app.db.indexes import create_indexes

        asyncio.run(create_indexes(AsyncIOMotorClient(uri, serverSelectionTimeoutMS=20000)[tenant.db_name]))
    label = ("LOCAL DEMO " if demo else "") + ("APPLY" if a.apply else "DRY RUN")
    print(f"[{label}] tenant={tenant.slug} db={tenant.db_name} organization: {result['organization']}")
    if demo:
        print("  LOCAL DEMO ONLY: a loopback database on this machine, not the production tenant database.")
    elif how:
        print(f"  domain verification: {how}")
    for key in ("would_create", "created", "existing", "skipped"):
        if result.get(key):
            print(f"  {key}: {result[key]}")
    if result.get("handoff_file"):
        print(f"  credentials written to an access-restricted file: {result['handoff_file']}")
    if not a.apply:
        print("Nothing written. Re-run with --apply to create the accounts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
