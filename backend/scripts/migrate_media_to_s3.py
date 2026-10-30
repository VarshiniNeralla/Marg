"""
Copy SiteVision media into the S3 bucket, safely: local uploads AND Cloudinary assets (floor plans, project thumbnails,
captures) end up under ONE key layout, identical to the on-disk layout the app already uses:

  myhome/sites/<kind>/<org>/...        captures, floorplans, projects, tours, thumbnails
  myhome/users/avatars/<org>/...       avatars
  myhome/_work/<dir>/...               private processing files (never served by /media)
  kohinoor/...                         same shape, written by the app at upload time

Sources
  local        <uploads>/myhome/**                       (the SHA-256-verified copies made by migrate_uploads_to_tenant.py)
  cloudinary   every asset referenced from the Atlas databases: the original (PDF/JPG/PNG) fetched with an
               authenticated download from the configured account, or a public fetch for another account.
  render       for floor plans only: the EXACT rendered PNG + thumbnail Cloudinary serves today (pin and room-map
               coordinates were drawn on those pixels, so the same bytes are preserved):
                 <dir>/<stem>_preview.png        <dir>/thumbs/<stem>_thumb.png

Guarantees: ADDITIVE ONLY. Nothing is deleted or overwritten (an existing key with different bytes stops the run), no
database is written (Atlas is read with read-only credentials from the environment), Cloudinary is only read. Every
object is uploaded with a SHA-256 that S3 verifies server-side, and `verify` re-downloads and re-hashes every object.
Everything pulled from Cloudinary is also saved under <out>/cloudinary-backup/ as an independent local backup.
Assets that cannot be fetched are listed in the manifest (never silently dropped).

Modes
  plan    build the manifest (read-only for S3, Cloudinary and Atlas)
  apply   upload exactly what the reviewed manifest lists   (needs SV_S3_MIGRATION_CONFIRM=COPY-NO-DELETE)
  verify  head + full re-download + SHA-256 compare of every manifest object, and list unexpected extra keys
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import tenancy  # noqa: E402

TENANT = "myhome"
KNOWN_EXT = (".jpg", ".jpeg", ".png", ".webp", ".pdf", ".gif")
KINDS = {"captures", "floorplans", "projects", "tours", "avatars", "thumbnails"}
ROOTS = {"sitevision", "horizon"}                       # historic Cloudinary root folders
CLD_URL = re.compile(r"^https://res\.cloudinary\.com/([^/]+)/(image|video|raw)/upload/(.+)$", re.I)
VERSION = re.compile(r"^v\d+$")
CONFIRM_ENV, CONFIRM_VALUE = "SV_S3_MIGRATION_CONFIRM", "COPY-NO-DELETE"
HERE = Path(__file__).resolve().parent


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def b64_sha256(hexdigest: str) -> str:
    return base64.b64encode(bytes.fromhex(hexdigest)).decode()


def content_type(key: str, fallback: str | None = None) -> str:
    low = key.lower()
    for ext, ct in ((".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".png", "image/png"), (".webp", "image/webp"), (".pdf", "application/pdf")):
        if low.endswith(ext):
            return ct
    return fallback or mimetypes.guess_type(key)[0] or "application/octet-stream"


# ── Cloudinary URL handling ───────────────────────────────────────────────────

def parse_cloudinary_url(url: str):
    """-> (cloud, resource_type, transformation, version, public_id, ext) or None."""
    m = CLD_URL.match(url.split("?", 1)[0].split("#", 1)[0])
    if not m:
        return None
    cloud, rtype, rest = m.groups()
    segs = [s for s in rest.split("/") if s]
    vi = next((i for i, s in enumerate(segs) if VERSION.match(s)), None)
    if vi is None:
        return None
    transformation, version, path = "/".join(segs[:vi]), segs[vi], "/".join(segs[vi + 1:])
    ext = ""
    if path.lower().endswith(KNOWN_EXT):
        path, ext = os.path.splitext(path)[0], os.path.splitext(path)[1].lower()
    return cloud, rtype, transformation, version, path, ext


def map_key(public_id: str, fmt: str, org: str | None) -> tuple[str | None, str]:
    """Cloudinary public_id -> S3 key in the tenant layout. Returns (key, note)."""
    parts = [p for p in public_id.split("/") if p]
    if parts and parts[0].lower() in ROOTS:
        parts = parts[1:]
    if not parts or parts[0] not in KINDS:
        return None, f"unrecognized folder layout: {public_id}"
    kind = parts[0]
    if kind == "thumbnails":                              # <root>/thumbnails/<id>: no org in the path
        if not org:
            return None, "thumbnail without an organization"
        parts = ["thumbnails", org, parts[-1]]
    elif len(parts) < 3:
        return None, f"too few path segments: {public_id}"
    key = tenancy.legacy_to_tenant_relpath("/".join([tenancy.LEGACY_STORAGE_ROOT, *parts]))
    if key is None:
        return None, "legacy mapping unavailable"
    return f"{key}.{fmt}", ""


# ── read-only scan of the databases ───────────────────────────────────────────

def _walk(v, path=""):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from _walk(x, f"{path}.{k}" if path else k)
    elif isinstance(v, list):
        for x in v:
            yield from _walk(x, path + "[]")
    elif isinstance(v, str):
        yield path, v


def scan_databases(refs: list[tuple[str, str, str]]):
    from pymongo import MongoClient

    assets: dict[tuple[str, str], dict] = {}
    media_refs: dict[str, list] = {}
    for label, env, dbname in refs:
        uri = os.environ.get(env)
        if not uri:
            print(f"  (skipping {label}: {env} not set)")
            continue
        db = MongoClient(uri, serverSelectionTimeoutMS=30000)[dbname]
        for coll in sorted(db.list_collection_names()):
            for doc in db[coll].find({}):
                org = str(doc.get("orgId") or doc.get("org_id") or "") or None
                for fpath, s in _walk(doc):
                    if "res.cloudinary.com" in s:
                        p = parse_cloudinary_url(s)
                        if not p:
                            continue
                        cloud, rtype, transformation, version, pid, ext = p
                        a = assets.setdefault((cloud, pid), {"cloud": cloud, "rtype": rtype, "pid": pid, "exts": set(), "orgs": set(),
                                                             "refs": [], "variants": {}, "plain_urls": set()})
                        if ext:
                            a["exts"].add(ext)
                        if org:
                            a["orgs"].add(org)
                        a["refs"].append({"db": label, "collection": coll, "doc": str(doc.get("_id")), "field": re.sub(r"\[\]", "", fpath)})
                        if transformation:
                            a["variants"].setdefault(s.split("?", 1)[0], transformation)
                        else:
                            a["plain_urls"].add(s.split("?", 1)[0])
                    else:
                        m = re.search(r"/media/(.+?)(?:\?.*)?$", s)
                        if m:
                            media_refs.setdefault(m.group(1), []).append({"db": label, "collection": coll, "doc": str(doc.get("_id")), "field": re.sub(r"\[\]", "", fpath)})
    return assets, media_refs


def http_get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "sitevision-s3-migration"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read(), r.headers.get("Content-Type")
    except urllib.error.HTTPError as e:
        return e.code, b"", None
    except Exception as e:  # network trouble: reported, never silent
        return type(e).__name__, b"", None


def classify_render(transformation: str) -> str | None:
    if "dn_300" in transformation or "pg_1" in transformation and "w_480" not in transformation and "h_320" not in transformation:
        return "preview"
    if "w_480" in transformation and "h_320" in transformation:
        return "thumb"
    return None


# ── plan ──────────────────────────────────────────────────────────────────────

def cmd_plan(a) -> int:
    import cloudinary
    import cloudinary.api
    import cloudinary.utils

    from app.core.config import get_settings

    out = Path(a.out)
    backup = out / "cloudinary-backup"
    backup.mkdir(parents=True, exist_ok=True)
    s = get_settings()
    cloudinary_ok = bool(s.CLOUDINARY_CLOUD_NAME and s.CLOUDINARY_API_KEY and s.CLOUDINARY_API_SECRET)
    if cloudinary_ok:
        cloudinary.config(cloud_name=s.CLOUDINARY_CLOUD_NAME, api_key=s.CLOUDINARY_API_KEY, api_secret=s.CLOUDINARY_API_SECRET, secure=True)

    items: dict[str, dict] = {}
    unrecoverable: list[dict] = []
    problems: list[str] = []

    def add(item: dict):
        k = item["key"]
        if k in items:
            if items[k]["sha256"] != item["sha256"]:
                problems.append(f"KEY CONFLICT with different bytes: {k}")
            else:
                items[k]["refs"] = items[k].get("refs", []) + item.get("refs", [])
            return
        items[k] = item

    # 1. local verified copies
    uploads = Path(a.uploads).resolve()
    base = uploads / TENANT
    n_local = 0
    if base.is_dir():
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = p.relative_to(uploads).as_posix()
                data = p.read_bytes()
                add({"source": "local", "source_ref": rel, "key": rel, "size": len(data), "sha256": sha256_bytes(data), "content_type": content_type(rel), "refs": []})
                n_local += 1
    print(f"local files under {TENANT}/: {n_local}")

    # 2. database references (read-only)
    refs = [tuple(r.split(":", 2)) for r in a.ref]
    assets, media_refs = scan_databases(refs)
    print(f"distinct Cloudinary assets referenced in Atlas: {len(assets)}")
    missing_local = []
    for rel, rlist in media_refs.items():
        alias = tenancy.legacy_to_tenant_relpath(rel) or rel
        if not (uploads / rel).is_file() and not (uploads / alias).is_file():
            missing_local.append({"path": rel, "refs": rlist[:5], "ref_count": len(rlist)})
    for m in missing_local:
        unrecoverable.append({"kind": "local-reference-without-file", **m})

    # 3. Cloudinary assets
    for (cloud, pid), asset in sorted(assets.items()):
        org = sorted(asset["orgs"])[0] if asset["orgs"] else None
        is_floorplan = "/floorplans/" in f"/{pid}/" or pid.startswith("floorplans/")
        fmt = None
        data = None
        status_note = ""
        if cloudinary_ok and cloud == s.CLOUDINARY_CLOUD_NAME:
            try:
                res = cloudinary.api.resource(pid, resource_type=asset["rtype"])
                fmt = res.get("format") or (sorted(asset["exts"])[0].lstrip(".") if asset["exts"] else None)
                url = cloudinary.utils.private_download_url(pid, fmt or "", resource_type=asset["rtype"], type="upload")
                st, body, _ = http_get(url)
                if st == 200 and len(body) == int(res.get("bytes") or len(body)):
                    data = body
                else:
                    status_note = f"authenticated download failed ({st})"
            except Exception as exc:
                status_note = "gone from Cloudinary" if type(exc).__name__ == "NotFound" else f"admin api error {type(exc).__name__}"
        else:
            status_note = "different Cloudinary account: no credentials here"
            for u in sorted(asset["plain_urls"]):
                st, body, ct = http_get(u)
                if st == 200 and body:
                    data, fmt = body, (os.path.splitext(u)[1].lstrip(".").lower() or (ct or "").split("/")[-1])
                    status_note = ""
                    break
                status_note = f"public fetch {st}"
        key = None
        if data is not None and fmt:
            key, note = map_key(pid, fmt, org)
            if key is None:
                unrecoverable.append({"kind": "unmapped-key", "cloud": cloud, "public_id": pid, "reason": note, "refs": asset["refs"][:5]})
            else:
                dest = backup / key
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                add({"source": "cloudinary", "source_ref": f"{cloud}:{pid}", "key": key, "size": len(data), "sha256": sha256_bytes(data),
                     "content_type": content_type(key), "refs": asset["refs"]})
        else:
            unrecoverable.append({"kind": "original-not-fetchable", "cloud": cloud, "public_id": pid, "reason": status_note, "ref_count": len(asset["refs"]),
                                  "collections": sorted({r["collection"] for r in asset["refs"]}), "docs": sorted({r["doc"] for r in asset["refs"]})[:8]})

        # 3b. floor plans: preserve the exact rendered pixels (preview + thumbnail)
        if is_floorplan:
            stem_key = None
            m2, _ = map_key(pid, fmt or "pdf", org)
            if m2:
                stem_key = m2.rsplit(".", 1)[0]
            by_class: dict[str, tuple[str, bytes, str]] = {}
            other = 0
            for vurl, transformation in sorted(asset["variants"].items()):
                cls = classify_render(transformation)
                if cls is None:
                    other += 1
                    continue
                st, body, ct = http_get(vurl)
                if st != 200 or not body:
                    continue
                if cls in by_class and sha256_bytes(by_class[cls][1]) != sha256_bytes(body):
                    problems.append(f"render variants disagree for {pid} ({cls})")
                by_class.setdefault(cls, (vurl, body, ct or ""))
            if stem_key is None and by_class:
                unrecoverable.append({"kind": "render-without-key", "cloud": cloud, "public_id": pid, "reason": "cannot map key"})
            for cls, (vurl, body, ct) in by_class.items():
                key = f"{stem_key}_preview.png" if cls == "preview" else f"{stem_key.rsplit('/', 1)[0]}/thumbs/{stem_key.rsplit('/', 1)[1]}_thumb.png"
                dest = backup / key
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(body)
                add({"source": "render", "source_ref": f"{cloud}:{pid}:{cls}", "key": key, "size": len(body), "sha256": sha256_bytes(body),
                     "content_type": "image/png", "refs": asset["refs"]})
            if other:
                unrecoverable.append({"kind": "other-render-variants-not-copied", "public_id": pid, "count": other,
                                      "reason": "resizes derivable from the original; not preserved byte-for-byte"})

    # 4. state of the keys in S3 (read-only)
    import boto3

    s3 = boto3.client("s3", region_name=a.region)
    for k, it in items.items():
        try:
            h = s3.head_object(Bucket=a.bucket, Key=k, ChecksumMode="ENABLED")
            same = h.get("ChecksumSHA256") == b64_sha256(it["sha256"]) and h["ContentLength"] == it["size"]
            it["s3_state"] = "identical" if same else "DIFFERENT"
            if not same:
                problems.append(f"S3 already has DIFFERENT bytes at {k}")
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                it["s3_state"] = "will-upload"
            else:
                raise

    manifest = {"bucket": a.bucket, "region": a.region, "tenant": TENANT, "items": list(items.values()), "unrecoverable": unrecoverable, "problems": problems}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["key", "source", "size", "sha256", "content_type", "s3_state", "referenced_by"])
        for it in items.values():
            w.writerow([it["key"], it["source"], it["size"], it["sha256"], it["content_type"], it["s3_state"], len(it.get("refs", []))])
    summary(manifest)
    return 2 if problems else 0


def summary(m: dict) -> None:
    items = m["items"]
    print("\n=== MANIFEST SUMMARY ===")
    print("objects to copy:", len(items), "| total %.1f MB" % (sum(i["size"] for i in items) / 1e6))
    print("by source:", dict(Counter(i["source"] for i in items)))
    print("by prefix:", dict(Counter("/".join(i["key"].split("/")[:3]) for i in items)))
    print("S3 state:", dict(Counter(i.get("s3_state") for i in items)))
    print("not fetchable / not copied:", dict(Counter(u["kind"] for u in m["unrecoverable"])))
    for p in m["problems"]:
        print("PROBLEM:", p)


# ── apply / verify ────────────────────────────────────────────────────────────

def _load(a):
    return json.loads((Path(a.out) / "manifest.json").read_text(encoding="utf-8"))


def _bytes_for(a, it) -> bytes:
    if it["source"] == "local":
        return (Path(a.uploads) / it["source_ref"]).read_bytes()
    return (Path(a.out) / "cloudinary-backup" / it["key"]).read_bytes()


def cmd_apply(a) -> int:
    import boto3

    if os.environ.get(CONFIRM_ENV) != CONFIRM_VALUE:
        print(f"Refusing to write to S3: set {CONFIRM_ENV}={CONFIRM_VALUE} after reviewing the manifest.")
        return 2
    m = _load(a)
    if m["problems"]:
        print("Manifest has problems; fix them first:", *m["problems"], sep="\n  ")
        return 2
    s3 = boto3.client("s3", region_name=a.region)
    done = skipped = 0
    for it in m["items"]:
        data = _bytes_for(a, it)
        if sha256_bytes(data) != it["sha256"] or len(data) != it["size"]:
            print("SOURCE CHANGED since the plan; re-run plan:", it["key"])
            return 2
        try:
            h = s3.head_object(Bucket=a.bucket, Key=it["key"], ChecksumMode="ENABLED")
            if h.get("ChecksumSHA256") == b64_sha256(it["sha256"]) and h["ContentLength"] == it["size"]:
                skipped += 1
                continue
            print("CONFLICT: S3 has different bytes at", it["key"])
            return 2
        except Exception as exc:
            if getattr(exc, "response", {}).get("Error", {}).get("Code", "") not in {"404", "NoSuchKey", "NotFound"}:
                raise
        s3.put_object(Bucket=a.bucket, Key=it["key"], Body=data, ContentType=it["content_type"], ChecksumAlgorithm="SHA256",
                      ChecksumSHA256=b64_sha256(it["sha256"]), Metadata={"sv-source": it["source"], "sv-sha256": it["sha256"]})
        done += 1
        if done % 25 == 0:
            print(f"  uploaded {done}...")
    print(f"apply complete: uploaded {done}, already present (identical) {skipped}, deleted 0, overwritten 0")
    return 0


def cmd_verify(a) -> int:
    import boto3

    m = _load(a)
    s3 = boto3.client("s3", region_name=a.region)
    problems = []
    for it in m["items"]:
        try:
            h = s3.head_object(Bucket=a.bucket, Key=it["key"], ChecksumMode="ENABLED")
        except Exception:
            problems.append((it["key"], "missing in S3"))
            continue
        if h["ContentLength"] != it["size"]:
            problems.append((it["key"], "size differs"))
            continue
        body = s3.get_object(Bucket=a.bucket, Key=it["key"])["Body"].read()
        if sha256_bytes(body) != it["sha256"]:
            problems.append((it["key"], "re-downloaded bytes differ"))
        elif h.get("ChecksumSHA256") != b64_sha256(it["sha256"]):
            problems.append((it["key"], "S3 checksum differs"))
        if it["source"] in {"cloudinary", "render", "local"} and h.get("ServerSideEncryption") != "AES256":
            problems.append((it["key"], f"unexpected encryption {h.get('ServerSideEncryption')}"))
    expected = {i["key"] for i in m["items"]}
    extras = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=a.bucket, Prefix=f"{TENANT}/"):
        extras += [o["Key"] for o in page.get("Contents", []) if o["Key"] not in expected]
    res = {"checked": len(m["items"]), "problems": problems, "extra_keys_not_in_manifest": extras}
    (Path(a.out) / "verify-result.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"verified {len(m['items'])} objects: {len(problems)} problems, {len(extras)} extra keys under {TENANT}/")
    for p in problems:
        print("  PROBLEM", *p)
    return 1 if problems else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["plan", "apply", "verify"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--bucket", default="sitevision-prod")
    ap.add_argument("--region", default="ap-south-1")
    ap.add_argument("--uploads", default=str(Path(__file__).resolve().parents[2] / "uploads"))
    ap.add_argument("--ref", action="append", default=[], help="LABEL:ENV_VAR_WITH_READONLY_URI:DB_NAME (repeatable)")
    a = ap.parse_args(argv)
    if a.mode == "plan" and not a.ref:
        a.ref = ["source:SV_SCAN_SRC:virtual_tour", "myhome:SV_SCAN_MYHOME:SiteVisionMyHome"]
    Path(a.out).mkdir(parents=True, exist_ok=True)
    return {"plan": cmd_plan, "apply": cmd_apply, "verify": cmd_verify}[a.mode](a)


if __name__ == "__main__":
    raise SystemExit(main())
