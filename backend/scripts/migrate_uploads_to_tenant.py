"""
Copy the legacy SiteVision/ uploads into the legacy tenant's folder (My Home), safely.

  SiteVision/<kind>/<org>/...      ->  myhome/<sites|users>/<kind>/<org>/...     (avatars go to users/)
  stitch-spool/, stitch_failures/  ->  myhome/_work/stitch-spool|stitch_failures  (private processing files)

Guarantees: ADDITIVE ONLY. The original files are never moved, modified or deleted; an existing destination is never
overwritten (identical bytes are skipped, different bytes stop the run); every copy is verified by SHA-256 before it is
renamed into place; no database record is changed.

Modes (all print a summary; `dry-run` and `verify` write only report files under --out):
  dry-run   build the manifest (source, destination, size, SHA-256, mtime, database references) and report conflicts
  apply     copy exactly what a reviewed manifest lists  (needs SV_UPLOAD_MIGRATION_CONFIRM=COPY-NO-DELETE)
  verify    re-hash source and copy, test readability (images are decoded), check every database reference resolves
  rollback  remove ONLY copies whose bytes still equal the manifest, never originals
            (dry run unless SV_UPLOAD_ROLLBACK_CONFIRM=REMOVE-COPIES)

Database references are read with read-only credentials from the environment (SV_SRC = virtual_tour,
SV_MY = SiteVisionMyHome) and are optional; nothing is ever written to either database.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import tenancy  # noqa: E402

LEGACY_ROOT = tenancy.LEGACY_STORAGE_ROOT
WORK_DIRS = {"stitch-spool": "stitch-spool", "stitch_failures": "stitch_failures"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


# ── references in the databases (read-only) ───────────────────────────────────

def _walk(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _walk(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from _walk(v)


def _local_rel(v: str) -> str | None:
    v = v.strip()
    m = re.search(r"/media/(.+?)(?:\?.*)?$", v)
    if m:
        return urllib.parse.unquote(m.group(1))
    if v.startswith("local/"):
        return v[6:]
    return None


def collect_references() -> dict[str, dict[str, dict[str, int]]]:
    """{lower-case relative path: {database: {collection: references}}}; empty if no credentials are set."""
    from pymongo import MongoClient

    out: dict[str, dict[str, dict[str, int]]] = {}
    for var, dbname in (("SV_SRC", "virtual_tour"), ("SV_MY", "SiteVisionMyHome")):
        uri = os.environ.get(var)
        if not uri:
            continue
        db = MongoClient(uri, serverSelectionTimeoutMS=20000)[dbname]
        for coll in db.list_collection_names():
            for doc in db[coll].find({}):
                for v in _walk(doc):
                    rel = _local_rel(v)
                    if rel:
                        bucket = out.setdefault(rel.replace("\\", "/").lower(), {}).setdefault(dbname, {})
                        bucket[coll] = bucket.get(coll, 0) + 1
    return out


# ── manifest ──────────────────────────────────────────────────────────────────

def build_manifest(uploads: Path, tenant_slug: str, org_id: str, include_work: bool, refs: dict) -> dict:
    legacy = tenancy.legacy_tenant()
    if legacy is None or legacy.slug != tenant_slug:
        raise SystemExit(f"REFUSED: only the legacy tenant ({legacy.slug if legacy else None}) owns SiteVision/ files")
    entries, skipped = [], []
    src_root = uploads / LEGACY_ROOT
    for p in sorted(src_root.rglob("*")) if src_root.is_dir() else []:
        if not p.is_file():
            continue
        rel = p.relative_to(uploads).as_posix()
        segs = rel.split("/")
        if len(segs) < 4 or segs[2] != org_id:
            skipped.append({"source": rel, "reason": "not under the legacy tenant's organization id"})
            continue
        dest = tenancy.legacy_to_tenant_relpath(rel)
        entries.append({"group": "media", "source": rel, "dest": dest, "kind": segs[1]})
    if include_work:
        for old, new in WORK_DIRS.items():
            d = uploads / old
            for p in sorted(d.rglob("*")) if d.is_dir() else []:
                if p.is_file():
                    entries.append({"group": "work", "source": p.relative_to(uploads).as_posix(),
                                    "dest": f"{tenant_slug}/_work/{new}/{p.relative_to(d).as_posix()}", "kind": "work"})
    for e in entries:
        src = uploads / e["source"]
        st = src.stat()
        e.update({"size": st.st_size, "mtime_utc": _iso(st.st_mtime), "sha256": sha256(src),
                  "database_references": refs.get(e["source"].lower(), {})})
        dst = uploads / e["dest"]
        if dst.exists():
            e["dest_state"] = "already-present-identical" if dst.stat().st_size == e["size"] and sha256(dst) == e["sha256"] else "CONFLICT-different-bytes"
        else:
            e["dest_state"] = "will-copy"
    return {"createdUtc": datetime.now(timezone.utc).isoformat(), "uploadsRoot": str(uploads), "tenant": tenant_slug, "orgId": org_id,
            "entries": entries, "skipped": skipped}


def write_reports(out: Path, manifest: dict, stem: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{stem}.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    with open(out / f"{stem}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["group", "kind", "source", "dest", "size", "sha256", "mtime_utc", "dest_state", "database_references"])
        for e in manifest["entries"]:
            w.writerow([e["group"], e["kind"], e["source"], e["dest"], e["size"], e["sha256"], e["mtime_utc"], e["dest_state"],
                        json.dumps(e["database_references"], sort_keys=True)])


def summarize(manifest: dict) -> str:
    e = manifest["entries"]
    total = sum(x["size"] for x in e)
    by = {}
    for x in e:
        g = by.setdefault((x["group"], x["kind"]), [0, 0])
        g[0] += 1
        g[1] += x["size"]
    states = {}
    for x in e:
        states[x["dest_state"]] = states.get(x["dest_state"], 0) + 1
    unref = sum(1 for x in e if x["group"] == "media" and not x["database_references"])
    lines = [f"files to migrate: {len(e)} | total {total / 1048576:.1f} MB | skipped (other organizations): {len(manifest['skipped'])}",
             "by group/kind: " + "; ".join(f"{k[0]}/{k[1]}: {v[0]} files {v[1] / 1048576:.1f} MB" for k, v in sorted(by.items())),
             f"destination states: {states}",
             f"media files with NO database reference (references loaded: {'yes' if any(x['database_references'] for x in e) else 'no'}): {unref}"]
    return "\n".join(lines)


# ── apply / verify / rollback ─────────────────────────────────────────────────

def apply(uploads: Path, manifest: dict, out: Path) -> int:
    if os.environ.get("SV_UPLOAD_MIGRATION_CONFIRM") != "COPY-NO-DELETE":
        print("REFUSED: set SV_UPLOAD_MIGRATION_CONFIRM=COPY-NO-DELETE to copy (additive: originals are never touched)")
        return 2
    if any(e["dest_state"].startswith("CONFLICT") for e in manifest["entries"]):
        print("REFUSED: the manifest reports destination conflicts; nothing copied")
        return 2
    log, copied, skipped, failed = [], 0, 0, 0
    for e in manifest["entries"]:
        src, dst = uploads / e["source"], uploads / e["dest"]
        res = "copied"
        try:
            if not src.is_file() or sha256(src) != e["sha256"]:
                raise RuntimeError("source changed since the manifest was built")
            if dst.exists():
                if sha256(dst) == e["sha256"]:
                    res = "skipped-identical-already-present"
                else:
                    raise RuntimeError("destination exists with different bytes; never overwritten")
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                part = dst.with_name(dst.name + ".part")
                if part.exists():
                    part.unlink()                      # only ever a leftover of THIS tool's interrupted copy
                shutil.copy2(src, part)                # copy2 keeps the modification time
                if sha256(part) != e["sha256"]:
                    part.unlink()
                    raise RuntimeError("checksum mismatch after copy")
                os.rename(part, dst)                   # fails (does not overwrite) if the destination appeared meanwhile
        except Exception as exc:                       # noqa: BLE001
            res = f"FAILED: {exc}"
        copied += res == "copied"
        skipped += res.startswith("skipped")
        failed += res.startswith("FAILED")
        log.append((e["source"], e["dest"], res))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "apply-log.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["source", "dest", "result"])
        w.writerows(log)
    print(f"apply: copied={copied} skipped-identical={skipped} failed={failed} (originals untouched)")
    return 1 if failed else 0


def verify(uploads: Path, manifest: dict, out: Path) -> int:
    from PIL import Image

    problems, ok = [], 0
    for e in manifest["entries"]:
        src, dst = uploads / e["source"], uploads / e["dest"]
        if not src.is_file():
            problems.append((e["source"], "original missing"))
            continue
        if not dst.is_file():
            problems.append((e["dest"], "copy missing"))
            continue
        if dst.stat().st_size != src.stat().st_size or sha256(dst) != e["sha256"] or sha256(src) != e["sha256"]:
            problems.append((e["dest"], "checksum/size differs"))
            continue
        try:
            with open(dst, "rb") as fh:
                while fh.read(1024 * 1024):
                    pass
            if dst.suffix.lower() in (".jpg", ".jpeg", ".png"):
                with Image.open(dst) as a, Image.open(src) as b:
                    a.load()
                    if a.size != b.size:
                        raise ValueError("decoded size differs")
        except Exception as exc:                          # noqa: BLE001
            problems.append((e["dest"], f"unreadable: {exc}"))
            continue
        ok += 1
    # database references: every referenced legacy file must still resolve, and so must its copy
    refs = [e for e in manifest["entries"] if e["database_references"]]
    unresolved = [e["source"] for e in refs if not (uploads / e["source"]).is_file() or not (uploads / e["dest"]).is_file()]
    listed = {e["dest"] for e in manifest["entries"]}
    tenant_dir = uploads / manifest["tenant"]
    extras = [p.relative_to(uploads).as_posix() for p in tenant_dir.rglob("*") if p.is_file() and p.relative_to(uploads).as_posix() not in listed] if tenant_dir.is_dir() else []
    result = {"entries": len(manifest["entries"]), "verified_identical_readable": ok, "problems": problems,
              "referenced_files": len(refs), "references_unresolved": unresolved, "extra_files_in_tenant_folder": extras}
    out.mkdir(parents=True, exist_ok=True)
    (out / "verify-result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"verify: {ok}/{len(manifest['entries'])} identical and readable | problems={len(problems)} | "
          f"database-referenced files={len(refs)} unresolved={len(unresolved)} | extra files in {manifest['tenant']}/: {len(extras)}")
    return 1 if problems or unresolved else 0


def rollback(uploads: Path, manifest: dict, out: Path) -> int:
    confirm = os.environ.get("SV_UPLOAD_ROLLBACK_CONFIRM") == "REMOVE-COPIES"
    removable, preserved = [], []
    for e in manifest["entries"]:
        dst = uploads / e["dest"]
        if dst.is_file() and dst.stat().st_size == e["size"] and sha256(dst) == e["sha256"]:
            removable.append(dst)
        elif dst.exists():
            preserved.append(e["dest"])                    # changed since the copy: keep it
    if confirm:
        for p in removable:
            p.unlink()
    print(("EXECUTED" if confirm else "DRY RUN (nothing removed)") + f": would remove {len(removable)} unchanged copies; "
          f"preserved {len(preserved)} changed files; originals are never touched")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["dry-run", "apply", "verify", "rollback"])
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--tenant", default="myhome")
    ap.add_argument("--org-id", required=True, help="the legacy tenant's organization id (the 3rd segment of SiteVision/<kind>/<org>/...)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default="", help="manifest.json from a reviewed dry run (required for apply/verify/rollback)")
    ap.add_argument("--no-work", action="store_true", help="do not include stitch-spool / stitch_failures")
    ap.add_argument("--no-refs", action="store_true", help="skip reading database references")
    a = ap.parse_args(argv)
    uploads, out = Path(a.uploads), Path(a.out)
    if a.mode == "dry-run":
        refs = {} if a.no_refs else collect_references()
        manifest = build_manifest(uploads, a.tenant, a.org_id, not a.no_work, refs)
        write_reports(out, manifest, "manifest")
        print(summarize(manifest))
        print(f"manifest written to {out}\\manifest.json / manifest.csv (nothing copied)")
        return 2 if any(e["dest_state"].startswith("CONFLICT") for e in manifest["entries"]) else 0
    if not a.manifest:
        print("REFUSED: --manifest (from a reviewed dry run) is required")
        return 2
    manifest = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    return {"apply": apply, "verify": verify, "rollback": rollback}[a.mode](uploads, manifest, out)


if __name__ == "__main__":
    raise SystemExit(main())
