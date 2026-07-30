"""
Predefined finishing-activity checklist for AI Construction Progress Monitoring.

This is the single source of truth for what gets scored per floor — both the
mock provider (mock_provider.py) and the frontend (via GET
/construction-progress/activities) read from this list, so there is never a
second copy to keep in sync.

`sequence_index` reflects the REAL construction order these activities
happen in on site (as given in the product requirement doc) — the mock
provider's progress-cursor model relies on this ordering to make early
activities mock as more complete than later ones.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActivityDef:
    activity_id: str
    name: str
    section: str  # "flat" | "common"
    sequence_index: int


_FLAT_ACTIVITY_NAMES = [
    "Corecutting for Services",
    "Floor Screed",
    "Ceiling Punning",
    "MEP Ceiling Services (Plumbing, Fire, Gas)",
    "Wall Punning",
    "Main Door Frame",
    "False Ceiling Framing",
    "Plumbing (PVC & Waterline)",
    "Waterproofing",
    "Toilet Door Frame",
    "Plumbing Diverter & Flush Valve Fixing",
    "Ventilator Fixing",
    "Ledge Wall",
    "MS Railing for Utility",
    "Toilet, Utility & Balcony Flooring",
    "Toilet & Utility Dado",
    "Vitrified Flooring",
    "Toilet, Sitout & Balcony Copings",
    "Internal Door Frames",
    "Kitchen Bracket Fixing, Granite Fixing & Dado",
    "Window W3A, Utility Door & SLD Fixing",
    "Main Door Shutter Fixing (Temporary)",
    "Internal Door Shutter Fixing with Hardware",
    "Electrical Wiring",
    "False Ceiling Boxing",
    "Putty 1st Coat",
    "Putty 2nd Coat",
    "Primer & 1st Coat Paint",
    "False Ceiling in Toilets, Sitouts & Utilities",
    "Normal Cleaning",
    "Toilet Grouting",
    "Modular Switches & Sockets, Signal Booster Fixing",
    "FA Fixing",
    "Gas Meter Fixing",
    "CP Fixtures & Sanitary Fixtures",
    "Balcony Glass Railing",
    "Main Door & Internal Door Polishing",
    "Final Coat Paint",
    "Deep Cleaning",
]

_COMMON_AREA_ACTIVITY_NAMES = [
    "MEP Works (Fire Fighting, Electrical)",
    "Wall Punning Works",
    "False Ceiling Works",
    "Corridor Flooring",
    "Putty 1st Coat",
    "Putty 2nd Coat",
    "Primer & 1st Coat Paint",
    "Fire Doors & Shaft Doors",
    "Staircase Flooring",
    "Painting 2nd Coat",
]


def _slug(section: str, name: str, index: int) -> str:
    cleaned = "".join(c.lower() if c.isalnum() else "_" for c in name)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return f"{section}.{cleaned.strip('_')}_{index}"


FLAT_ACTIVITIES: list[ActivityDef] = [
    ActivityDef(
        activity_id=_slug("flat", name, i),
        name=name,
        section="flat",
        sequence_index=i,
    )
    for i, name in enumerate(_FLAT_ACTIVITY_NAMES)
]

COMMON_AREA_ACTIVITIES: list[ActivityDef] = [
    ActivityDef(
        activity_id=_slug("common", name, i),
        name=name,
        section="common",
        sequence_index=i,
    )
    for i, name in enumerate(_COMMON_AREA_ACTIVITY_NAMES)
]

ALL_ACTIVITIES: list[ActivityDef] = FLAT_ACTIVITIES + COMMON_AREA_ACTIVITIES


def activities_as_dicts() -> list[dict]:
    """Serialisable form for the GET /construction-progress/activities endpoint."""
    return [
        {
            "activityId": a.activity_id,
            "name": a.name,
            "section": a.section,
            "sequenceIndex": a.sequence_index,
        }
        for a in ALL_ACTIVITIES
    ]
