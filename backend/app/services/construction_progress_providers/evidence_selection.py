"""Turn the raw per-capture observations of one activity in one room into a single assessment + its evidence.

Why this exists (root causes it removes)
----------------------------------------
* The old merge kept only the LOWEST-scoring capture per (activity, room) and used THAT capture as the
  evidence image. For "Punning 80 %" the picture attached was the one that scored 80 even when another view
  showed the work far better, and for 0 % the "evidence" was a photo of a bare wall. Evidence must be the
  captures that visibly SUPPORT the finding, not whichever capture happened to score lowest.
* An old photo could win against newer evidence because nothing looked at capture dates.
* "Could not tell" was stored as 0 %, i.e. as proof that nothing was done.

Rules implemented here
----------------------
1. Unknown (`unable_to_determine`) is kept as unknown, never as 0.
2. Only observations the model was at least `MIN_USABLE_CONFIDENCE` sure of can set a value; reliable ones
   (>= `RELIABLE_CONFIDENCE`) win when any exist.
3. Newer evidence beats older: observations more than `STALE_AFTER_DAYS` older than the newest reliable
   one are ignored for the value (kept for history, never shown as evidence).
4. The value is conservative (the lowest reliable current reading) and disagreement between current
   captures is flagged for manager review.
5. Evidence images are only captures whose own reading shows work (pct > 0), ranked by confidence, then
   completeness, then recency, de-duplicated, at most `MAX_EVIDENCE`. A 0 % or unknown result has NO
   evidence images - we never attach a photo that merely belongs to the same floor.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Sequence

from app.services.construction_progress_providers.progress_aggregation import (
    DETECTION_DIRECT,
    STATUS_UNABLE,
    status_for_pct,
)

MIN_USABLE_CONFIDENCE = 30.0
RELIABLE_CONFIDENCE = 50.0
STALE_AFTER_DAYS = 7
CONFLICT_SPREAD_PCT = 40.0
MAX_EVIDENCE = 3
MAX_INDICATORS = 6


@dataclass(frozen=True)
class Observation:
    """One capture's reading of one activity in one room."""

    capture_id: str
    pct: float | None                 # None = the model could not establish the state
    conf: float
    evidence: str = ""
    indicators_found: tuple[str, ...] = ()
    indicators_missing: tuple[str, ...] = ()
    explanation: str = ""
    views: tuple[str, ...] = ()       # which rig views of the panorama showed it (evidence region hint)
    captured_at: datetime | None = None
    evidence_class: str = ""


def _naive(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def _uniq(items: Sequence[str], limit: int = MAX_INDICATORS) -> list[str]:
    seen: list[str] = []
    for it in items:
        text = str(it or "").strip()
        if text and text not in seen:
            seen.append(text)
        if len(seen) >= limit:
            break
    return seen


def resolve_observations(observations: Sequence[Observation]) -> dict[str, Any]:
    """Resolve all captures' readings of one activity in one room. See module docstring for the rules."""
    obs = list(observations)
    if not obs:
        return {}

    known = [o for o in obs if o.pct is not None and o.conf >= MIN_USABLE_CONFIDENCE]
    if not known:
        best = max(obs, key=lambda o: o.conf)
        return {
            "pct": None,
            "conf": best.conf,
            "capture_id": "",
            "evidence": best.evidence,
            "evidence_ids": [],
            "status": STATUS_UNABLE,
            "detection": DETECTION_DIRECT,
            "indicators_found": _uniq([i for o in obs for i in o.indicators_found]),
            "indicators_missing": _uniq([i for o in obs for i in o.indicators_missing]),
            "explanation": best.explanation or best.evidence,
            "views": list(best.views),
            "review_required": True,
            "review_reason": "The area was photographed but the state of this activity could not be established.",
            "last_captured_at": max((_naive(o.captured_at) for o in obs if o.captured_at), default=None),
            "n_captures": len(obs),
        }

    reliable = [o for o in known if o.conf >= RELIABLE_CONFIDENCE]
    pool = reliable or known

    # Newer evidence beats older evidence.
    dated = [_naive(o.captured_at) for o in pool if o.captured_at]
    fresh = pool
    if dated:
        newest = max(dated)
        cutoff = newest - timedelta(days=STALE_AFTER_DAYS)
        fresh = [o for o in pool if o.captured_at is None or _naive(o.captured_at) >= cutoff]
    fresh = fresh or pool

    lowest = min(fresh, key=lambda o: (o.pct, -o.conf))
    pct = float(lowest.pct or 0.0)

    review_required = False
    review_reason = ""
    spread_values = [float(o.pct) for o in fresh if o.conf >= RELIABLE_CONFIDENCE]
    if len(spread_values) >= 2 and max(spread_values) - min(spread_values) >= CONFLICT_SPREAD_PCT:
        review_required = True
        review_reason = (
            f"Captures of this room disagree ({min(spread_values):.0f}% to {max(spread_values):.0f}%); "
            "the lower reading is used until a manager confirms."
        )

    supporting = [
        o for o in fresh
        if o.pct is not None and o.pct > 0 and o.conf >= RELIABLE_CONFIDENCE
    ]
    supporting.sort(
        key=lambda o: (
            -o.conf,
            -(o.pct or 0.0),
            -(_naive(o.captured_at).timestamp() if o.captured_at else 0.0),
        )
    )
    evidence_ids: list[str] = []
    for o in supporting:
        if o.capture_id and o.capture_id not in evidence_ids:
            evidence_ids.append(o.capture_id)
        if len(evidence_ids) >= MAX_EVIDENCE:
            break
    if pct <= 0:
        evidence_ids = []  # nothing was done: there is nothing for a photo to prove

    primary = next((o for o in supporting if o.capture_id in evidence_ids), lowest)
    return {
        "pct": pct,
        "conf": max(o.conf for o in fresh if o.pct is not None and o.pct == pct) if any(
            o.pct == pct for o in fresh
        ) else lowest.conf,
        "capture_id": evidence_ids[0] if evidence_ids else lowest.capture_id,
        "evidence": primary.evidence or lowest.evidence,
        "evidence_ids": evidence_ids,
        "status": status_for_pct(pct),
        "detection": DETECTION_DIRECT,
        "indicators_found": _uniq([i for o in ([primary] + list(fresh)) for i in o.indicators_found]),
        "indicators_missing": _uniq([i for o in ([primary] + list(fresh)) for i in o.indicators_missing]),
        "explanation": primary.explanation or primary.evidence or lowest.explanation,
        "views": list(primary.views),
        "review_required": review_required,
        "review_reason": review_reason,
        "last_captured_at": max((_naive(o.captured_at) for o in fresh if o.captured_at), default=None),
        "n_captures": len(obs),
        "historical_capture_ids": [o.capture_id for o in obs if o not in fresh and o.capture_id],
    }
