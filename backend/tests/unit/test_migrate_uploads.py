"""Legacy SiteVision/ -> <tenant>/ upload migration tool: additive, verified, reversible."""
import hashlib
import importlib.util
import json
import pathlib

import pytest
from PIL import Image

_spec = importlib.util.spec_from_file_location(
    "migrate_uploads_to_tenant", pathlib.Path(__file__).resolve().parents[2] / "scripts" / "migrate_uploads_to_tenant.py")
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

ORG, OTHER = "6a3a28dd0915399ba5cb6922", "6a2f80c6c396ab6a29e7218d"


def _jpg(path, color):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 32), color).save(path, "JPEG")


@pytest.fixture
def tree(tmp_path):
    up = tmp_path / "uploads"
    _jpg(up / "SiteVision" / "captures" / ORG / "abc_pano.jpg", (200, 10, 10))
    _jpg(up / "SiteVision" / "captures" / ORG / "thumbs" / "abc_pano_thumb.jpg", (10, 200, 10))
    _jpg(up / "SiteVision" / "avatars" / ORG / "me.jpg", (10, 10, 200))
    _jpg(up / "SiteVision" / "captures" / OTHER / "demo.jpg", (1, 2, 3))                       # another organization: not migrated
    (up / "stitch-spool").mkdir(parents=True)
    (up / "stitch-spool" / "raw.insp").write_bytes(b"raw-bytes")
    (up / "stitch_failures").mkdir()
    (up / "stitch_failures" / "fail.json").write_text("{}", encoding="utf-8")
    return up, tmp_path / "out"


def _hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*") if p.is_file()}


def _args(up, out):
    return ["--uploads", str(up), "--org-id", ORG, "--out", str(out), "--manifest", str(out / "manifest.json")]


def _dry(up, out):
    assert mig.main(["dry-run", "--uploads", str(up), "--org-id", ORG, "--out", str(out), "--no-refs"]) == 0
    return json.loads((out / "manifest.json").read_text(encoding="utf-8"))


def test_dry_run_maps_paths_skips_other_orgs_and_writes_nothing_to_uploads(tree):
    up, out = tree
    before = _hashes(up)
    m = _dry(up, out)
    assert _hashes(up) == before                                                           # the uploads folder is untouched
    dest = {e["source"]: e["dest"] for e in m["entries"]}
    assert dest[f"SiteVision/captures/{ORG}/abc_pano.jpg"] == f"myhome/sites/captures/{ORG}/abc_pano.jpg"
    assert dest[f"SiteVision/captures/{ORG}/thumbs/abc_pano_thumb.jpg"] == f"myhome/sites/captures/{ORG}/thumbs/abc_pano_thumb.jpg"
    assert dest[f"SiteVision/avatars/{ORG}/me.jpg"] == f"myhome/users/avatars/{ORG}/me.jpg"       # avatars -> users/
    assert dest["stitch-spool/raw.insp"] == "myhome/_work/stitch-spool/raw.insp"                  # private work area
    assert dest["stitch_failures/fail.json"] == "myhome/_work/stitch_failures/fail.json"
    assert [s["source"] for s in m["skipped"]] == [f"SiteVision/captures/{OTHER}/demo.jpg"]
    assert all(e["sha256"] and e["size"] > 0 and e["dest_state"] == "will-copy" for e in m["entries"])
    assert (out / "manifest.csv").is_file()


def test_apply_requires_explicit_confirmation(tree, monkeypatch):
    up, out = tree
    _dry(up, out)
    monkeypatch.delenv("SV_UPLOAD_MIGRATION_CONFIRM", raising=False)
    assert mig.main(["apply", *_args(up, out)]) == 2
    assert not (up / "myhome").exists()


def test_apply_copies_verifies_and_never_touches_originals(tree, monkeypatch):
    up, out = tree
    _dry(up, out)
    originals = _hashes(up)
    monkeypatch.setenv("SV_UPLOAD_MIGRATION_CONFIRM", "COPY-NO-DELETE")
    assert mig.main(["apply", *_args(up, out)]) == 0
    after = _hashes(up)
    assert all(after[k] == v for k, v in originals.items())                                     # every original byte-identical
    copies = {k: v for k, v in after.items() if k.startswith("myhome/")}
    assert len(copies) == 5 and not any(k.endswith(".part") for k in after)
    for src_rel, h in originals.items():
        if src_rel.startswith(f"SiteVision/captures/{OTHER}"):
            continue
        dest = mig.tenancy.legacy_to_tenant_relpath(src_rel) if src_rel.startswith("SiteVision/") else "myhome/_work/" + src_rel
        assert after[dest] == h                                                                  # copy == original
    s = up / "SiteVision" / "captures" / ORG / "abc_pano.jpg"
    d = up / "myhome" / "sites" / "captures" / ORG / "abc_pano.jpg"
    assert abs(s.stat().st_mtime - d.stat().st_mtime) < 2                                        # modification time preserved
    assert mig.main(["verify", *_args(up, out)]) == 0                                            # identical, decodable, nothing extra
    assert mig.main(["apply", *_args(up, out)]) == 0                                             # idempotent rerun
    assert _hashes(up) == after


def test_existing_different_destination_is_a_conflict_and_is_never_overwritten(tree, monkeypatch):
    up, out = tree
    dst = up / "myhome" / "sites" / "captures" / ORG / "abc_pano.jpg"
    _jpg(dst, (9, 9, 9))
    keep = dst.read_bytes()
    assert mig.main(["dry-run", "--uploads", str(up), "--org-id", ORG, "--out", str(out), "--no-refs"]) == 2
    monkeypatch.setenv("SV_UPLOAD_MIGRATION_CONFIRM", "COPY-NO-DELETE")
    assert mig.main(["apply", *_args(up, out)]) == 2
    assert dst.read_bytes() == keep and not (up / "myhome" / "users").exists()                   # nothing copied at all


def test_verify_detects_a_tampered_or_missing_copy(tree, monkeypatch):
    up, out = tree
    _dry(up, out)
    monkeypatch.setenv("SV_UPLOAD_MIGRATION_CONFIRM", "COPY-NO-DELETE")
    mig.main(["apply", *_args(up, out)])
    copy = up / "myhome" / "sites" / "captures" / ORG / "abc_pano.jpg"
    _jpg(copy, (1, 1, 1))
    assert mig.main(["verify", *_args(up, out)]) == 1
    copy.unlink()
    assert mig.main(["verify", *_args(up, out)]) == 1
    assert json.loads((out / "verify-result.json").read_text())["problems"][0][1] == "copy missing"


def test_rollback_removes_only_unchanged_copies_and_never_originals(tree, monkeypatch):
    up, out = tree
    _dry(up, out)
    monkeypatch.setenv("SV_UPLOAD_MIGRATION_CONFIRM", "COPY-NO-DELETE")
    mig.main(["apply", *_args(up, out)])
    originals = {k: v for k, v in _hashes(up).items() if not k.startswith("myhome/")}
    changed = up / "myhome" / "users" / "avatars" / ORG / "me.jpg"
    _jpg(changed, (5, 5, 5))                                                                     # edited after the copy
    monkeypatch.delenv("SV_UPLOAD_ROLLBACK_CONFIRM", raising=False)
    mig.main(["rollback", *_args(up, out)])
    assert len([k for k in _hashes(up) if k.startswith("myhome/")]) == 5                         # dry run removed nothing
    monkeypatch.setenv("SV_UPLOAD_ROLLBACK_CONFIRM", "REMOVE-COPIES")
    mig.main(["rollback", *_args(up, out)])
    left = [k for k in _hashes(up) if k.startswith("myhome/")]
    assert left == ["myhome/users/avatars/" + ORG + "/me.jpg"]                                   # the changed file is preserved
    assert {k: v for k, v in _hashes(up).items() if not k.startswith("myhome/")} == originals


def test_only_the_legacy_tenant_may_receive_sitevision_files(tree):
    up, out = tree
    with pytest.raises(SystemExit):
        mig.main(["dry-run", "--uploads", str(up), "--tenant", "kohinoor", "--org-id", ORG, "--out", str(out), "--no-refs"])
