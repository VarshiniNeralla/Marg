"""Canonical per-flat functional room lists for Flat Finishing Works.

AI room-map extract + geometry sanitize can omit or cull real spaces
(Kitchen/Utility on Flat 03, Multi-Purpose, labeled Dress/Balcony, etc.).
Flat Finishing must still list every functional room the floor plan shows.
"""
from __future__ import annotations

import re

# 3BHK wing (Floor-4 Flat 01 / Flat 03 — mirrored layouts).
_LAYOUT_3BHK: tuple[str, ...] = (
    "Master Bedroom",
    "Bedroom-2",
    "Bedroom-3",
    "Drawing Room",
    "Living / Dining",
    "Multi-Purpose Room",
    "Kitchen",
    "Utility",
    "M. Toilet",
    "Toilet-2",
    "Toilet-3",
    "PDR",
    "Dress (Master Bedroom)",
    "Dress (Bedroom-2)",
    "Puja",
    "Store",
    "Sit-Out",
    "Balcony",
)

# 4BHK wing (Floor-4 Flat 02; Flat 04 shares the core set).
_LAYOUT_4BHK: tuple[str, ...] = (
    "Drawing Room",
    "Living / Dining",
    "Master Bedroom",
    "Bedroom-2",
    "Bedroom-3",
    "Bedroom-4",
    "Kitchen",
    "Utility",
    "Sit-Out",
    "Balcony (Bedroom-3 side)",
    "Balcony (Bedroom-4 side)",
    "Toilet-1",
    "Toilet-2",
    "Toilet-3",
    "M. Toilet",
    "Dress (Master Bedroom)",
    "Dress (Bedroom-2)",
    "Dress (Bedroom-4)",
    "PDR",
    "Puja",
    "Store",
)


def _norm(name: str) -> str:
    n = str(name or "").strip().lower()
    n = re.sub(r"\s+", " ", n)
    n = n.replace("powder room", "pdr")
    n = n.replace("master toilet", "m. toilet")
    n = n.replace("m toilet", "m. toilet")
    n = n.replace("sit out", "sit-out")
    n = n.replace("multi purpose", "multi-purpose")
    n = n.replace("multipurpose", "multi-purpose")
    return n


def _base(name: str) -> str:
    """Strip parenthetical disambiguator: 'Dress (Master Bedroom)' → 'dress'."""
    n = _norm(name)
    return re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()


def _flat_num(flat_name: str) -> int | None:
    m = re.search(r"(\d+)", str(flat_name or ""))
    return int(m.group(1)) if m else None


def template_for_flat(flat_name: str, existing: list[str] | None = None) -> tuple[str, ...]:
    num = _flat_num(flat_name)
    if num in (1, 3):
        return _LAYOUT_3BHK
    if num in (2, 4):
        return _LAYOUT_4BHK
    beds = sum(
        1
        for r in (existing or [])
        if "bedroom" in _norm(r) and "dress" not in _norm(r)
    )
    return _LAYOUT_4BHK if beds >= 4 else _LAYOUT_3BHK


def _is_bleed_for_layout(name: str, template: tuple[str, ...]) -> bool:
    base = _base(name)
    compact = base.replace(" ", "")
    # Toilet-04 / Maid-04 are neighbour OCR junk on 3BHK wings only.
    # On 4BHK flats (Flat 02 / 04) Toilet-04 is often the real fourth toilet
    # label on the floor plan — dropping it orphans scored captures.
    if template == _LAYOUT_3BHK and re.match(
        r"^(toilet-?0?4|maid-?0?4|maid|bedroom-4|toilet-4)$", compact
    ):
        return True
    return False


def complete_flat_room_roster(flat_name: str, existing: list[str]) -> list[str]:
    """Union map-extracted rooms with the flat's canonical functional list.

    - Ensures every expected room appears (even with zero captures).
    - Expands a single plain \"Dress\" into labeled Dress rooms when needed.
    - Drops neighbour-bleed rooms (Bedroom-4 on 3BHK, Toilet-04, …).
    - Keeps extra real rooms (Lobby, Handwash, …) that are not bleed.
    """
    if _norm(flat_name) in {"common area", "common", "unknown"}:
        return [str(r).strip() for r in existing if str(r).strip()]

    existing = [str(r).strip() for r in existing if str(r).strip()]
    template = template_for_flat(flat_name, existing)
    kept_existing = [r for r in existing if not _is_bleed_for_layout(r, template)]

    used: set[str] = set()
    out: list[str] = []

    available_by_base: dict[str, list[str]] = {}
    for name in kept_existing:
        available_by_base.setdefault(_base(name), []).append(name)

    for exp in template:
        exp_n = _norm(exp)
        exp_base = _base(exp)
        pool = available_by_base.get(exp_base) or []
        chosen: str | None = None

        # 1) Exact match (already correctly labeled).
        for cand in pool:
            if _norm(cand) in used:
                continue
            if _norm(cand) == exp_n:
                chosen = cand
                used.add(_norm(cand))
                break

        # 2) Plain base (e.g. "Dress") → emit the expected labeled name.
        if chosen is None:
            for cand in pool:
                if _norm(cand) in used:
                    continue
                if "(" not in cand:
                    chosen = exp if "(" in exp else cand
                    used.add(_norm(cand))
                    break

        # 2b) Expected is plain (Sit-Out) — keep an existing labeled extract name.
        if chosen is None and "(" not in exp:
            for cand in pool:
                if _norm(cand) in used:
                    continue
                chosen = cand
                used.add(_norm(cand))
                break

        # 3) No usable extract → insert expected name as a finishing slot.
        if chosen is None:
            # Soft aliases for combined living / PDR / M.Toilet.
            aliases = {
                "living / dining": {"living / dining", "living/dining"},
                "pdr": {"pdr", "powder room"},
                "m. toilet": {"m. toilet", "master toilet"},
                # Floor-1 Flat 02 labels the fourth toilet "Toilet-04".
                "toilet-1": {"toilet-1", "toilet-01", "toilet-04", "toilet-4"},
                "multi-purpose room": {
                    "multi-purpose room", "multipurpose room", "multi purpose room",
                },
            }
            for group in aliases.values():
                if exp_n not in group:
                    continue
                for name in kept_existing:
                    if _norm(name) in used:
                        continue
                    if _norm(name) in group or _base(name) in group:
                        chosen = name if "(" not in exp else exp
                        used.add(_norm(name))
                        break
            if chosen is None:
                chosen = exp

        if chosen not in out:
            out.append(chosen)

    # Preserve additional non-bleed rooms not already represented.
    out_norms = {_norm(n) for n in out}
    need_counts: dict[str, int] = {}
    for t in template:
        need_counts[_base(t)] = need_counts.get(_base(t), 0) + 1
    have_counts: dict[str, int] = {}
    for n in out:
        have_counts[_base(n)] = have_counts.get(_base(n), 0) + 1

    for name in kept_existing:
        if _norm(name) in used or _norm(name) in out_norms:
            continue
        b = _base(name)
        # Skip leftover differently-labeled Dress/Sit-Out/Balcony once slots filled.
        if b in need_counts and have_counts.get(b, 0) >= need_counts[b]:
            continue
        out.append(name)
        out_norms.add(_norm(name))
        have_counts[b] = have_counts.get(b, 0) + 1

    rank = {_norm(t): i for i, t in enumerate(template)}
    base_rank = {_base(t): i for i, t in enumerate(template)}

    def sort_key(n: str) -> tuple[int, int, str]:
        nn = _norm(n)
        if nn in rank:
            return (0, rank[nn], nn)
        b = _base(n)
        if b in base_rank:
            return (0, base_rank[b], nn)
        return (1, 0, nn)

    out.sort(key=sort_key)
    return out
