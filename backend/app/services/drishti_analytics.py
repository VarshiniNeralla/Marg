"""
Deterministic ranking/comparison/synthesis functions for Drishti.

This is the single most architecturally important module in Drishti: every
function here is a PLAIN, DB-FREE PYTHON FUNCTION over already-fetched
snapshot dicts, with ZERO LLM involvement. "Which activity is fastest",
"which flat is behind", "what's the biggest unfinished work", "what should
management worry about" are all computed here, in code — the LLM's only job
(in drishti_service.py/drishti_prompts.py) is to write prose that explains an
already-decided result. Never let the LLM re-derive, re-sort, or second-guess
anything this module returns.

Mirrors `drishti_forecast_service.compute_velocity_forecast`'s existing
pattern in this codebase: pure functions, trivially unit-testable with
handcrafted fixtures, no mocking required.
"""
from __future__ import annotations

from typing import Any, Optional

_COMMON_AREA_FLAT = "Common Area"

# Activity statuses that carry a real progress signal — mirrors
# DrishtiContextService._ASSESSED_STATUSES. `not_assessed` (no photo
# coverage yet) and `not_observable` (concealed/document-only) are excluded
# from every ranking/ordering below since neither reflects actual measured
# progress; including them would silently bias every ranking toward 0%.
_RANKABLE_STATUSES = {"in_progress", "completed", "no_evidence"}


def _iter_room_activities(rooms: list[dict[str, Any]], flat_name: Optional[str] = None):
    for room in rooms:
        room_name = room.get("roomName")
        for activity in room.get("activities", []):
            yield room_name, activity


def rank_activities(
    rooms: list[dict[str, Any]], direction: str = "fastest", *, flat_name: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Ranks every rankable activity across the given rooms (already scoped
    by the caller to a floor/flat/common-area/room). Returns [] — not an
    exception — when nothing is rankable in scope; the caller must render
    that as "no assessed activity data here yet," never let the LLM invent
    a ranking to fill the gap."""
    items: list[dict[str, Any]] = []
    for room_name, activity in _iter_room_activities(rooms):
        status = activity.get("status")
        if status not in _RANKABLE_STATUSES:
            continue
        items.append({
            "activityName": activity.get("activityName"),
            "activityId": activity.get("activityId"),
            "roomName": room_name,
            "flatName": flat_name,
            "completionPct": float(activity.get("completionPct") or 0.0),
            "status": status,
            "evidence": activity.get("evidence") or "",
        })
    reverse = direction != "slowest"
    items.sort(key=lambda x: x["completionPct"], reverse=reverse)
    return items


def rank_flats(
    flat_progress: list[dict[str, Any]], direction: str = "most_progressed",
) -> list[dict[str, Any]]:
    """Ranks real flats by completionPct — the synthetic "Common Area" entry
    is never a flat and is always excluded from this ranking."""
    items = [
        {
            "flatName": f.get("flatName"),
            "completionPct": float(f.get("completionPct") or 0.0),
            "roomsComplete": f.get("roomsComplete"),
            "roomsTotal": f.get("roomsTotal"),
        }
        for f in flat_progress
        if str(f.get("flatName") or "") != _COMMON_AREA_FLAT
    ]
    reverse = direction != "least_progressed"
    items.sort(key=lambda x: x["completionPct"], reverse=reverse)
    return items


def rank_common_areas(
    flat_progress: list[dict[str, Any]], direction: str = "most_progressed",
) -> list[dict[str, Any]]:
    """Ranks common-area units (Corridor, Lobby, ...) by each unit's own
    mean completion across its rankable activities. Only the synthetic
    "Common Area" pseudo-flat's rooms are considered — never a real flat's
    rooms."""
    common_flat = next(
        (f for f in flat_progress if str(f.get("flatName") or "") == _COMMON_AREA_FLAT), None,
    )
    if not common_flat:
        return []

    items: list[dict[str, Any]] = []
    for room in common_flat.get("rooms", []):
        rankable = [
            a for a in room.get("activities", []) if a.get("status") in _RANKABLE_STATUSES
        ]
        if not rankable:
            continue
        mean_pct = sum(float(a.get("completionPct") or 0.0) for a in rankable) / len(rankable)
        items.append({
            "commonAreaName": room.get("roomName"),
            "completionPct": round(mean_pct, 1),
            "capturesCount": room.get("capturesCount", 0),
        })
    reverse = direction != "least_progressed"
    items.sort(key=lambda x: x["completionPct"], reverse=reverse)
    return items


def rank_unfinished_work(
    rooms: list[dict[str, Any]], threshold_pct: float = 80.0, *, flat_name: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Same rankable-activity flatten as rank_activities, filtered to
    completionPct < threshold_pct, sorted ascending (least complete = most
    urgent first). Adds `gapPct` (100 - completionPct) for direct display."""
    items = rank_activities(rooms, direction="slowest", flat_name=flat_name)
    items = [i for i in items if i["completionPct"] < threshold_pct]
    for item in items:
        item["gapPct"] = round(100.0 - item["completionPct"], 1)
    return items


def find_capture_gaps(flat_progress: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Surfaces every room (real or common-area) with zero or partial
    capture coverage, worst-first. Uses ONLY the fields already persisted on
    the snapshot (capturesCount, pinNumbers, roomsPhotographed vs
    roomsRequired) — no new capture-tracking mechanism."""
    gaps: list[dict[str, Any]] = []
    for flat in flat_progress:
        flat_name = str(flat.get("flatName") or "")
        is_common = flat_name == _COMMON_AREA_FLAT
        for room in flat.get("rooms", []):
            captures_count = int(room.get("capturesCount") or 0)
            if captures_count == 0:
                gaps.append({
                    "flatName": flat_name,
                    "roomName": room.get("roomName"),
                    "capturesCount": captures_count,
                    "pinNumbers": room.get("pinNumbers") or [],
                    "isCommonArea": is_common,
                })
    gaps.sort(key=lambda g: g["capturesCount"])
    return gaps


def synthesize_top_concerns(
    *,
    floor_snapshot: Optional[dict[str, Any]] = None,
    coverage: Optional[dict[str, Any]] = None,
    unfinished_work: Optional[list[dict[str, Any]]] = None,
    capture_gaps: Optional[list[dict[str, Any]]] = None,
    quality_notes: Optional[list[dict[str, Any]]] = None,
    forecast: Optional[dict[str, Any]] = None,
    coverage_threshold_pct: float = 70.0,
) -> list[dict[str, Any]]:
    """Pure combinator: decides WHICH concerns qualify and their ORDER, in
    code. The LLM (per drishti_prompts.py) only writes prose for each
    already-selected concern afterward — it never decides what counts as a
    concern or reorders this list. Returns [] when nothing qualifies; the
    caller must present that as "no significant concerns identified from the
    available data," never let the LLM invent one."""
    unfinished_work = unfinished_work or []
    capture_gaps = capture_gaps or []
    quality_notes = quality_notes or []
    concerns: list[dict[str, Any]] = []

    if floor_snapshot is not None:
        overall_pct = floor_snapshot.get("overallProgressPct")
        if overall_pct is not None and overall_pct < 50.0:
            concerns.append({
                "category": "progress",
                "what": f"Observed progress is {overall_pct}%, below the halfway mark.",
                "why": "Low overall progress on an analyzed floor may indicate the floor is behind relative to the rest of the project.",
                "evidence": [{"floorId": floor_snapshot.get("floorId"), "note": f"overallProgressPct={overall_pct}"}],
                "severityRank": 1,
            })

    if coverage is not None:
        coverage_pct = coverage.get("coveragePct")
        if coverage_pct is not None and coverage_pct < coverage_threshold_pct:
            concerns.append({
                "category": "coverage",
                "what": f"Only {coverage_pct}% of configured rooms have been captured.",
                "why": "Low capture coverage limits confidence in any floor-level progress figure — the number may not yet represent the whole floor.",
                "evidence": [{"note": f"coveragePct={coverage_pct}"}],
                "severityRank": 2,
            })

    if unfinished_work:
        top = unfinished_work[:3]
        concerns.append({
            "category": "progress",
            "what": "Multiple activities remain well below completion: " + ", ".join(
                f"{i['activityName']} ({i['completionPct']}%)" for i in top
            ),
            "why": "These are the least-complete assessed activities in scope and are the most immediate blockers to finishing this area.",
            "evidence": [{"note": f"{i['activityName']}={i['completionPct']}%"} for i in top],
            "severityRank": 3,
        })

    if capture_gaps:
        uncaptured = [g for g in capture_gaps if g["capturesCount"] == 0]
        if uncaptured:
            concerns.append({
                "category": "coverage",
                "what": f"{len(uncaptured)} configured room(s) have not been captured at all.",
                "why": "These rooms cannot be assessed until they are photographed — the current progress figure excludes them entirely rather than treating them as incomplete.",
                "evidence": [{"note": f"{g['flatName']} - {g['roomName']}"} for g in uncaptured[:5]],
                "severityRank": 2,
            })

    if quality_notes:
        concerns.append({
            "category": "quality",
            "what": f"{len(quality_notes)} saved inspection report(s) recorded quality observations.",
            "why": "Visible quality issues from prior inspections may need QA/QC follow-up.",
            "evidence": [{"note": n.get("pinName") or n.get("floor") or "quality observation"} for n in quality_notes[:5]],
            "severityRank": 4,
        })

    if forecast is not None and forecast.get("status") in ("stalled_or_regressing", "insufficient_data"):
        reason = forecast.get("reason") or "progress velocity is flat or declining"
        concerns.append({
            "category": "schedule",
            "what": "A reliable completion estimate is not currently available.",
            "why": reason,
            "evidence": [{"note": f"forecast.status={forecast.get('status')}"}],
            "severityRank": 5,
        })

    concerns.sort(key=lambda c: c["severityRank"])
    return concerns
