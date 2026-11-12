"""Construction-sequence inference over the configurable dependency graph (activity_rules.DEPENDENCIES).

Replaces the hard-coded finish chains and the "block-backward zeroing" / MEP-door gate in precedence.py for
the live engine. Principles (from the product spec):

* A later activity that was DIRECTLY detected may prove an earlier one was done. The result is stored with
  ``detection = "inferred"`` and never as a direct detection. The directly observed value (if any) is kept.
* Only dependencies configured with infer = "full" or "cap" are used. "none" edges are ordering only, so
  unrelated activities and the quality of concealed services are never inferred.
* Inference never invents progress from the assumed order alone: it needs a driver with real evidence.
* When the earlier stage is still visible and was directly observed as clearly less complete than the later
  one, the two CONFLICT. Nothing is overridden: both are kept and flagged for manager review. When the
  earlier stage is hidden by the later one (``concealed_when_finished``) a low direct reading is not
  trustworthy, so it is raised and marked as inferred (the direct reading is kept in ``direct_pct``).
"""
from __future__ import annotations

from typing import Any

from app.services.construction_progress_providers.activity_rules import (
    DEPENDENCIES,
    rule_for,
)
from app.services.construction_progress_providers.progress_aggregation import (
    DETECTION_DIRECT,
    DETECTION_INFERRED,
    status_for_pct,
)

RELIABLE_DRIVER_CONFIDENCE = 50.0
CONFLICT_MARGIN_PCT = 30.0

_INFERRING = tuple(d for d in DEPENDENCIES if d.infer in ("full", "cap"))

# Each wall-finish coat is physically covered by the next one, so once the next coat is directly seen a
# low direct reading of the covered coat is not trustworthy (same reasoning as concealed_when_finished).
COVERED_BY_NEXT_COAT = frozenset({
    "flat.ceiling_punning_2", "flat.wall_punning_4", "flat.putty_1st_coat_25", "flat.putty_2nd_coat_26",
    "common.wall_punning_works_1", "common.putty_1st_coat_4", "common.putty_2nd_coat_5",
})


def _label(activity_id: str) -> str:
    rule = rule_for(activity_id)
    return rule.label if rule else activity_id


def _driver_ok(entry: dict[str, Any], allow_inferred: bool) -> bool:
    if entry.get("pct") is None or float(entry["pct"]) <= 0:
        return False
    if entry.get("detection") == DETECTION_INFERRED:
        return allow_inferred
    return float(entry.get("conf") or 0.0) >= RELIABLE_DRIVER_CONFIDENCE


def apply_sequence_inference(unit: dict[str, dict[str, Any]]) -> list[str]:
    """Infer earlier activities of one room from its later ones, in place. Returns ids that were inferred."""
    inferred_ids: list[str] = []
    # Repeat so a chain (primer -> putty 2nd -> putty 1st -> punning) resolves regardless of dict order.
    for _ in range(len(_INFERRING) + 1):
        progressed = False
        for dep in _INFERRING:
            driver = unit.get(dep.later)
            if driver is None or not _driver_ok(driver, allow_inferred=(dep.infer == "full")):
                continue
            cap = float(driver["pct"])
            target = unit.get(dep.earlier)
            later_name, earlier_name = _label(dep.later), _label(dep.earlier)
            driver_ids = list(driver.get("evidence_ids") or ([driver["capture_id"]] if driver.get("capture_id") else []))

            if target is None or target.get("pct") is None:
                unit[dep.earlier] = {
                    "pct": cap,
                    "conf": min(float(driver.get("conf") or 0.0), 70.0),
                    "capture_id": driver_ids[0] if driver_ids else "",
                    "evidence": f"Inferred from {later_name} ({cap:.0f}% directly observed); {earlier_name} is not directly visible.",
                    "evidence_ids": driver_ids,
                    "status": status_for_pct(cap),
                    "detection": DETECTION_INFERRED,
                    "inferred_from": dep.later,
                    "indicators_found": [],
                    "indicators_missing": [],
                    "explanation": dep.note,
                    "views": list(driver.get("views") or []),
                    "review_required": False,
                    "review_reason": "",
                    "last_captured_at": driver.get("last_captured_at"),
                }
                inferred_ids.append(dep.earlier)
                progressed = True
                continue

            current = float(target["pct"])
            if current >= cap:
                continue
            rule = rule_for(dep.earlier)
            hidden = bool(rule and rule.concealed_when_finished) or dep.earlier in COVERED_BY_NEXT_COAT or target.get("detection") == DETECTION_INFERRED
            if hidden:
                if target.get("detection") != DETECTION_INFERRED:
                    target["direct_pct"] = current
                target.update({
                    "pct": cap,
                    "status": status_for_pct(cap),
                    "detection": DETECTION_INFERRED,
                    "inferred_from": dep.later,
                    "evidence": f"Inferred from {later_name} ({cap:.0f}% directly observed); {earlier_name} is covered by it.",
                    "evidence_ids": driver_ids,
                    "capture_id": driver_ids[0] if driver_ids else target.get("capture_id", ""),
                    "conf": max(float(target.get("conf") or 0.0), min(float(driver.get("conf") or 0.0), 70.0)),
                })
                if target["evidence_ids"] != driver_ids:
                    target["evidence_ids"] = driver_ids
                if dep.earlier not in inferred_ids:
                    inferred_ids.append(dep.earlier)
                progressed = True
            elif target.get("detection", DETECTION_DIRECT) == DETECTION_DIRECT and cap - current >= CONFLICT_MARGIN_PCT:
                reason = (
                    f"{earlier_name} was directly seen at {current:.0f}% but {later_name}, which normally follows it, "
                    f"is at {cap:.0f}%. Sequence conflict - please review."
                )
                for entry in (target, driver):
                    if not entry.get("review_required"):
                        entry["review_required"] = True
                        entry["review_reason"] = reason
        if not progressed:
            break
    return inferred_ids
