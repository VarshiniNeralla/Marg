"""Verified-deletion support: which photo fingerprints does the server really hold?

The phone keeps every photo until the server proves it has an exact copy. "Exact copy" is decided by the SHA-256 of
the bytes, the same key the upload endpoint already de-duplicates on (``<org id>:<sha256>``).

Pure functions only (no database, no framework) so the rules are unit tested on their own.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Optional

# One session can hold hundreds of photos; this keeps a single request bounded.
MAX_FINGERPRINTS = 2000

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

# Job states in which the server has the bytes (spooled, stitching, or done).
_BYTES_HELD_STATUSES = {"pending", "processing", "completed"}


def dedup_key(org_id: str, sha256_hex: str) -> str:
    return f"{org_id}:{sha256_hex}"


def normalise_fingerprints(raw: Iterable[Any]) -> list[str]:
    """Lower-case, de-duplicate (keeping first-seen order) and drop anything that is not a SHA-256 hex digest."""
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        h = item.strip().lower()
        if _SHA256_RE.match(h) and h not in seen:
            seen.add(h)
            out.append(h)
    return out


def is_safely_held(dedup_present: bool, jobs: Iterable[dict[str, Any]]) -> bool:
    """True when the server holds these bytes: a finished upload record, or a stitch job that received them.

    A failed job counts only while it still retains the raw file, because that is the only case where the bytes
    are actually still on the server.
    """
    if dedup_present:
        return True
    for job in jobs:
        status = job.get("status")
        if status in _BYTES_HELD_STATUSES:
            return True
        if status == "failed" and job.get("rawRetained"):
            return True
    return False


def reconcile(
    fingerprints: list[str],
    dedup_hashes_present: set[str],
    jobs_by_hash: dict[str, list[dict[str, Any]]],
) -> dict[str, list[str]]:
    """Split the phone's list into the fingerprints the server holds and the ones it is missing."""
    present: list[str] = []
    missing: list[str] = []
    for h in fingerprints:
        if is_safely_held(h in dedup_hashes_present, jobs_by_hash.get(h, [])):
            present.append(h)
        else:
            missing.append(h)
    return {"present": present, "missing": missing}


def hash_of_key(key: Optional[str]) -> str:
    """The sha256 part of a ``<org id>:<sha256>`` key."""
    return (key or "").rsplit(":", 1)[-1]
