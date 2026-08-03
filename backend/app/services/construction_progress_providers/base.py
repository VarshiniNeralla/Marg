"""
Abstract interface for AI construction-progress assessment providers.

Sibling to `app.services.vision_providers.base.VisionProvider` — deliberately
NOT the same ABC, since `VisionProvider`'s methods are shaped around pairwise
image comparison (before/after) or single-crop extraction, whereas assessing
a whole floor's progress against a checklist of activities is a different
shape of call (many images, many activities, one floor). The service layer
(`construction_progress_service.py`) depends only on this interface, so a
real vision-model-backed provider (see vllm_provider.py) can replace another
one later without any change to the API endpoints, Mongo schema, or frontend.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.services.construction_progress_providers.activities import ActivityDef

# A construction manager wants a binary read ("is this done or not"), not
# five shades of maybe — so "mostly_complete" collapses into "in_progress":
# nothing is "completed" until it's visibly, confidently finished. But an
# activity NOBODY has photographed anywhere on the floor is not "in
# progress" (that would claim work has been observed starting, which is
# false) — it gets its own "no_evidence" state, distinct from a genuinely
# observed partial/incomplete finish.
ActivityStatus = Literal["no_evidence", "in_progress", "completed"]


@dataclass(frozen=True)
class CaptureRef:
    """One capture available as evidence for a floor, with just enough context
    for a provider to reason about which activity it's plausible evidence for.

    `pin_id` identifies the physical spot this photo was taken from. A pin can
    be photographed more than once over time (e.g. a "before" shot and a later
    "after" shot of the same room) — `pin_id` is what lets a provider group
    those together and treat only the most recent one as scoring evidence,
    rather than averaging an old and a new photo of the same spot as if they
    were two independent rooms."""

    capture_id: str
    pin_id: str
    room_name: str
    flat_name: str
    captured_at: datetime | None
    image_url: str


@dataclass(frozen=True)
class ActivityAssessment:
    activity: ActivityDef
    status: ActivityStatus
    completion_pct: float
    confidence_pct: float
    evidence_capture_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RoomActivityAssessment:
    """One activity's outcome within ONE specific room of a flat."""

    activity_id: str
    activity_name: str
    completion_pct: float
    confidence_pct: float
    evidence_capture_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RoomProgress:
    """A single room's own finishing status — the real unit "Flat Finishing
    Works" completion is now built from (see FlatProgress)."""

    room_name: str
    # True only when EVERY activity confirmed in this room individually
    # reached the completion threshold; a room with zero confirmed
    # activities is never "complete" (nothing to confirm yet).
    is_complete: bool
    activities: list[RoomActivityAssessment] = field(default_factory=list)


@dataclass(frozen=True)
class FlatProgress:
    """A physical flat's own finishing status, for the Flat Finishing Works
    view: `completion_pct` = (rooms complete) / (total rooms in the flat's
    room-map roster) — a flat only reaches 100% once every one of its rooms
    is independently complete, not once any single room is photographed."""

    flat_name: str
    completion_pct: float
    rooms_complete: int
    rooms_total: int
    rooms: list[RoomProgress] = field(default_factory=list)


@dataclass(frozen=True)
class FloorProgressResult:
    overall_progress_pct: float
    overall_confidence_pct: float
    activities: list[ActivityAssessment]
    executive_summary: str
    model: str
    # capture_id -> every completion_pct THAT capture's own assessment
    # reported (after the confidence floor), across all activities. This is
    # the raw per-capture signal a room's own heatmap status needs — a
    # "flat" activity's headline completion_pct is a per-ROOM average (see
    # assess_floor_progress), so a specific room's own genuine progress can
    # still differ from what its floor-wide activity card shows. Defaults to
    # {} for providers that don't populate it (falls back to the old
    # room-heatmap behaviour driven by each activity's winning evidence
    # capture).
    per_capture_completion: dict[str, list[float]] = field(default_factory=dict)
    # Per-flat, per-room breakdown for the Flat Finishing Works view — see
    # FlatProgress/RoomProgress. Empty for providers/tests that don't
    # populate it or when no room-map roster was supplied.
    flat_progress: list[FlatProgress] = field(default_factory=list)


class ConstructionProgressProvider(ABC):
    """Assesses a floor's finishing-activity checklist from its uploaded captures."""

    @abstractmethod
    async def assess_floor_progress(
        self,
        *,
        floor_id: str,
        activities: list[ActivityDef],
        captures: list[CaptureRef],
        as_of: datetime,
        flat_units: list[str] | None = None,
        common_area_units: list[str] | None = None,
        flat_room_rosters: dict[str, list[str]] | None = None,
    ) -> FloorProgressResult:
        """
        Assess every activity in `activities` against the evidence available in
        `captures`, as of `as_of` (so re-running "today" vs. a past date can
        differ, and re-running the SAME date is expected to be deterministic).

        `flat_units` is every physical flat on this floor per the room map
        (e.g. "Flat 01 (A)", "Flat 01 (B)", ...) — a "flat" activity's
        completion_pct is the average of every ROOM's own completion across
        every flat's roster (see `flat_room_rosters`), so a single
        photographed room can no longer make its whole flat read as done for
        that activity. `common_area_units` is the equivalent list of
        common-area rooms (e.g. "Lobby", "Lift Lobby", ...), used the same
        way for "common" activities (common areas have no further per-flat
        breakdown, so they stay unit = room directly).

        `flat_room_rosters` maps each flat name to every room name it
        contains per the room map — the denominator for that flat's OWN
        completion_pct (rooms complete / rooms total) in the returned
        `flat_progress`, and for the room-level denominator behind each flat
        activity's floor-wide percentage. All three roster params default to
        None for callers/tests without a room map, in which case an
        activity's completion_pct falls back to a plain average across
        whatever captures reported on it (the old behaviour), and
        `flat_progress` is left empty.
        """
