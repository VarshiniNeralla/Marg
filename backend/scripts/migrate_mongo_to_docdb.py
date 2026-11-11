"""Copy every SiteVision tenant database from MongoDB Atlas into Amazon DocumentDB.

Runs INSIDE the backend container (it already has the Atlas connection strings in its settings).
The source is only ever read. Nothing is deleted from either side unless --drop-target is given,
and that flag only touches the DocumentDB copy.

Environment (target - never printed):
    DOCDB_HOST          cluster endpoint
    DOCDB_USER / DOCDB_PASS
    DOCDB_CA_FILE       path to the Amazon RDS global CA bundle

Usage:
    python migrate_mongo_to_docdb.py                 # dry run: counts and index plan only
    python migrate_mongo_to_docdb.py --execute       # copy documents and indexes
    python migrate_mongo_to_docdb.py --execute --drop-target   # re-copy into an already-filled target
    python migrate_mongo_to_docdb.py --verify        # compare counts + sampled documents only
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from urllib.parse import quote_plus

from pymongo import MongoClient

from app.core.config import get_settings
from app.core.tenancy import TENANTS, multi_tenant_enabled

BATCH = 500
SAMPLE = 25
INDEX_OPTION_KEYS = ("unique", "sparse", "expireAfterSeconds", "partialFilterExpression")


def _target_client() -> MongoClient:
    host = os.environ["DOCDB_HOST"]
    user = quote_plus(os.environ["DOCDB_USER"])
    pwd = quote_plus(os.environ["DOCDB_PASS"])
    ca = os.environ["DOCDB_CA_FILE"]
    uri = (
        f"mongodb://{user}:{pwd}@{host}:27017/?tls=true&tlsCAFile={ca}"
        "&replicaSet=rs0&readPreference=primary&retryWrites=false"
    )
    return MongoClient(uri, serverSelectionTimeoutMS=15000)


def _sources() -> list[tuple[str, MongoClient, str]]:
    s = get_settings()
    out = []
    if multi_tenant_enabled():
        for t in TENANTS:
            uri = (getattr(s, t.mongo_uri_setting, "") or "").strip()
            if uri:
                out.append((t.slug, MongoClient(uri, serverSelectionTimeoutMS=15000), t.db_name))
    else:
        out.append(("default", MongoClient(s.MONGO_URI, serverSelectionTimeoutMS=15000), s.DB_NAME))
    return out


def _index_specs(coll) -> list[dict]:
    specs = []
    for idx in coll.list_indexes():
        if idx["name"] == "_id_":
            continue
        if "_fts" in idx["key"]:
            print(f"    (skipping text index {idx['name']}: the app never issues text queries)")
            continue
        spec = {"keys": list(idx["key"].items()), "name": idx["name"]}
        for k in INDEX_OPTION_KEYS:
            if k in idx:
                spec[k] = idx[k]
        specs.append(spec)
    return specs


def _copy_collection(src, dst, name: str, execute: bool) -> tuple[int, int]:
    s, d = src[name], dst[name]
    n_src = s.count_documents({})
    if not execute:
        return n_src, d.count_documents({})
    batch, copied = [], 0
    for doc in s.find({}).batch_size(BATCH):
        batch.append(doc)
        if len(batch) >= BATCH:
            d.insert_many(batch, ordered=False)
            copied += len(batch)
            batch = []
    if batch:
        d.insert_many(batch, ordered=False)
        copied += len(batch)
    for spec in _index_specs(s):
        opts = {k: v for k, v in spec.items() if k not in ("keys", "name")}
        d.create_index(spec["keys"], name=spec["name"], **opts)
    return n_src, d.count_documents({})


def _verify(src, dst, name: str) -> list[str]:
    problems = []
    n_s, n_d = src[name].count_documents({}), dst[name].count_documents({})
    if n_s != n_d:
        problems.append(f"{name}: count source={n_s} target={n_d}")
        return problems
    ids = [d["_id"] for d in src[name].find({}, {"_id": 1}).limit(5000)]
    for _id in random.sample(ids, min(SAMPLE, len(ids))):
        if src[name].find_one({"_id": _id}) != dst[name].find_one({"_id": _id}):
            problems.append(f"{name}: document {_id!s} differs")
    src_idx = {
        i["name"] for i in src[name].list_indexes() if "_fts" not in i["key"] and i["name"] != "_id_"
    }
    dst_idx = {i["name"] for i in dst[name].list_indexes()}
    if src_idx - dst_idx:
        problems.append(f"{name}: missing indexes {sorted(src_idx - dst_idx)}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--drop-target", action="store_true")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    target = _target_client()
    target.admin.command("ping")
    print("target reachable")
    failures: list[str] = []
    for slug, client, db_name in _sources():
        src, dst = client[db_name], target[db_name]
        names = sorted(n for n in src.list_collection_names() if not n.startswith("system."))
        print(f"\n== tenant {slug}: database {db_name}, {len(names)} collections")
        for name in names:
            if args.verify:
                failures += _verify(src, dst, name)
                continue
            existing = dst[name].count_documents({})
            if existing and not args.drop_target:
                print(f"  {name}: target already has {existing} documents - skipped (use --drop-target to redo)")
                continue
            if existing and args.drop_target and args.execute:
                dst[name].drop()
            n_src, n_dst = _copy_collection(src, dst, name, args.execute)
            print(f"  {name}: source={n_src} target={n_dst}{'' if args.execute else ' (dry run)'}")
            if args.execute:
                failures += _verify(src, dst, name)
    if failures:
        print("\nPROBLEMS:")
        for f in failures:
            print("  -", f)
        return 1
    print("\nOK" + ("" if (args.execute or args.verify) else " (dry run, nothing written)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
