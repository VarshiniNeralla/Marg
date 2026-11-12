"""The ONE place construction-progress numbers are calculated (room -> flat -> floor).

The vision model only produces per-activity *assessments* (a state, indicators, an explanation). This
module owns every percentage that reaches the dashboard, the reports and the exports. It is a set of pure
functions over the plain dict documents stored in a snapshot, so the same code runs when a snapshot is
created and when an older snapshot is re-read.

Methodology (also in the walkthrough document)
----------------------------------------------
Activity   An assessment is either *observed* (a direct detection, a sequence inference, or a manager's
           manual verification) or *unknown* (`unable_to_determine`, `not_observable`, never assessed).
           Unknown is NOT zero: it is simply not counted as evidence of either progress or no progress.

Room       Each room has a list of *applicable* activities (from the activity catalogue + room type).
             counted progress  = sum(observed activity %) / number of applicable activities
                                 (work nobody could verify is not counted - the conservative, earned-value rule)
             estimate          = mean(observed activity %)           (progress of what WAS seen)
             coverage          = observed / applicable
           A room is `completed` only when EVERY applicable activity is observed and at 100%
           (or manually verified). Coverage below MIN_ROOM_COVERAGE means `awaiting_evidence`.

Flat       counted progress = mean over ALL required rooms of the room's counted progress
           (a room nobody photographed contributes 0, so one finished room never carries a flat).
           coverage = mean room coverage.  A flat is `completed` only when every required room is.

Floor      Flat-finishing progress = mean of every flat's counted progress, so with four flats each fully
           finished flat is worth 25 %, and a flat with one unfinished room is worth less than 25 %.
           Common-area progress is calculated the same way over the configured common regions and is
           reported separately; the headline floor number blends the two with COMMON_AREA_FLAT_EQUIVALENTS.

Coverage is always reported next to the estimate and never folded into it silently.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence

# ── Vocabulary ────────────────────────────────────────────────────────────────
STATUS_NOT_STARTED = "not_started"
STATUS_IN_PROGRESS = "in_progress"
STATUS_MOSTLY_COMPLETE = "mostly_complete"
STATUS_COMPLETED = "completed"
STATUS_UNABLE = "unable_to_determine"
ASSESSMENT_STATUSES = (
    STATUS_NOT_STARTED, STATUS_IN_PROGRESS, STATUS_MOSTLY_COMPLETE, STATUS_COMPLETED, STATUS_UNABLE,
)

DETECTION_DIRECT = "direct"
DETECTION_INFERRED = "inferred"
DETECTION_MANUAL = "manual"

# Room / flat level statuses
SCOPE_COMPLETED = "completed"
SCOPE_IN_PROGRESS = "in_progress"
SCOPE_NOT_STARTED = "not_started"
SCOPE_AWAITING = "awaiting_evidence"
SCOPE_NO_PHOTOS = "no_photos"

# ── Thresholds (single source) ───────────────────────────────────────────────
MOSTLY_COMPLETE_PCT = 80.0
COMPLETED_PCT = 100.0
MIN_ROOM_COVERAGE = 0.5
MIN_FLAT_COVERAGE = 0.5
# In the headline floor number the common area counts as this many flats.
COMMON_AREA_FLAT_EQUIVALENTS = 1.0
COMMON_AREA_NAME = "Common Area"


def status_for_pct(pct: float | None) -> str:
    """Spec status for a numeric completion. None means the state could not be established."""
    if pct is None:
        return STATUS_UNABLE
    if pct >= COMPLETED_PCT:
        return STATUS_COMPLETED
    if pct >= MOSTLY_COMPLETE_PCT:
        return STATUS_MOSTLY_COMPLETE
    if pct > 0:
        return STATUS_IN_PROGRESS
    return STATUS_NOT_STARTED


def legacy_status(assessment_status: str) -> str:
    """Old vocabulary kept on every activity so existing clients and exports keep working."""
    if assessment_status == STATUS_COMPLETED:
        return "completed"
    if assessment_status in (STATUS_IN_PROGRESS, STATUS_MOSTLY_COMPLETE):
        return "in_progress"
    if assessment_status == STATUS_UNABLE:
        return "not_assessed"
    return "no_evidence"  # not_started: looked at, nothing done yet


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def _to_naive_utc(value: Any) -> datetime | None:
    """datetime or ISO string -> naive UTC datetime (how MongoDB stores them), else None."""
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    return None


def newest_capture_date(values: Iterable[Any]) -> datetime | None:
    dates = [d for d in (_to_naive_utc(v) for v in values) if d is not None]
    return max(dates) if dates else None


def activity_pct(act: dict[str, Any]) -> float | None:
    """Observed completion of one activity doc, or None when it is unknown."""
    status = str(act.get("assessmentStatus") or "")
    if status == STATUS_UNABLE:
        return None
    if str(act.get("status") or "") in ("not_observable", "not_assessed", "unable_to_determine"):
        return None
    return _num(act.get("completionPct") if act.get("completionPct") is not None else act.get("completion_pct"))


def room_metrics(
    room: dict[str, Any],
    applicable_ids: Sequence[str] | None,
) -> dict[str, Any]:
    """Counted progress, estimate, coverage and status of one room. Pure; does not mutate the room.

    ``applicable_ids`` is the room's applicable activity ids. ``None`` means "unknown" (an older snapshot):
    the denominator then falls back to the activities that were actually assessed.
    """
    acts = [a for a in (room.get("activities") or []) if isinstance(a, dict)]
    if applicable_ids is not None:
        wanted = set(applicable_ids)
        acts = [a for a in acts if str(a.get("activityId") or "") in wanted]
    observed: list[float] = []
    review_required = False
    for a in acts:
        pct = activity_pct(a)
        if pct is not None:
            observed.append(max(0.0, min(100.0, pct)))
        if a.get("reviewRequired"):
            review_required = True
    applicable_n = len(applicable_ids) if applicable_ids is not None else len(observed)
    applicable_n = max(applicable_n, len(observed))
    has_capture = (
        int(room.get("capturesCount") or 0) >= 1
        or bool(room.get("pinNumbers") or [])
        or bool(room.get("activities") or [])
    )
    counted = (sum(observed) / applicable_n) if applicable_n else 0.0
    estimate = (sum(observed) / len(observed)) if observed else None
    coverage = (len(observed) / applicable_n) if applicable_n else 0.0

    if not has_capture:
        status = SCOPE_NO_PHOTOS
    elif not observed:
        status = SCOPE_AWAITING
    elif applicable_n and len(observed) >= applicable_n and all(p >= COMPLETED_PCT for p in observed):
        status = SCOPE_COMPLETED
    elif coverage < MIN_ROOM_COVERAGE:
        status = SCOPE_AWAITING
    elif all(p <= 0 for p in observed):
        status = SCOPE_NOT_STARTED
    else:
        status = SCOPE_IN_PROGRESS
    return {
        "progressPct": round(counted, 1),
        "estimatePct": None if estimate is None else round(estimate, 1),
        "coveragePct": round(coverage * 100, 1),
        "observedActivities": len(observed),
        "applicableActivities": applicable_n,
        "status": status,
        "isComplete": status == SCOPE_COMPLETED,
        "hasCapture": has_capture,
        "reviewRequired": review_required,
    }


def flat_metrics(room_results: Sequence[dict[str, Any]], rooms_required: int | None = None) -> dict[str, Any]:
    """Roll room results up to a flat. Rooms that nobody photographed count as 0 progress."""
    required = max(int(rooms_required or 0), len(room_results))
    if required <= 0:
        return {
            "completionPct": 0.0, "estimatePct": None, "coveragePct": 0.0, "roomsRequired": 0,
            "roomsPhotographed": 0, "roomsComplete": 0, "status": SCOPE_NO_PHOTOS, "isFullyComplete": False,
            "reviewRequired": False,
        }
    progress = [r["progressPct"] for r in room_results] + [0.0] * (required - len(room_results))
    coverage = [r["coveragePct"] for r in room_results] + [0.0] * (required - len(room_results))
    estimates = [r["estimatePct"] for r in room_results if r["estimatePct"] is not None]
    photographed = sum(1 for r in room_results if r["hasCapture"])
    complete = sum(1 for r in room_results if r["isComplete"])
    completion = sum(progress) / required
    cov = sum(coverage) / required
    fully = complete >= required
    if fully:
        status, completion = SCOPE_COMPLETED, 100.0
    elif photographed == 0:
        status = SCOPE_NO_PHOTOS
    elif cov < MIN_FLAT_COVERAGE * 100:
        status = SCOPE_AWAITING
    elif completion <= 0:
        status = SCOPE_NOT_STARTED
    else:
        status = SCOPE_IN_PROGRESS
        completion = min(completion, 99.9)  # only `completed` rooms can make a flat 100
    return {
        "completionPct": round(completion, 1),
        "estimatePct": round(sum(estimates) / len(estimates), 1) if estimates else None,
        "coveragePct": round(cov, 1),
        "roomsRequired": required,
        "roomsPhotographed": photographed,
        "roomsComplete": complete,
        "status": status,
        "isFullyComplete": fully,
        "reviewRequired": any(r["reviewRequired"] for r in room_results),
    }


def floor_finishing_summary(flats: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Counts and the mean progress across a set of flats (or common regions). Flats are equal weight."""
    flats = list(flats)
    n = len(flats)
    if n == 0:
        return {
            "progressPct": 0.0, "estimatePct": None, "coveragePct": 0.0, "total": 0,
            "completed": 0, "inProgress": 0, "awaitingEvidence": 0, "notStarted": 0,
        }
    pcts = [float(f.get("completionPct") or 0.0) for f in flats]
    covs = [float(f.get("coveragePct") or 0.0) for f in flats]
    ests = [float(f["estimatePct"]) for f in flats if f.get("estimatePct") is not None]
    statuses = [str(f.get("scopeStatus") or "") for f in flats]
    return {
        "progressPct": round(sum(pcts) / n, 1),
        "estimatePct": round(sum(ests) / len(ests), 1) if ests else None,
        "coveragePct": round(sum(covs) / n, 1),
        "total": n,
        "completed": statuses.count(SCOPE_COMPLETED),
        "inProgress": statuses.count(SCOPE_IN_PROGRESS),
        "awaitingEvidence": statuses.count(SCOPE_AWAITING),
        "notStarted": statuses.count(SCOPE_NOT_STARTED) + statuses.count(SCOPE_NO_PHOTOS),
    }


def blended_floor_pct(flat_summary: dict[str, Any], common_summary: dict[str, Any]) -> float:
    """Headline floor number: flats at one unit each, the common area at COMMON_AREA_FLAT_EQUIVALENTS."""
    n_flats = int(flat_summary.get("total") or 0)
    common_n = int(common_summary.get("total") or 0)
    flat_total = float(flat_summary.get("progressPct") or 0.0) * n_flats
    if common_n:
        weight = COMMON_AREA_FLAT_EQUIVALENTS
        return round((flat_total + float(common_summary.get("progressPct") or 0.0) * weight) / (n_flats + weight), 1)
    return round(float(flat_summary.get("progressPct") or 0.0), 1) if n_flats else 0.0


ApplicableFn = Callable[[str, str], "Sequence[str] | None"]


def recompute_flat_progress(
    flat_progress: list[dict[str, Any]] | None,
    applicable: ApplicableFn | None,
) -> bool:
    """Recalculate every number on the flat/room docs in place. Returns True when anything changed.

    ``applicable(flat_name, room_name)`` returns the applicable activity ids, or ``None`` for an older
    snapshot whose denominators cannot be reconstructed.
    """
    changed = False
    for fp in flat_progress or []:
        rooms = [r for r in (fp.get("rooms") or []) if isinstance(r, dict)]
        flat_name = str(fp.get("flatName") or "")
        results: list[dict[str, Any]] = []
        for room in rooms:
            ids = applicable(flat_name, str(room.get("roomName") or "")) if applicable else None
            m = room_metrics(room, ids)
            results.append(m)
            updates = {
                "isComplete": m["isComplete"],
                "progressPct": m["progressPct"],
                "estimatePct": m["estimatePct"],
                "coveragePct": m["coveragePct"],
                "observedActivities": m["observedActivities"],
                "applicableActivities": m["applicableActivities"],
                "scopeStatus": m["status"],
                "reviewRequired": m["reviewRequired"],
                "lastInspection": newest_capture_date(
                    a.get("lastCapturedAt") for a in (room.get("activities") or []) if isinstance(a, dict)
                ),
            }
            for k, v in updates.items():
                if room.get(k) != v:
                    room[k] = v
                    changed = True
        fm = flat_metrics(results, int(fp.get("roomsRequired") or 0))
        updates = {
            "completionPct": fm["completionPct"],
            "estimatePct": fm["estimatePct"],
            "coveragePct": fm["coveragePct"],
            "roomsComplete": fm["roomsComplete"],
            "roomsPhotographed": fm["roomsPhotographed"],
            "roomsRequired": fm["roomsRequired"],
            "roomsTotal": fm["roomsRequired"],  # always the full roster in "X of Y"
            "isFullyComplete": fm["isFullyComplete"],
            "scopeStatus": fm["status"],
            "reviewRequired": fm["reviewRequired"],
            "lastInspection": newest_capture_date(r.get("lastInspection") for r in rooms),
        }
        for k, v in updates.items():
            if fp.get(k) != v:
                fp[k] = v
                changed = True
    return changed
