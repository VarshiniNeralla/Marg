"""What Drishti is allowed to see of the construction-progress data.

The progress engine stores a lot per activity (evidence blobs, capture ids, per-view lists, model
confidence). Handing all of that to the language model both bloats the prompt and invites wrong
answers, so every facts payload goes through `prepare_payload_for_llm` right before it is serialised:

* heavy / misleading keys are dropped (capture ids, model self-confidence, geometry);
* evidence is reduced to a count and the newest capture time (the model must never describe images);
* an activity whose result is unknown gets `completionPct: null` - never 0;
* every activity says HOW its number was obtained (`basis`: direct / inferred / manager_verified);
* dates are unambiguous UTC strings.

Numbers are never recalculated here; they are only presented.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.construction_progress_providers.progress_aggregation import activity_pct

# Keys that never reach the model.
_DROP_KEYS = frozenset({
    "evidenceCaptureIds", "evidence_capture_ids", "confidencePct", "confidence_pct",
    "heatmapPins", "roomHeatmap", "polygon", "floorPlanImageUrl", "captureIds", "pinNumbers",
    "sequenceIndex", "_id", "orgId", "avgConfidencePct", "avgConfidence", "averageConfidence",
})
_LIST_CAP = 6


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        from app.services.construction_progress_service import iso_utc
        return iso_utc(value)
    return value


def activity_basis(act: dict[str, Any]) -> str:
    """How an activity's number was obtained, in words the model can repeat."""
    if str(act.get("detectionType") or "") == "manual" or act.get("override"):
        return "manager_verified"
    detection = str(act.get("detectionType") or "direct")
    if detection == "inferred":
        return "inferred_from_later_work"
    if detection == "mixed":
        return "partly_inferred"
    return "seen_in_photos"


def compact_activity(act: dict[str, Any]) -> dict[str, Any]:
    """One activity, reduced to what a progress answer needs."""
    observed = activity_pct(act)
    out: dict[str, Any] = {
        "activityId": act.get("activityId"),
        "activityName": act.get("activityName") or act.get("name"),
        "completionPct": None if observed is None else round(float(observed), 1),
        "status": act.get("status"),
        "assessmentStatus": act.get("assessmentStatus"),
    }
    if act.get("detectionType") or act.get("override"):
        out["basis"] = activity_basis(act)
    if observed is None:
        out["note"] = "unknown - not the same as 0%; the model could not tell from the photos"
    if act.get("inferredFrom"):
        out["inferredFrom"] = act.get("inferredFrom")
    if act.get("reviewRequired"):
        out["needsReview"] = True
        if act.get("reviewReason"):
            out["reviewReason"] = act.get("reviewReason")
    override = act.get("override")
    if isinstance(override, dict):
        out["managerOverride"] = {
            "pct": override.get("pct"), "verdict": override.get("verdict"), "reason": override.get("reason"),
            "by": override.get("by"), "at": _iso(override.get("at")), "aiPct": override.get("aiPct", act.get("aiCompletionPct")),
        }
    if act.get("evidence"):
        out["evidence"] = act.get("evidence")
    details = act.get("evidenceDetails") or []
    if details:
        out["evidenceCount"] = len(details)
    if act.get("lastCapturedAt"):
        out["lastCapturedAt"] = _iso(act.get("lastCapturedAt"))
    for key in ("visualIndicatorsFound", "visualIndicatorsMissing", "explanation"):
        val = act.get(key)
        if val:
            out[key] = val[:_LIST_CAP] if isinstance(val, list) else val
    if act.get("section"):
        out["section"] = act.get("section")
    return out


def _is_activity(d: dict[str, Any]) -> bool:
    return "activityId" in d and ("completionPct" in d or "assessmentStatus" in d or "status" in d)


def prepare_payload_for_llm(value: Any) -> Any:
    """Deep copy of a facts payload in the shape described in the module docstring."""
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, list):
        return [prepare_payload_for_llm(v) for v in value]
    if isinstance(value, dict):
        if _is_activity(value):
            compact = compact_activity(value)
            # keep any extra context keys the caller attached (flat/room/floor names, scope, grain ...)
            for k, v in value.items():
                if k in compact or k in _DROP_KEYS or k in {
                    "evidence", "evidenceDetails", "visualIndicatorsFound", "visualIndicatorsMissing",
                    "explanation", "reviewRequired", "reviewReason", "override", "aiCompletionPct", "aiDisagrees",
                    "detectionType", "inferredFrom", "lastCapturedAt", "coveragePct", "name",
                    "completionPct", "status", "assessmentStatus", "section",
                }:
                    continue
                compact[k] = prepare_payload_for_llm(v)
            return compact
        return {k: prepare_payload_for_llm(v) for k, v in value.items() if k not in _DROP_KEYS}
    return value
