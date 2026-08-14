"""Construction-sequence precedence for Flat Finishing room scores (T8 / v4.5).

Passes over merged per-room activity dicts:

* **Later ⇒ earlier (finish chain)** — a confirmed later stage (primer / final
  paint, etc.) raises earlier required stages on the *same surface chain* up to
  the confirmed coverage %. Wall punning and putty are inferred when paint is
  confirmed; the reverse must NEVER invent paint from punning/putty alone.
* **Full fill-forward — DISABLED** for arbitrary mid-chain invention beyond the
  later⇒earlier rule above.
* **Block-backward** — an upstream activity still at 0% forces later dependents
  to 0%, except paint stages that already have a direct visual score > 0, and
  stages already filled by later⇒earlier inference.
* **MEP↔door-shutter gate** — zeroing semantics (not a cap just under the
  completion line), matching vllm_provider behaviour.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from loguru import logger

# Keep in sync with vllm_provider.COMPLETE_THRESHOLD / COMPLETED_STATUS_PCT.
COMPLETE_THRESHOLD = 92.0
COMPLETED_STATUS_PCT = 100.0

# v4: never invent full upstream chain credit from arbitrary downstream scores
# outside the explicit later⇒earlier finish-chain rule.
ENABLE_FILL_FORWARD = False

# v4.5: later finishing stages imply earlier stages on the same chain
# (paint ⇒ primer/putty/punning), capped at the confirmed later %.
ENABLE_LATER_IMPLIES_EARLIER = True
# Back-compat alias used by older tests / callers.
ENABLE_PAINT_IMPLIES_PUTTY = ENABLE_LATER_IMPLIES_EARLIER

# Wall-finish chain in true site order (also used by T2 M2).
WALL_FINISH_CHAIN: tuple[str, ...] = (
    "flat.wall_punning_4",
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
    "flat.primer_1st_coat_paint_27",
    "flat.final_coat_paint_37",
)

# Common-area corridor finish chain (same construction sequence).
COMMON_FINISH_CHAIN: tuple[str, ...] = (
    "common.wall_punning_works_1",
    "common.putty_1st_coat_4",
    "common.putty_2nd_coat_5",
    "common.primer_1st_coat_paint_6",
    "common.painting_2nd_coat_9",
)

_FLAT_PUTTY_IDS: tuple[str, ...] = (
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
)
_FLAT_PAINT_IDS: tuple[str, ...] = (
    "flat.primer_1st_coat_paint_27",
    "flat.final_coat_paint_37",
)

_COMMON_PUTTY_IDS: tuple[str, ...] = (
    "common.putty_1st_coat_4",
    "common.putty_2nd_coat_5",
)
_COMMON_PAINT_IDS: tuple[str, ...] = (
    "common.primer_1st_coat_paint_6",
    "common.painting_2nd_coat_9",
)

# Paint stages that must not be zeroed by block-backward when already scored > 0.
_PAINT_PROTECTED_IDS: frozenset[str] = frozenset(_FLAT_PAINT_IDS + _COMMON_PAINT_IDS)

# Stages that later⇒earlier may raise (never invent forward into paint from putty).
_INFERRED_UPSTREAM_IDS: frozenset[str] = frozenset(
    {
        "flat.wall_punning_4",
        "flat.putty_1st_coat_25",
        "flat.putty_2nd_coat_26",
        "flat.primer_1st_coat_paint_27",
        "common.wall_punning_works_1",
        "common.putty_1st_coat_4",
        "common.putty_2nd_coat_5",
        "common.primer_1st_coat_paint_6",
    }
)

_MEP_ID = "flat.mep_ceiling_services_plumbing_fire_gas_3"
_DOOR_SHUTTER_IDS: tuple[str, ...] = (
    "flat.main_door_shutter_fixing_temporary_21",
    "flat.internal_door_shutter_fixing_with_hardware_22",
)

# (upstream, downstream) — upstream must precede downstream.
# Door→MEP edges encode the product gate: MEP credit requires a door shutter
# confirmed in the same room (OR across the two door ids; see apply_precedence).
PRECEDENCE_EDGES: tuple[tuple[str, str], ...] = tuple(
    zip(WALL_FINISH_CHAIN, WALL_FINISH_CHAIN[1:])
) + tuple((door_id, _MEP_ID) for door_id in _DOOR_SHUTTER_IDS)

# Typo alias kept for callers that followed the task brief spelling.
PRECENDENCE_EDGES = PRECEDENCE_EDGES

_LATER_IMPLIES_EARLIER_EVIDENCE = "Inferred from completed later finishing stage"
PAINT_IMPLIES_PUTTY_EVIDENCE = _LATER_IMPLIES_EARLIER_EVIDENCE
LATER_IMPLIES_EARLIER_EVIDENCE = _LATER_IMPLIES_EARLIER_EVIDENCE

# Exported for seeding in vllm_provider.
COMMON_PUTTY_IDS = _COMMON_PUTTY_IDS
COMMON_PAINT_IDS = _COMMON_PAINT_IDS


def sequence_violation_pairs() -> list[tuple[str, str]]:
    """(upstream, downstream) pairs for provable sequence-violation checks (T2 M2).

    Wall-finish pairs are the full transitive closure. Door→MEP edges are
    included as-is (OR gate is enforced in apply_precedence, not here).
    """
    pairs: list[tuple[str, str]] = []
    for i, up in enumerate(WALL_FINISH_CHAIN):
        for down in WALL_FINISH_CHAIN[i + 1 :]:
            pairs.append((up, down))
    for door_id in _DOOR_SHUTTER_IDS:
        pairs.append((door_id, _MEP_ID))
    return pairs


def _pct(act: dict[str, Any] | None) -> float:
    if not act:
        return 0.0
    raw = act.get("completionPct")
    if raw is None:
        raw = act.get("completion_pct")
    try:
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _set_pct(
    act: dict[str, Any],
    value: float,
    *,
    evidence: str | None = None,
    capture_id: str | None = None,
    confidence_pct: float | None = None,
) -> None:
    if "completionPct" in act:
        act["completionPct"] = value
    if "completion_pct" in act:
        act["completion_pct"] = value
    if "completionPct" not in act and "completion_pct" not in act:
        act["completionPct"] = value
    if evidence is not None:
        act["evidence"] = evidence
    if capture_id:
        # Keep supporting photo from the driving later stage — do not invent URLs.
        if not act.get("capture_id") and not act.get("evidenceCaptureIds"):
            act["capture_id"] = capture_id
            act["evidenceCaptureIds"] = [capture_id]
    if confidence_pct is not None:
        if "confidencePct" in act or "confidence_pct" in act or True:
            act["confidencePct"] = float(confidence_pct)
            if "confidence_pct" in act:
                act["confidence_pct"] = float(confidence_pct)
    if value >= COMPLETED_STATUS_PCT:
        act["status"] = "completed"
    elif value <= 0.0:
        act["status"] = "no_evidence"
    else:
        act["status"] = "in_progress"


def _ensure_act(room: dict[str, dict], activity_id: str) -> dict[str, Any] | None:
    act = room.get(activity_id)
    if act is None:
        return None
    return act


def _ensure_or_create(room: dict[str, dict], activity_id: str) -> dict[str, Any]:
    act = room.get(activity_id)
    if act is None:
        act = {"completionPct": 0.0, "confidencePct": 0.0, "status": "no_evidence"}
        room[activity_id] = act
    return act


def _capture_id_of(act: dict[str, Any] | None) -> str:
    if not act:
        return ""
    cid = act.get("capture_id") or ""
    if cid:
        return str(cid)
    ids = act.get("evidenceCaptureIds") or act.get("evidence_capture_ids") or []
    if isinstance(ids, list) and ids:
        return str(ids[0] or "")
    return ""


def _confidence_of(act: dict[str, Any] | None) -> float:
    if not act:
        return 0.0
    raw = act.get("confidencePct")
    if raw is None:
        raw = act.get("confidence_pct")
    try:
        return float(raw or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _apply_later_implies_earlier(out: dict[str, dict], chain: tuple[str, ...]) -> None:
    """Raise earlier stages up to a later stage's confirmed coverage (never reverse).

    Example: Final Coat = 100% ⇒ Wall Punning / Putty / Primer ≥ 100%.
    Final Coat = 60% ⇒ prerequisites raised to at least 60% (not forced to 100%).
    Putty = 100% must NOT invent Final Coat.
    """
    # Only run when at least one chain member is present for this room.
    if not any(aid in out for aid in chain):
        return

    for i in range(len(chain) - 1, 0, -1):
        down_id = chain[i]
        down = _ensure_act(out, down_id)
        down_pct = _pct(down)
        if down is None or down_pct <= 0.0:
            continue
        driver_capture = _capture_id_of(down)
        driver_conf = _confidence_of(down)
        for j in range(i):
            up_id = chain[j]
            # Never invent a stage that is out of scope for this room unless a
            # later in-chain stage is already present (same section/surface).
            if up_id not in out and down_id not in out:
                continue
            up = _ensure_or_create(out, up_id)
            before = _pct(up)
            # Only raise — never lower a stronger direct observation.
            if before >= down_pct:
                continue
            logger.info(
                "precedence later⇒earlier: {down}={dpct} ⇒ {up} {before}→{after}",
                down=down_id,
                dpct=down_pct,
                up=up_id,
                before=before,
                after=down_pct,
            )
            evidence = _LATER_IMPLIES_EARLIER_EVIDENCE
            if down_pct >= COMPLETED_STATUS_PCT:
                evidence = "Inferred from completed later finishing stage"
            else:
                evidence = (
                    f"Inferred from later finishing stage "
                    f"({down_pct:.0f}% confirmed coverage)"
                )
            _set_pct(
                up,
                down_pct,
                evidence=evidence,
                capture_id=driver_capture or None,
                confidence_pct=driver_conf if driver_conf > 0 else None,
            )


def apply_precedence(room_activities: dict[str, dict]) -> dict:
    """Apply later⇒earlier finish chains, optional fill-forward, block-backward, MEP gate.

    ``room_activities`` maps activity_id → assessment dict (camelCase or
    snake_case keys). Returns a new dict; input is not mutated.
    """
    out: dict[str, dict] = {
        aid: deepcopy(act) if isinstance(act, dict) else act
        for aid, act in room_activities.items()
    }

    # ── Later ⇒ earlier (v4.5) — before block-backward so prerequisites ≠ 0 ─
    if ENABLE_LATER_IMPLIES_EARLIER:
        _apply_later_implies_earlier(out, WALL_FINISH_CHAIN)
        _apply_later_implies_earlier(out, COMMON_FINISH_CHAIN)

    # ── Full fill-forward on the wall-finish chain (disabled in v4) ──────────
    if ENABLE_FILL_FORWARD:
        for i in range(len(WALL_FINISH_CHAIN) - 1, 0, -1):
            down_id = WALL_FINISH_CHAIN[i]
            down = _ensure_act(out, down_id)
            if down is None or _pct(down) < COMPLETE_THRESHOLD:
                continue
            for j in range(i):
                up_id = WALL_FINISH_CHAIN[j]
                up = _ensure_act(out, up_id)
                if up is None:
                    continue
                if _pct(up) < COMPLETE_THRESHOLD:
                    logger.info(
                        "precedence fill-forward: {down}≥{thr} ⇒ {up} {before}→{after}",
                        down=down_id,
                        thr=COMPLETE_THRESHOLD,
                        up=up_id,
                        before=_pct(up),
                        after=100.0,
                    )
                    _set_pct(up, 100.0)

    # ── Block-backward on the wall-finish chain ──────────────────────────────
    # After later⇒earlier, prerequisites should already match paint coverage.
    # Still protect evidenced paint if an upstream remains at 0 for any reason.
    for i in range(len(WALL_FINISH_CHAIN) - 1):
        up_id = WALL_FINISH_CHAIN[i]
        up = _ensure_act(out, up_id)
        if up is None or _pct(up) > 0.0:
            continue
        for j in range(i + 1, len(WALL_FINISH_CHAIN)):
            down_id = WALL_FINISH_CHAIN[j]
            down = _ensure_act(out, down_id)
            if down is None:
                continue
            # Do not erase evidenced paint when upstream was scored 0.
            if down_id in _PAINT_PROTECTED_IDS and _pct(down) > 0.0:
                continue
            # Do not wipe stages that later⇒earlier already filled from paint.
            if down_id in _INFERRED_UPSTREAM_IDS and str(down.get("evidence") or "").startswith(
                "Inferred from"
            ):
                continue
            if _pct(down) > 0.0:
                logger.info(
                    "precedence block-backward: {up}=0 ⇒ {down} {before}→0",
                    up=up_id,
                    down=down_id,
                    before=_pct(down),
                )
                _set_pct(down, 0.0)

    # ── MEP↔door shutter gate (zero, do not cap) ─────────────────────────────
    mep = _ensure_act(out, _MEP_ID)
    if mep is not None and _pct(mep) > 0.0:
        doors_confirmed = any(
            (d := _ensure_act(out, door_id)) is not None and _pct(d) >= COMPLETE_THRESHOLD
            for door_id in _DOOR_SHUTTER_IDS
        )
        if not doors_confirmed:
            logger.info(
                "precedence MEP door-gate: doors incomplete ⇒ {mep} {before}→0 (zero, not cap)",
                mep=_MEP_ID,
                before=_pct(mep),
            )
            _set_pct(mep, 0.0)

    return out
