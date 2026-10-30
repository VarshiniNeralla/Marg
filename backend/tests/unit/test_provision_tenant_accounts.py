"""Initial tenant account provisioning: validation, secure passwords, idempotency, handoff file."""
import importlib.util
import json
import pathlib

import mongomock
import pytest

from app.core.security import verify_password
from app.schemas.auth import _validate_password

_spec = importlib.util.spec_from_file_location(
    "provision_tenant_admin", pathlib.Path(__file__).resolve().parents[2] / "scripts" / "provision_tenant_admin.py")
prov = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prov)

ACCOUNTS = [
    {"email": "Admin@KohinoorPune.com", "name": "Kohinoor Admin", "role": "administrator"},
    {"email": "manager@kohinoorpune.com", "name": "Site Manager", "role": "manager"},
    {"email": "engineer@kohinoorpune.com", "name": "Field Engineer", "role": "field_engineer"},
]


def _run(db, tmp_path, accounts=ACCOUNTS, apply=True, name="creds.txt"):
    valid = prov.validate_accounts("kohinoor", accounts, True)
    return prov.provision(db, "kohinoor", "Kohinoor Developers", "kohinoor", valid, apply=apply,
                          handoff_path=tmp_path / name)


def test_validation_guards():
    ok = prov.validate_accounts("kohinoor", ACCOUNTS, True)
    assert [a["role"] for a in ok] == ["admin", "manager", "field_engineer"] and ok[0]["email"] == "admin@kohinoorpune.com"
    bad_cases = [
        ([{**ACCOUNTS[0], "email": "a@myhomeconstructions.com"}], True),                    # another tenant's domain
        ([{**ACCOUNTS[0], "email": "a@kohinoorpune.com.evil.com"}], True),
        ([{**ACCOUNTS[0], "name": ""}], True),                                               # no invented identities
        ([{**ACCOUNTS[0], "role": "super_admin"}], True),                                    # no privileged roles
        (ACCOUNTS[1:], True),                                                                # no administrator
        ([ACCOUNTS[0], {**ACCOUNTS[1], "role": "admin"}], True),                             # two administrators
        ([ACCOUNTS[0], ACCOUNTS[0]], True),                                                  # duplicate
        ([], True),
    ]
    for accounts, verified in bad_cases:
        with pytest.raises(ValueError):
            prov.validate_accounts("kohinoor", accounts, verified)
    with pytest.raises(ValueError):
        prov.validate_accounts("nobody", ACCOUNTS, True)


def test_domain_verification_is_not_required_but_can_be_demanded():
    """Tenant routing keys on the configured e-mail domain; a DNS ownership check is opt-in."""
    assert len(prov.validate_accounts("kohinoor", ACCOUNTS)) == 3                       # no flag, no TXT record: accepted
    assert len(prov.validate_accounts("kohinoor", ACCOUNTS, False, require_verified=False)) == 3
    with pytest.raises(ValueError):
        prov.validate_accounts("kohinoor", ACCOUNTS, False, require_verified=True)       # strict mode, nothing attested
    assert len(prov.validate_accounts("kohinoor", ACCOUNTS, True, require_verified=True)) == 3


def test_dry_run_writes_nothing(tmp_path):
    db = mongomock.MongoClient()["k"]
    r = _run(db, tmp_path, apply=False)
    assert db.users.count_documents({}) == 0 and db.organizations.count_documents({}) == 0
    assert len(r["would_create"]) == 3 and not list(tmp_path.iterdir())


def test_apply_creates_three_independent_accounts_with_unique_strong_passwords(tmp_path):
    db = mongomock.MongoClient()["k"]
    r = _run(db, tmp_path)
    users = {u["email"]: u for u in db.users.find({})}
    assert {u["role"] for u in users.values()} == {"admin", "manager", "field_engineer"} and len(users) == 3
    org = db.organizations.find_one({"slug": "kohinoor"})
    assert all(u["org_id"] == org["_id"] for u in users.values()) and org["owner_id"] == users["admin@kohinoorpune.com"]["_id"]
    rows = [ln.split("\t") for ln in (tmp_path / "creds.txt").read_text(encoding="utf-8").splitlines() if "\t" in ln]
    pws = {email: pw for _, email, pw in rows}
    assert len(rows) == 3 and len(set(pws.values())) == 3                                   # unique per account
    for email, pw in pws.items():
        assert len(pw) == 20 and _validate_password(pw) == pw                              # meets the app's policy
        assert email.split("@")[0] not in pw.lower()                                        # not derived from the identity
        assert verify_password(pw, users[email]["password_hash"])                           # stored hashed, and it matches
        assert pw not in users[email]["password_hash"]
    assert "password" not in json.dumps(r, default=str).lower().replace("handoff", "")      # summary carries no secrets
    assert not any(pw in json.dumps(r, default=str) for pw in pws.values())


def test_rerun_is_idempotent_and_never_resets_passwords(tmp_path):
    db = mongomock.MongoClient()["k"]
    _run(db, tmp_path)
    before = {u["email"]: u["password_hash"] for u in db.users.find({})}
    r = _run(db, tmp_path, name="creds2.txt")
    assert db.users.count_documents({}) == 3 and db.organizations.count_documents({}) == 1
    assert {u["email"]: u["password_hash"] for u in db.users.find({})} == before
    assert len(r["existing"]) == 3 and not r.get("created") and not (tmp_path / "creds2.txt").exists()


def test_partial_rerun_adds_only_the_missing_account_and_never_a_second_admin(tmp_path):
    db = mongomock.MongoClient()["k"]
    _run(db, tmp_path, accounts=ACCOUNTS[:2])
    r = _run(db, tmp_path, name="creds2.txt")
    assert db.users.count_documents({}) == 3 and [e for e, _ in r["created"]] == ["engineer@kohinoorpune.com"]
    other_admin = [{"email": "second@kohinoorpune.com", "name": "Second Admin", "role": "administrator"}]
    r2 = prov.provision(db, "kohinoor", "Kohinoor Developers", "kohinoor",
                        prov.validate_accounts("kohinoor", other_admin, True), apply=True, handoff_path=tmp_path / "c3.txt")
    assert db.users.count_documents({"role": "admin"}) == 1 and r2["skipped"]


def test_generated_passwords_are_random_and_avoid_identity():
    seen = {prov.generate_password("kohinoor", "admin") for _ in range(200)}
    assert len(seen) == 200
    assert all("kohinoor" not in p.lower() and "admin" not in p.lower() for p in seen)


def test_handoff_file_is_exclusive(tmp_path):
    f = tmp_path / "h.txt"
    prov.write_handoff(f, [{"role": "admin", "email": "a@kohinoorpune.com", "password": "x"}])
    with pytest.raises(FileExistsError):
        prov.write_handoff(f, [])


def test_cli_verification_is_opt_in(tmp_path, monkeypatch, capsys):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"org_name": "Kohinoor Developers", "org_slug": "kohinoor", "accounts": ACCOUNTS}), encoding="utf-8")
    monkeypatch.delenv("SV_TEST_NO_URI", raising=False)
    base = ["--tenant", "kohinoor", "--accounts-file", str(f), "--uri-env", "SV_TEST_NO_URI"]
    assert prov.main(base) == 2                                              # no verification needed: refused only for the missing URI
    assert "environment variable SV_TEST_NO_URI is not set" in capsys.readouterr().out
    assert prov.main(base + ["--require-domain-verification"]) == 2         # strict mode: refused for verification
    assert "not confirmed as verified" in capsys.readouterr().out
    assert prov.main(base + ["--require-domain-verification", "--domain-verified"]) == 2
    assert "environment variable SV_TEST_NO_URI is not set" in capsys.readouterr().out   # attested: passes verification


# ── LOCAL DEMO mode: loopback-only, never touches a production database ───────

DEMO_ACCOUNTS = [
    {"email": "admin@kohinoorpune.com", "name": "Kohinoor Demo Admin", "role": "administrator"},
    {"email": "manager@kohinoorpune.com", "name": "Kohinoor Demo Manager", "role": "manager"},
    {"email": "engineerdemo@kohinoorpune.com", "name": "Kohinoor Demo Field Engineer", "role": "field_engineer"},
]


@pytest.mark.parametrize("uri,ok", [
    ("mongodb://127.0.0.1:27997", True), ("mongodb://localhost:27017/x", True),
    ("mongodb+srv://u:p@sitevision.vvy4wzx.mongodb.net/SiteVisionKohinoor", False),
    ("mongodb://10.0.0.5:27017", False), ("mongodb://127.0.0.1.evil.com:27017", False), ("mongodb://evil.com@127.0.0.1.evil.com", False),
])
def test_local_demo_mode_refuses_anything_but_loopback(uri, ok):
    if ok:
        prov.require_loopback(uri)
    else:
        with pytest.raises(ValueError):
            prov.require_loopback(uri)


def test_local_demo_needs_no_verification_flag_but_keeps_every_other_rule():
    assert len(prov.validate_accounts("kohinoor", DEMO_ACCOUNTS, False, require_verified=False)) == 3
    with pytest.raises(ValueError):
        prov.validate_accounts("kohinoor", DEMO_ACCOUNTS, False, require_verified=True)  # strict mode still demands it
    for bad in ([{**DEMO_ACCOUNTS[0], "email": "admin@myhomeconstructions.com"}], [{**DEMO_ACCOUNTS[0], "role": "super_admin"}],
                [{**DEMO_ACCOUNTS[0], "name": ""}], DEMO_ACCOUNTS[1:]):
        with pytest.raises(ValueError):
            prov.validate_accounts("kohinoor", bad, False, require_verified=False)


def test_demo_provisioning_flags_accounts_and_names_the_file_as_local_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    (tmp_path / ".sitevision-secrets").mkdir()
    db = mongomock.MongoClient()["k"]
    valid = prov.validate_accounts("kohinoor", DEMO_ACCOUNTS, False, require_verified=False)
    r = prov.provision(db, "kohinoor", "Kohinoor Developers", "kohinoor", valid, apply=True, demo=True)
    assert all(u.get("is_demo") is True for u in db.users.find({})) and db.organizations.find_one({})["is_demo"] is True
    assert "LOCAL-DEMO-credentials" in r["handoff_file"] and pathlib.Path(r["handoff_file"]).parent == tmp_path / ".sitevision-secrets"
    # a user document carrying the extra flag still loads through the application's own model
    from app.models.user import UserDocument

    doc = db.users.find_one({"email": "admin@kohinoorpune.com"})
    assert UserDocument.from_mongo(dict(doc)).role == "admin"


def test_cli_local_demo_refuses_remote_hosts_and_missing_env(tmp_path, monkeypatch):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"org_name": "Kohinoor Developers", "org_slug": "kohinoor", "accounts": DEMO_ACCOUNTS}), encoding="utf-8")
    monkeypatch.delenv("SV_TEST_DEMO_URI", raising=False)
    assert prov.main(["--tenant", "kohinoor", "--accounts-file", str(f), "--local-demo-uri-env", "SV_TEST_DEMO_URI", "--apply"]) == 2
    monkeypatch.setenv("SV_TEST_DEMO_URI", "mongodb+srv://u:p@sitevision.vvy4wzx.mongodb.net/SiteVisionKohinoor")
    assert prov.main(["--tenant", "kohinoor", "--accounts-file", str(f), "--local-demo-uri-env", "SV_TEST_DEMO_URI", "--apply"]) == 2
    # the production path no longer needs verification; strict mode (opt-in) still refuses without it
    assert prov.main(["--tenant", "kohinoor", "--accounts-file", str(f), "--require-domain-verification"]) == 2


# ── Domain verification: DNS TXT record as a machine-checked alternative to attestation ──

TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90"


def test_domain_txt_verification_requires_the_exact_record():
    ok = lambda d: ['"v=spf1 -all"', f'"sitevision-verification={TOKEN}"']
    assert prov.verify_domain_via_dns("kohinoorpune.com", TOKEN, fetch=ok) is True
    assert prov.verify_domain_via_dns("kohinoorpune.com", TOKEN, fetch=lambda d: ["v=spf1 -all"]) is False
    assert prov.verify_domain_via_dns("kohinoorpune.com", TOKEN, fetch=lambda d: [f"sitevision-verification={TOKEN}x"]) is False
    assert prov.verify_domain_via_dns("kohinoorpune.com", "short", fetch=ok) is False           # weak tokens are rejected
    assert prov.verify_domain_via_dns("kohinoorpune.com", "", fetch=ok) is False

    def boom(d): raise OSError("dns down")
    assert prov.verify_domain_via_dns("kohinoorpune.com", TOKEN, fetch=boom) is False          # fails closed


def test_cli_txt_verification_gates_production_provisioning(tmp_path, monkeypatch):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"org_name": "Kohinoor Developers", "org_slug": "kohinoor", "accounts": DEMO_ACCOUNTS}), encoding="utf-8")
    monkeypatch.delenv("SV_TEST_NO_SUCH_URI", raising=False)
    args = ["--tenant", "kohinoor", "--accounts-file", str(f), "--uri-env", "SV_TEST_NO_SUCH_URI", "--apply", "--domain-txt-token", TOKEN]
    monkeypatch.setattr(prov, "_fetch_txt_google", lambda d: [])
    assert prov.main(args) == 2                                      # record absent -> refused before anything else
    monkeypatch.setattr(prov, "_fetch_txt_google", lambda d: [f"sitevision-verification={TOKEN}"])
    assert prov.main(args) == 2                                      # record present -> verification passes; refused only for the missing URI variable
    # and the refusal reason differs (proves verification passed)
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        prov.main(args)
    assert "environment variable SV_TEST_NO_SUCH_URI is not set" in buf.getvalue()


def test_uri_env_and_local_demo_are_mutually_exclusive(tmp_path):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"org_name": "K", "org_slug": "kohinoor", "accounts": DEMO_ACCOUNTS}), encoding="utf-8")
    assert prov.main(["--tenant", "kohinoor", "--accounts-file", str(f), "--uri-env", "X", "--local-demo-uri-env", "Y"]) == 2
