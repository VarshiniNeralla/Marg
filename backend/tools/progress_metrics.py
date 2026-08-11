#!/usr/bin/env python3
"""
Automatic provable-error metrics for Flat Finishing Works snapshots (T2).

Runs against construction_progress_snapshots already in Mongo — no new
inference, no new captures, no human labels. Use this to produce the machine
"before" baseline before T4–T11 land, and to --compare after each fix.

Usage (from backend/ with venv active and .env loaded):

  python tools/progress_metrics.py --all-floors
  python tools/progress_metrics.py --floor-id t72519-f1-f72520
  python tools/progress_metrics.py --all-floors --compare tests/fixtures/progress_metrics/baseline.json

Outputs:
  tests/fixtures/progress_metrics/report_<timestamp>.json
  a readable console table of M1–M6
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

# Allow running as `python tools/progress_metrics.py` from backend/
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.services.construction_progress_providers import COMPLETE_THRESHOLD  # noqa: E402
from app.services.construction_progress_providers.vllm_provider import (  # noqa: E402
    _MIN_EVIDENCE_CONFIDENCE,
    _MIN_ROOM_CONFIDENCE,
)
from app.services.flat_finishing_rosters import _LAYOUT_3BHK, _LAYOUT_4BHK  # noqa: E402
from app.services.panorama_views import RIG_VERSION  # noqa: E402

_COLLECTION = "construction_progress_snapshots"
_FIXTURE_DIR = _BACKEND / "tests" / "fixtures" / "progress_metrics"

# Wall-finish chain used until precedence.py (T8) exists. Keep IDs identical
# to activities.py so M2 matches the live taxonomy.
_WALL_FINISH_CHAIN: tuple[str, ...] = (
    "flat.wall_punning_4",
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
    "flat.primer_1st_coat_paint_27",
    "flat.final_coat_paint_37",
)

# Ambiguous room-type applicability (M3). Tokens derived from roster layouts —
# match if the room name contains the token (case-insensitive).
_APPLICABILITY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("flat.toilet_grouting_30", ("toilet", "m. toilet")),
    ("flat.kitchen_bracket_fixing_granite_fixing_dado_19", ("kitchen",)),
    ("flat.balcony_glass_railing_35", ("balcony",)),
    ("flat.ms_railing_for_utility_13", ("utility",)),
)

_NEAR_ZERO = 50.0  # upstream "near zero" for sequence violations
_REGRESSION_LOW = 50.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _room_tokens() -> set[str]:
    names = set(_LAYOUT_3BHK) | set(_LAYOUT_4BHK)
    return {n.lower() for n in names}


def _pct(n: int, d: int) -> float:
    return round((100.0 * n / d), 2) if d else 0.0


def _activity_pct(act: dict[str, Any]) -> float:
    try:
        raw = act.get("completionPct")
        if raw is None:
            raw = act.get("completion_pct")
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _activity_id(act: dict[str, Any]) -> str:
    return str(act.get("activityId") or act.get("activity_id") or "")


def _confidence(act: dict[str, Any]) -> float:
    try:
        raw = act.get("confidencePct")
        if raw is None:
            raw = act.get("confidence_pct")
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _iter_rooms(snapshot: dict[str, Any]):
    for flat in snapshot.get("flatProgress") or snapshot.get("flat_progress") or []:
        flat_name = str(flat.get("flatName") or flat.get("flat_name") or "")
        for room in flat.get("rooms") or []:
            yield flat_name, room


def metric_m1_blank_low_yield(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """Share of photographed rooms with zero / few scored activities."""
    counts: list[int] = []
    zero = 0
    below_5 = 0
    photographed = 0
    for snap in snapshots:
        for _flat, room in _iter_rooms(snap):
            captures = int(room.get("capturesCount") or room.get("captures_count") or 0)
            if captures <= 0:
                continue
            photographed += 1
            n = len(room.get("activities") or [])
            counts.append(n)
            if n == 0:
                zero += 1
            if n < 5:
                below_5 += 1
    return {
        "photographedRooms": photographed,
        "zeroActivityRatePct": _pct(zero, photographed),
        "below5ActivityRatePct": _pct(below_5, photographed),
        "activityCountP50": float(median(counts)) if counts else 0.0,
        "activityCountHistogram": dict(sorted(Counter(counts).items())),
    }


def _precedence_pairs() -> list[tuple[str, str]]:
    """(upstream, downstream) pairs. Prefer T8 table when present."""
    try:
        from app.services.construction_progress_providers.precedence import (  # type: ignore
            sequence_violation_pairs,
        )
        return list(sequence_violation_pairs())
    except Exception:
        return list(zip(_WALL_FINISH_CHAIN, _WALL_FINISH_CHAIN[1:]))


def metric_m2_sequence_violations(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    pairs = _precedence_pairs()
    # Expand to full transitive: any earlier vs any later in the chain for the
    # hardcoded path (downstream complete + upstream near-zero).
    chain_pairs: list[tuple[str, str]] = []
    if pairs == list(zip(_WALL_FINISH_CHAIN, _WALL_FINISH_CHAIN[1:])):
        for i, up in enumerate(_WALL_FINISH_CHAIN):
            for down in _WALL_FINISH_CHAIN[i + 1 :]:
                chain_pairs.append((up, down))
    else:
        chain_pairs = pairs

    violations = 0
    rooms_checked = 0
    examples: list[dict[str, Any]] = []
    for snap in snapshots:
        floor_id = snap.get("floorId") or snap.get("floor_id")
        for flat_name, room in _iter_rooms(snap):
            acts = { _activity_id(a): a for a in (room.get("activities") or []) if _activity_id(a) }
            if not acts:
                continue
            rooms_checked += 1
            for up_id, down_id in chain_pairs:
                up = acts.get(up_id)
                down = acts.get(down_id)
                if not up or not down:
                    continue
                if _activity_pct(down) >= COMPLETE_THRESHOLD and _activity_pct(up) < _NEAR_ZERO:
                    violations += 1
                    if len(examples) < 20:
                        examples.append({
                            "floorId": floor_id,
                            "flatName": flat_name,
                            "roomName": room.get("roomName") or room.get("room_name"),
                            "upstream": up_id,
                            "upstreamPct": _activity_pct(up),
                            "downstream": down_id,
                            "downstreamPct": _activity_pct(down),
                        })
    return {
        "roomsChecked": rooms_checked,
        "violationCount": violations,
        "violationRatePerRoom": round(violations / rooms_checked, 4) if rooms_checked else 0.0,
        "examples": examples,
    }


def _room_matches_tokens(room_name: str, tokens: tuple[str, ...]) -> bool:
    n = (room_name or "").strip().lower()
    return any(tok in n for tok in tokens)


def metric_m3_applicability(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    violations = 0
    scored = 0
    examples: list[dict[str, Any]] = []
    for snap in snapshots:
        floor_id = snap.get("floorId") or snap.get("floor_id")
        for flat_name, room in _iter_rooms(snap):
            room_name = str(room.get("roomName") or room.get("room_name") or "")
            for act in room.get("activities") or []:
                aid = _activity_id(act)
                if not aid:
                    continue
                if _activity_pct(act) <= 0:
                    continue
                scored += 1
                for rule_id, tokens in _APPLICABILITY_RULES:
                    if aid != rule_id:
                        continue
                    if not _room_matches_tokens(room_name, tokens):
                        violations += 1
                        if len(examples) < 20:
                            examples.append({
                                "floorId": floor_id,
                                "flatName": flat_name,
                                "roomName": room_name,
                                "activityId": aid,
                                "completionPct": _activity_pct(act),
                            })
    return {
        "scoredActivities": scored,
        "violationCount": violations,
        "violationRatePct": _pct(violations, scored),
        "examples": examples,
    }


def metric_m4_time_regressions(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """Drop from ≥COMPLETE_THRESHOLD to <50 across snapshots on the same floor."""
    by_floor: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for snap in snapshots:
        fid = str(snap.get("floorId") or snap.get("floor_id") or "")
        by_floor[fid].append(snap)

    regressions = 0
    pairs_checked = 0
    examples: list[dict[str, Any]] = []

    for floor_id, snaps in by_floor.items():
        ordered = sorted(
            snaps,
            key=lambda s: str(s.get("snapshotDate") or s.get("snapshot_date") or s.get("createdAt") or ""),
        )
        if len(ordered) < 2:
            continue
        # Join consecutive snapshots on (flat, room, activity).
        for earlier, later in zip(ordered, ordered[1:]):
            early_map: dict[tuple[str, str, str], float] = {}
            for flat_name, room in _iter_rooms(earlier):
                rn = str(room.get("roomName") or room.get("room_name") or "")
                for act in room.get("activities") or []:
                    aid = _activity_id(act)
                    if aid:
                        early_map[(flat_name, rn, aid)] = _activity_pct(act)
            for flat_name, room in _iter_rooms(later):
                rn = str(room.get("roomName") or room.get("room_name") or "")
                for act in room.get("activities") or []:
                    aid = _activity_id(act)
                    key = (flat_name, rn, aid)
                    if key not in early_map:
                        continue
                    pairs_checked += 1
                    before = early_map[key]
                    after = _activity_pct(act)
                    if before >= COMPLETE_THRESHOLD and after < _REGRESSION_LOW:
                        regressions += 1
                        if len(examples) < 20:
                            examples.append({
                                "floorId": floor_id,
                                "flatName": flat_name,
                                "roomName": rn,
                                "activityId": aid,
                                "beforePct": before,
                                "afterPct": after,
                            })
    return {
        "pairsChecked": pairs_checked,
        "regressionCount": regressions,
        "regressionRatePct": _pct(regressions, pairs_checked),
        "examples": examples,
    }


def metric_m5_confidence(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    confs: list[float] = []
    for snap in snapshots:
        for _flat, room in _iter_rooms(snap):
            for act in room.get("activities") or []:
                confs.append(_confidence(act))
        for act in snap.get("activities") or []:
            confs.append(_confidence(act))
    if not confs:
        return {
            "count": 0,
            "belowEvidenceFloorPct": 0.0,
            "belowRoomFloorPct": 0.0,
            "histogram": {},
        }
    buckets = Counter(int(c // 10) * 10 for c in confs)
    below_ev = sum(1 for c in confs if c < _MIN_EVIDENCE_CONFIDENCE)
    below_room = sum(1 for c in confs if c < _MIN_ROOM_CONFIDENCE)
    return {
        "count": len(confs),
        "mean": round(sum(confs) / len(confs), 2),
        "p50": float(median(confs)),
        "belowEvidenceFloorPct": _pct(below_ev, len(confs)),
        "belowRoomFloorPct": _pct(below_room, len(confs)),
        "evidenceFloor": _MIN_EVIDENCE_CONFIDENCE,
        "roomFloor": _MIN_ROOM_CONFIDENCE,
        "histogram": {str(k): buckets[k] for k in sorted(buckets)},
    }


def metric_m6_room_attribution(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """Same pin sequence resolving to different roomName across snapshots."""
    # heatmapPins carry sequenceNumber + roomName; fall back to room.pinNumbers.
    by_floor_pin: dict[tuple[str, int], set[str]] = defaultdict(set)
    for snap in snapshots:
        floor_id = str(snap.get("floorId") or snap.get("floor_id") or "")
        pins = snap.get("heatmapPins") or snap.get("heatmap_pins") or []
        if pins:
            for p in pins:
                seq = p.get("sequenceNumber") if p.get("sequenceNumber") is not None else p.get("sequence_number")
                if seq is None:
                    continue
                room = str(p.get("roomName") or p.get("room_name") or "")
                if room:
                    by_floor_pin[(floor_id, int(seq))].add(room)
        else:
            for _flat, room in _iter_rooms(snap):
                rn = str(room.get("roomName") or room.get("room_name") or "")
                for seq in room.get("pinNumbers") or room.get("pin_numbers") or []:
                    by_floor_pin[(floor_id, int(seq))].add(rn)

    unstable = {k: sorted(v) for k, v in by_floor_pin.items() if len(v) > 1}
    return {
        "pinsTracked": len(by_floor_pin),
        "unstablePinCount": len(unstable),
        "unstableRatePct": _pct(len(unstable), len(by_floor_pin)),
        "examples": [
            {"floorId": fid, "pin": seq, "roomNames": names}
            for (fid, seq), names in list(unstable.items())[:20]
        ],
    }


def compute_report(snapshots: list[dict[str, Any]], *, scope: str) -> dict[str, Any]:
    return {
        "generatedAt": _utcnow().isoformat(),
        "scope": scope,
        "snapshotCount": len(snapshots),
        "floorIds": sorted({
            str(s.get("floorId") or s.get("floor_id") or "")
            for s in snapshots
            if s.get("floorId") or s.get("floor_id")
        }),
        "rigVersion": RIG_VERSION,
        "completeThreshold": COMPLETE_THRESHOLD,
        "m1_blank_low_yield": metric_m1_blank_low_yield(snapshots),
        "m2_sequence_violations": metric_m2_sequence_violations(snapshots),
        "m3_applicability_violations": metric_m3_applicability(snapshots),
        "m4_time_regressions": metric_m4_time_regressions(snapshots),
        "m5_confidence": metric_m5_confidence(snapshots),
        "m6_room_attribution": metric_m6_room_attribution(snapshots),
    }


def _print_table(report: dict[str, Any]) -> None:
    m1 = report["m1_blank_low_yield"]
    m2 = report["m2_sequence_violations"]
    m3 = report["m3_applicability_violations"]
    m4 = report["m4_time_regressions"]
    m5 = report["m5_confidence"]
    m6 = report["m6_room_attribution"]
    rows = [
        ("M1 blank rate %", m1["zeroActivityRatePct"]),
        ("M1 below-5 rate %", m1["below5ActivityRatePct"]),
        ("M1 activity p50", m1["activityCountP50"]),
        ("M2 sequence violations", m2["violationCount"]),
        ("M2 rate / room", m2["violationRatePerRoom"]),
        ("M3 applicability violations", m3["violationCount"]),
        ("M3 rate %", m3["violationRatePct"]),
        ("M4 time regressions", m4["regressionCount"]),
        ("M4 rate %", m4["regressionRatePct"]),
        ("M5 below evidence floor %", m5["belowEvidenceFloorPct"]),
        ("M5 below room floor %", m5["belowRoomFloorPct"]),
        ("M6 unstable pins", m6["unstablePinCount"]),
        ("M6 unstable rate %", m6["unstableRatePct"]),
    ]
    print()
    print(f"Progress metrics — {report['scope']}  ({report['snapshotCount']} snapshots)")
    print("-" * 52)
    for label, value in rows:
        print(f"  {label:<32} {value}")
    print("-" * 52)


def _flatten_metrics(report: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, block in report.items():
        if not key.startswith("m") or not isinstance(block, dict):
            continue
        for k, v in block.items():
            if isinstance(v, (int, float)):
                out[f"{key}.{k}"] = float(v)
    return out


def _print_compare(before: dict[str, Any], after: dict[str, Any]) -> None:
    b = _flatten_metrics(before)
    a = _flatten_metrics(after)
    keys = sorted(set(b) | set(a))
    print()
    print("Compare (after − before)")
    print("-" * 64)
    print(f"  {'metric':<40} {'before':>8} {'after':>8} {'delta':>8}")
    for k in keys:
        bv, av = b.get(k, 0.0), a.get(k, 0.0)
        print(f"  {k:<40} {bv:8.2f} {av:8.2f} {av - bv:8.2f}")
    print("-" * 64)


async def _load_snapshots(*, floor_id: str | None, all_floors: bool) -> list[dict[str, Any]]:
    settings = get_settings()
    client = AsyncIOMotorClient(
        settings.MONGO_URI,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=10000,
    )
    db = client[settings.DB_NAME]
    try:
        query: dict[str, Any] = {}
        if floor_id:
            query["floorId"] = floor_id
        elif not all_floors:
            raise SystemExit("Pass --floor-id or --all-floors")
        cursor = db[_COLLECTION].find(query)
        return await cursor.to_list(length=10_000)
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Provable-error metrics for construction progress snapshots")
    parser.add_argument("--floor-id", help="Restrict to one floorId")
    parser.add_argument("--all-floors", action="store_true", help="Score every snapshot in the DB")
    parser.add_argument("--compare", help="Path to an earlier report JSON for side-by-side delta")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Also copy the report to tests/fixtures/progress_metrics/baseline.json",
    )
    args = parser.parse_args()

    scope = args.floor_id or ("all-floors" if args.all_floors else "unknown")
    snapshots = asyncio.run(_load_snapshots(floor_id=args.floor_id, all_floors=args.all_floors))
    report = compute_report(snapshots, scope=scope)

    _FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_path = _FIXTURE_DIR / f"report_{stamp}.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"Wrote {out_path}")

    if args.write_baseline:
        baseline = _FIXTURE_DIR / "baseline.json"
        baseline.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"Wrote {baseline}")

    _print_table(report)

    if args.compare:
        earlier = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        _print_compare(earlier, report)

    # Silence unused import warning for room-token helper (available for M3 extensions).
    _ = _room_tokens


if __name__ == "__main__":
    main()
