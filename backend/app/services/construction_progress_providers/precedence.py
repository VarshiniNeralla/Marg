"""Construction-sequence precedence for Flat Finishing room scores (T8 / v4.4).

Passes over merged per-room activity dicts:

* **Full fill-forward — DISABLED.** Downstream completion must NOT invent
  upstream wall-punning credit from arbitrary mid-chain scores.
* **Paint ⇒ putty (v4.4)** — when primer or final coat is completed (100%),
  required putty coats are treated as completed. Putty must NEVER invent paint.
* **Block-backward** — an upstream activity still at 0% forces later dependents
  to 0%, except primer/final (and common paint stages) that already have a
  direct visual score > 0 (so evidenced paint is not erased when putty was
  miss-scored at 0 before paint⇒putty fill).
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

# v4: never invent full upstream chain credit from arbitrary downstream scores.
ENABLE_FILL_FORWARD = False

# v4.4: completed paint stages imply required putty is done.
ENABLE_PAINT_IMPLIES_PUTTY = True

# Wall-finish chain in true site order (also used by T2 M2).
WALL_FINISH_CHAIN: tuple[str, ...] = (
    "flat.wall_punning_4",
    "flat.putty_1st_coat_25",
    "flat.putty_2nd_coat_26",
    "flat.primer_1st_coat_paint_27",
    "flat.final_coat_paint_37",
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

_PAINT_IMPLIES_PUTTY_EVIDENCE = "Inferred from completed paint stage"
PAINT_IMPLIES_PUTTY_EVIDENCE = _PAINT_IMPLIES_PUTTY_EVIDENCE

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


def _set_pct(act: dict[str, Any], value: float, *, evidence: str | None = None) -> None:
    if "completionPct" in act:
        act["completionPct"] = value
    if "completion_pct" in act:
        act["completion_pct"] = value
    if "completionPct" not in act and "completion_pct" not in act:
        act["completionPct"] = value
    if evidence is not None:
        if "evidence" in act or evidence:
            act["evidence"] = evidence
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


def _apply_paint_implies_putty(
    out: dict[str, dict],
    *,
    paint_ids: tuple[str, ...],
    putty_ids: tuple[str, ...],
) -> None:
    if not any(_pct(_ensure_act(out, pid)) >= COMPLETED_STATUS_PCT for pid in paint_ids):
        return
    for putty_id in putty_ids:
        # Only fill when the putty activity is in scope for this room (already
        # present) or when a paint stage in the same section is present.
        if putty_id not in out and not any(pid in out for pid in paint_ids):
            continue
        up = _ensure_or_create(out, putty_id)
        before = _pct(up)
        if before < COMPLETED_STATUS_PCT:
            logger.info(
                "precedence paint⇒putty: paint complete ⇒ {up} {before}→100",
                up=putty_id,
                before=before,
            )
            _set_pct(up, 100.0, evidence=_PAINT_IMPLIES_PUTTY_EVIDENCE)


def apply_precedence(room_activities: dict[str, dict]) -> dict:
    """Apply paint⇒putty, optional fill-forward, block-backward, then MEP gate.

    ``room_activities`` maps activity_id → assessment dict (camelCase or
    snake_case keys). Returns a new dict; input is not mutated.

    Full fill-forward is off when ``ENABLE_FILL_FORWARD`` is False (v4 default).
    Paint⇒putty runs when ``ENABLE_PAINT_IMPLIES_PUTTY`` is True (v4.4).
    """
    out: dict[str, dict] = {
        aid: deepcopy(act) if isinstance(act, dict) else act
        for aid, act in room_activities.items()
    }

    # ── Paint ⇒ putty (v4.4) — before block-backward so putty is no longer 0 ─
    if ENABLE_PAINT_IMPLIES_PUTTY:
        _apply_paint_implies_putty(out, paint_ids=_FLAT_PAINT_IDS, putty_ids=_FLAT_PUTTY_IDS)
        _apply_paint_implies_putty(out, paint_ids=_COMMON_PAINT_IDS, putty_ids=_COMMON_PUTTY_IDS)

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
    paint_complete = any(
        _pct(_ensure_act(out, pid)) >= COMPLETED_STATUS_PCT for pid in _FLAT_PAINT_IDS
    )
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
            # v4.4: do not erase evidenced paint when upstream putty/punning
            # was scored 0.
            if down_id in _PAINT_PROTECTED_IDS and _pct(down) > 0.0:
                continue
            # v4.4: paint⇒putty already filled putty — do not let wall_punning=0
            # wipe that inference.
            if paint_complete and down_id in _FLAT_PUTTY_IDS:
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
