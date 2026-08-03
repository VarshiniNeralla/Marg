"""
Real vision-model-backed ConstructionProgressProvider using the same local
vLLM endpoint already used for room-map extraction and before/after progress
analysis elsewhere in this codebase (app/services/vision_providers/vllm_provider.py).

Design: one vision call per capture image (not per activity — 49 activities x
N captures would be far too many calls), asking the model to identify which
of the given activities are visible in THIS photo and their apparent
completion state. Per-activity results are then aggregated across every
capture available for the floor: an activity's final completion % is the
average of every unit's (flat/common-area room) best evidence. An activity
reads "completed" only once that average is near-total (>=92%) across every
unit on the floor; anything short of that — including an activity no capture
ever reported on — reads as "in_progress". Only two states are ever shown;
see `ActivityStatus` in base.py for why.
"""
from __future__ import annotations

import asyncio
import base64
import json
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from loguru import logger

from app.core.config import Settings, get_settings
from app.services.image_fetch import download_image, resize_if_needed
from app.services.construction_progress_providers.activities import ActivityDef
from app.services.construction_progress_providers.base import (
    ActivityAssessment,
    ActivityStatus,
    CaptureRef,
    ConstructionProgressProvider,
    FlatProgress,
    FloorProgressResult,
    RoomActivityAssessment,
    RoomProgress,
)

# A capture the model itself was unsure about (weak/indirect/partial view) must not surface as
# "evidence" for an activity or be averaged into its score — see the confidence-floor check in
# assess_floor_progress for why (an unrelated-room photo landing under an activity as if it were
# confirming evidence).
_MIN_EVIDENCE_CONFIDENCE = 50.0

# The completion_pct an activity/unit must reach to read as genuinely "done" — shared between
# _status_for_pct and the MEP/door-shutter gate below so both use the same bar for "finished".
COMPLETE_THRESHOLD = 92.0

# MEP Ceiling Services cannot be reported complete in a flat whose own door shutters aren't
# confirmed installed — see the gate in assess_floor_progress for why.
_MEP_CEILING_ACTIVITY_ID = "flat.mep_ceiling_services_plumbing_fire_gas_3"
_DOOR_SHUTTER_ACTIVITY_IDS = (
    "flat.main_door_shutter_fixing_temporary_21",
    "flat.internal_door_shutter_fixing_with_hardware_22",
)

_SYSTEM_PROMPT = """
You are a Chartered Civil Engineer and Construction Quality Auditor with over 20 years of
experience inspecting high-rise residential construction sites.

You are looking at ONE photograph from a site inspection. It may be a normal photo or an
equirectangular (360-degree) panorama showing an interior room or common area under
construction.

You will be given a checklist of finishing activities. For EACH activity, determine — using
ONLY what is directly visible in THIS image — whether there is clear evidence of it, and if
so, how complete it looks.

BE A STRICT, EVIDENCE-BASED INSPECTOR, NOT AN OPTIMISTIC ONE. Your job is to report only what
you can actually verify from this specific photo, not to fill in the rest of the checklist by
assumption. A wrong or inflated assessment is worse than an honest "cannot tell":
- Only assess an activity if its own work is visibly present in frame — e.g. only score
  "Putty 1st Coat" / "Putty 2nd Coat" / "Primer & 1st Coat Paint" / "Final Coat Paint" if you
  can actually see the relevant wall surface and its finish state; do not mark all four as
  complete just because ONE of them looks done, and do not infer a wall's paint stage from a
  different wall, a different room, or general "the place looks finished" impressions.
- Do not infer upstream/downstream steps in a sequence unless that specific step's own result
  is visible (e.g. seeing a fitted CP fixture confirms the fixture activity itself, but does
  NOT by itself confirm a separate plumbing-roughing-in checklist line unless the roughing-in
  work is also identifiably visible or obviously implied by what's shown, e.g. a working
  connected fixture with no exposed pipework).
- If this photo is a distant, partial, poorly-lit, or ambiguous view of an activity's surface,
  either omit that activity or give it a low confidence_pct — never report high confidence
  from a weak or indirect view.
- A bare, unplastered concrete/block wall means every wall-finish activity has not begun.
- Omit an activity entirely whenever this specific photo does not clearly show that
  activity's own work — it is normal and expected for most photos to only speak to a handful
  of checklist items, not most of them. Do not pad the response with inferred activities to
  seem thorough.
- Never fabricate evidence for something the photo contradicts or that is truly absent from
  frame (e.g. do not claim toilet fixtures are installed if the toilet itself is not visible
  at all in this photo).
- completion_pct is YOUR estimate of how finished that specific activity looks (0-100), based
  strictly on what this photo directly shows.
- confidence_pct (0-100) reflects how certain you are, given image quality, framing, and how
  directly you observed it — a direct, clear, close view scores high; anything inferred,
  partial, distant, or ambiguous must score low (well under 50).

Respond ONLY with a JSON object of this exact shape:
{
  "assessments": [
    {"activity_id": "<id from the checklist>", "completion_pct": 55, "confidence_pct": 70}
  ]
}
Omit any activity this photo does not clearly and directly show. Do not include any other text.
"""


def _activities_checklist_text(activities: list[ActivityDef]) -> str:
    lines = [f"- {a.activity_id}: {a.name} ({'flat interior' if a.section == 'flat' else 'common/shared area'})"
             for a in activities]
    return "Checklist of finishing activities to assess:\n" + "\n".join(lines)


# The synthetic flat name room_map_service.py stamps on every common-area
# room (lobby, lift lobby, shafts, ...), so a capture's own flat_name tells
# us definitively which section it belongs to — no guessing needed.
_COMMON_AREA_FLAT = "Common Area"


class VllmConstructionProgressProvider(ConstructionProgressProvider):
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        base = (self._settings.VLLM_BASE_URL or "http://127.0.0.1:8000").strip().rstrip("/")
        self._chat_url = f"{base}/v1/chat/completions"
        self._model = (self._settings.VLLM_MODEL or "gemma4-31b").strip()
        self._api_key = (self._settings.VLLM_API_KEY or "").strip()
        self._timeout = float(self._settings.VLLM_HTTP_TIMEOUT_S)
        self._max_retries = int(self._settings.VLLM_MAX_RETRIES)

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
        if not captures:
            return FloorProgressResult(
                overall_progress_pct=0.0,
                overall_confidence_pct=0.0,
                activities=[
                    ActivityAssessment(activity=a, status="no_evidence", completion_pct=0.0, confidence_pct=0.0)
                    for a in activities
                ],
                executive_summary="No captures are available for this floor yet — analysis requires at least one uploaded photo.",
                model=self._model,
            )

        activities_by_id = {a.activity_id: a for a in activities}
        # Each capture is shown ONLY its own section's checklist — a flat
        # interior photo never even sees the common-area activity list (and
        # vice versa). Confirmed necessary on real data: given the full mixed
        # checklist, the model repeatedly mis-tagged a flat-interior photo
        # (a bedroom/living room) with common-area activity ids like
        # "Corridor Flooring" / "Fire Doors & Shaft Doors" at 100% — evidence
        # for an activity that room can't possibly demonstrate. The roster
        # filter downstream already scrubs that mismatch out of scoring, but
        # by then the capture has already wasted its one vision call
        # answering the wrong checklist instead of its own.
        flat_checklist_text = _activities_checklist_text([a for a in activities if a.section == "flat"])
        common_checklist_text = _activities_checklist_text([a for a in activities if a.section == "common"])

        # A pin can be photographed more than once over time (e.g. a "before"
        # shot and a later "after" shot of the same spot). Only the MOST
        # RECENT capture per pin should count as scoring evidence — averaging
        # an old and a new photo of the same room as if they were two
        # independent rooms would drag a now-finished room's score back down
        # toward its earlier, unfinished state. Captures with no pin_id (e.g.
        # legacy data) each stand alone, since there's no group to collapse.
        latest_by_pin: dict[str, CaptureRef] = {}
        previous_by_pin: dict[str, CaptureRef] = {}
        standalone: list[CaptureRef] = []
        for capture in captures:
            if not capture.pin_id:
                standalone.append(capture)
                continue
            current = latest_by_pin.get(capture.pin_id)
            if current is None:
                latest_by_pin[capture.pin_id] = capture
                continue
            # Both captures carry a pin_id — keep whichever is newer as the
            # primary evidence, and remember the older one as before/after
            # context (missing captured_at sorts as older, never displacing a
            # dated one, so an unstamped upload can't wrongly become "latest").
            new_is_later = (
                capture.captured_at is not None
                and (current.captured_at is None or capture.captured_at > current.captured_at)
            )
            if new_is_later:
                previous_by_pin[capture.pin_id] = current
                latest_by_pin[capture.pin_id] = capture
            else:
                previous_by_pin[capture.pin_id] = capture

        scoring_captures = standalone + list(latest_by_pin.values())
        skipped_older = len(captures) - len(scoring_captures)
        if skipped_older:
            logger.info(
                "[construction-progress] floor={} — {} older capture(s) on an already-photographed "
                "pin excluded from scoring, kept only as before/after context",
                floor_id, skipped_older,
            )

        # One real vision call per SCORING capture (latest-per-pin), run
        # concurrently (bounded) — each is assessed independently against
        # ONLY its own section's checklist (flat vs. common, decided by
        # whether the capture's flat_name is the synthetic "Common Area"),
        # optionally with its own earlier photo attached as before/after
        # context.
        semaphore = asyncio.Semaphore(3)

        async def _assess_one(capture: CaptureRef) -> tuple[CaptureRef, dict[str, dict[str, Any]]]:
            async with semaphore:
                try:
                    is_common = capture.flat_name == _COMMON_AREA_FLAT
                    checklist_text = common_checklist_text if is_common else flat_checklist_text
                    result = await self._assess_capture(
                        capture, checklist_text, previous=previous_by_pin.get(capture.pin_id)
                    )
                    return capture, result
                except Exception as exc:
                    logger.warning(
                        "[construction-progress] vLLM assessment failed for capture={}: {}",
                        capture.capture_id, exc,
                    )
                    return capture, {}

        results = await asyncio.gather(*[_assess_one(c) for c in scoring_captures])

        # Aggregate per activity, grouped by UNIT. A "common" activity's unit
        # is the common-area room (capture.room_name) — common areas have no
        # further per-flat breakdown. A "flat" activity's unit is now the
        # SPECIFIC ROOM within its flat, (capture.flat_name, capture.room_name)
        # — NOT the whole flat. This is the fix for a real reported bug: a
        # unit of "flat" let one photographed room's evidence stand in for
        # the entire flat (a bedroom's finished ceiling made the WHOLE flat
        # read as done for "Ceiling Punning" even with a dozen unphotographed
        # rooms), inflating progress. Grouping by room means a flat's
        # activity percentage (below) is now a genuine average across every
        # room in that flat, and a flat's own completion (flat_progress) is
        # built from whether each of its rooms is independently complete.
        # Within one unit, the BEST (max) completion_pct reported by any of
        # its captures wins (a room re-photographed later takes its best
        # evidence). Evidence is likewise kept per-unit so the confirmed
        # candidate for each unit is what shows on the activity card, not
        # every capture that happened to mention the activity.
        per_activity_unit_pct: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_conf: dict[str, dict[tuple[str, str], float]] = {}
        per_activity_unit_evidence: dict[str, dict[tuple[str, str], str]] = {}
        # Raw per-CAPTURE signal (not per-unit) — a room's own heatmap status
        # must reflect what THAT capture's own photo showed, never whether a
        # sibling room in the same flat happened to score higher for the
        # same activity.
        per_capture_completion: dict[str, list[float]] = {}
        for capture, per_capture in results:
            for activity_id, entry in per_capture.items():
                activity = activities_by_id.get(activity_id)
                if activity is None:
                    continue
                # A wrong/weak match is worse than a missing one: a capture the
                # model itself was unsure about must not surface as "evidence"
                # for an activity, or be averaged into that activity's score —
                # this is what let a photo of an unrelated room get shown
                # alongside genuinely relevant ones under the same activity.
                if entry["confidence_pct"] < _MIN_EVIDENCE_CONFIDENCE:
                    continue
                per_capture_completion.setdefault(capture.capture_id, []).append(entry["completion_pct"])
                if not capture.room_name:
                    continue
                unit = (capture.flat_name, capture.room_name)
                units_pct = per_activity_unit_pct.setdefault(activity_id, {})
                units_conf = per_activity_unit_conf.setdefault(activity_id, {})
                units_evidence = per_activity_unit_evidence.setdefault(activity_id, {})
                if entry["completion_pct"] > units_pct.get(unit, -1.0):
                    units_pct[unit] = entry["completion_pct"]
                    units_conf[unit] = entry["confidence_pct"]
                    units_evidence[unit] = capture.capture_id

        # "MEP Ceiling Services" cannot be reported as finished in a ROOM
        # whose own door shutters (main or internal) aren't confirmed
        # installed IN THAT SAME ROOM — per product decision, MEP completion
        # implies the doors are hung, checked per-room now that the unit of
        # account is a room, not a whole flat (a door photo in one bedroom
        # must not silently unlock MEP credit for a different room). A room
        # failing this gate has its MEP contribution ZEROED for the roster
        # average (not merely capped just under the completion line) —
        # capping alone can't guarantee the FLOOR-WIDE average stays under
        # the completion threshold once other rooms are already at 100%, so
        # the only reliable gate is to force this room's own contribution to
        # read as "not done" outright.
        mep_pcts = per_activity_unit_pct.get(_MEP_CEILING_ACTIVITY_ID)
        if mep_pcts:
            door_pcts_by_id = [
                per_activity_unit_pct.get(door_id, {}) for door_id in _DOOR_SHUTTER_ACTIVITY_IDS
            ]
            for unit in list(mep_pcts):
                doors_confirmed = any(
                    door_pcts.get(unit, 0.0) >= COMPLETE_THRESHOLD for door_pcts in door_pcts_by_id
                )
                if not doors_confirmed:
                    mep_pcts[unit] = 0.0

        # Room-level roster: every (flat, room) that exists per the room map,
        # used as the denominator for a flat activity's floor-wide percentage
        # (below) — a room with no evidence still occupies a slot and
        # contributes 0%, extending the existing "unphotographed units count
        # as 0%" principle down to room granularity. Common-area rooms have
        # no further breakdown, so they're their own roster entry directly.
        flat_room_roster: list[tuple[str, str]] = [
            (flat_name, room_name)
            for flat_name, room_names in (flat_room_rosters or {}).items()
            for room_name in room_names
        ]
        common_room_roster: list[tuple[str, str]] = [
            (_COMMON_AREA_FLAT, room_name) for room_name in (common_area_units or [])
        ]

        assessments: list[ActivityAssessment] = []
        for activity in activities:
            units_pct = per_activity_unit_pct.get(activity.activity_id)
            if not units_pct:
                # Nobody has photographed anything relevant to this activity
                # anywhere on the floor — "in_progress" would falsely claim
                # work has been observed starting.
                assessments.append(
                    ActivityAssessment(
                        activity=activity, status="no_evidence",
                        completion_pct=0.0, confidence_pct=0.0, evidence_capture_ids=[],
                    )
                )
                continue

            # The denominator is every ROOM that EXISTS on the floor per the
            # relevant roster, not just the rooms photographed so far — a
            # room with no evidence still occupies a slot and contributes 0%,
            # which is what makes "photographed 2 of 40 rooms, both finished"
            # read as 5%, not 100%. Falls back to only-the-photographed-rooms
            # when no room-map roster was supplied (e.g. a floor plan hasn't
            # been extracted yet, or a caller/test with no room map at all).
            roster = flat_room_roster if activity.section == "flat" else common_room_roster
            all_units = roster if roster else list(units_pct.keys())
            pcts = [units_pct.get(u, 0.0) for u in all_units]
            avg_pct = sum(pcts) / len(pcts) if pcts else 0.0

            units_conf = per_activity_unit_conf.get(activity.activity_id, {})
            confs = list(units_conf.values())
            avg_conf = sum(confs) / len(confs) if confs else 0.0

            status = _status_for_pct(avg_pct)
            units_evidence = per_activity_unit_evidence.get(activity.activity_id, {})
            # Evidence must be restricted to units that are ACTUALLY part of
            # this activity's roster (real rooms for the relevant section) —
            # without this, a capture's room_name/flat_name (e.g. a flat's
            # "Living / Dining") could get recorded as a bogus "unit" for an
            # activity the model mis-associated it with. That bogus unit was
            # already correctly excluded from the completion_pct average
            # (roster-based), but with no matching filter here it still
            # leaked into the evidence list — showing a mismatched photo as
            # "evidence" for an activity, with a percentage that visibly
            # didn't match (0% average, yet an evidence photo attached)
            # because the two code paths disagreed about what counts as a
            # real unit.
            valid_units = set(all_units)
            candidate_units = [u for u in units_evidence if u in valid_units]
            # Evidence sorted by that unit's completion (most-finished units
            # first) so the photos shown are the ones best supporting the
            # reported status, capped at 3 like before.
            evidence = [
                units_evidence[u] for u in sorted(candidate_units, key=lambda u: -units_pct.get(u, 0.0))
            ][:3]
            assessments.append(
                ActivityAssessment(
                    activity=activity, status=status,
                    completion_pct=round(avg_pct, 1), confidence_pct=round(avg_conf, 1),
                    evidence_capture_ids=evidence,
                )
            )

        flat_progress = _build_flat_progress(
            activities_by_id=activities_by_id,
            per_activity_unit_pct=per_activity_unit_pct,
            per_activity_unit_conf=per_activity_unit_conf,
            per_activity_unit_evidence=per_activity_unit_evidence,
            flat_room_rosters=flat_room_rosters or {},
        )

        # "Determined" = actually assessed by at least one capture, distinct
        # from the binary in_progress/completed status (an activity with zero
        # evidence is still labelled "in_progress", but must not count toward
        # the confidence average as if it had been genuinely evaluated).
        determined = [a for a in assessments if a.confidence_pct > 0]
        # Overall progress is averaged across the FULL checklist, with any
        # activity no photo could confirm counting as 0% — not just an
        # average of the few activities that happened to be visible. A floor
        # with 3 photos covering 6 of 49 activities is genuinely NOT "100%
        # complete" just because those 6 looked finished; the other 43 are
        # unknown, which must pull the overall number down, not be excluded
        # from it entirely.
        overall_progress_pct = round(sum(a.completion_pct for a in assessments) / len(assessments), 1) if assessments else 0.0
        # Confidence is still averaged over only the DETERMINED activities —
        # "how sure are we about what we DID assess" is a separate question
        # from "how much of the checklist have we assessed at all" (that's
        # imagesAnalyzedCount / activitiesNotStarted, shown separately).
        overall_confidence_pct = round(sum(a.confidence_pct for a in determined) / len(determined), 1) if determined else 0.0

        executive_summary = _build_executive_summary(assessments, overall_progress_pct, len(captures))

        return FloorProgressResult(
            overall_progress_pct=overall_progress_pct,
            overall_confidence_pct=overall_confidence_pct,
            activities=assessments,
            executive_summary=executive_summary,
            model=self._model,
            per_capture_completion=per_capture_completion,
            flat_progress=flat_progress,
        )

    async def _assess_capture(
        self, capture: CaptureRef, checklist_text: str, *, previous: CaptureRef | None = None,
    ) -> dict[str, dict[str, Any]]:
        image_bytes, mime = await download_image(capture.image_url, timeout=self._timeout)
        image_bytes = resize_if_needed(image_bytes)
        image_b64 = base64.b64encode(image_bytes).decode("ascii")

        content: list[dict[str, Any]] = []
        prev_b64: str | None = None
        prev_mime: str | None = None
        if previous is not None and previous.image_url:
            try:
                prev_bytes, prev_mime = await download_image(previous.image_url, timeout=self._timeout)
                prev_b64 = base64.b64encode(resize_if_needed(prev_bytes)).decode("ascii")
            except Exception as exc:
                logger.warning(
                    "[construction-progress] could not load earlier capture={} for before/after "
                    "context on capture={}: {}", previous.capture_id, capture.capture_id, exc,
                )

        if prev_b64 and prev_mime:
            user_text = (
                f"Room/location shown: {capture.room_name} ({capture.flat_name}).\n\n"
                "You are given TWO photos of this SAME spot, taken at different times: an EARLIER "
                "photo first, then the CURRENT (most recent) photo second. The earlier photo is "
                "for context only — to help you see what has changed — but your assessment must "
                "describe the CURRENT state shown in the second photo. Never score or report "
                "evidence based on the earlier photo alone.\n\n"
                f"{checklist_text}\n\n"
                "Assess the CURRENT (second) photo against the checklist above per the system "
                "instructions, using the earlier photo only to help judge what has changed."
            )
            content = [
                {"type": "text", "text": user_text},
                {"type": "text", "text": "EARLIER photo (context only):"},
                {"type": "image_url", "image_url": {"url": f"data:{prev_mime};base64,{prev_b64}"}},
                {"type": "text", "text": "CURRENT photo (assess this one):"},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
            ]
        else:
            user_text = (
                f"Room/location shown: {capture.room_name} ({capture.flat_name}).\n\n"
                f"{checklist_text}\n\n"
                "Assess this photo against the checklist above per the system instructions."
            )
            content = [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
            ]

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": 0.2,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

        raw = await self._chat_completion(payload, log_label=f"construction-progress capture={capture.capture_id}")
        out: dict[str, dict[str, Any]] = {}
        for item in raw.get("assessments") or []:
            if not isinstance(item, dict):
                continue
            activity_id = str(item.get("activity_id") or "").strip()
            if not activity_id:
                continue
            try:
                pct = max(0.0, min(100.0, float(item.get("completion_pct", 0))))
                conf = max(0.0, min(100.0, float(item.get("confidence_pct", 0))))
            except (TypeError, ValueError):
                continue
            out[activity_id] = {"completion_pct": pct, "confidence_pct": conf}
        return out

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _chat_completion(self, payload: dict[str, Any], *, log_label: str) -> dict[str, Any]:
        last_error: Exception | None = None
        started = time.perf_counter()

        for attempt in range(self._max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(self._chat_url, headers=self._headers(), json=payload)

                if response.status_code >= 500 and attempt < self._max_retries:
                    last_error = RuntimeError(f"vLLM API error: {response.status_code}")
                    continue
                if response.status_code == 429 and attempt < self._max_retries:
                    await asyncio.sleep(min(2.0 * (attempt + 1), 30.0))
                    last_error = RuntimeError("vLLM API rate limited: 429")
                    continue

                response.raise_for_status()
                body = response.json()
                latency_ms = (time.perf_counter() - started) * 1000
                choices = body.get("choices") or []
                if not choices:
                    raise RuntimeError("vLLM API returned no choices")
                raw_content = (choices[0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)
                logger.info("{} completed model={} latency_ms={:.0f}", log_label, self._model, latency_ms)
                return parsed
            except httpx.TimeoutException as exc:
                last_error = exc
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code < 500:
                    raise RuntimeError(f"vLLM API rejected request: {exc.response.status_code}") from exc
            except Exception as exc:
                last_error = exc

        raise RuntimeError(f"{log_label} failed after retries: {last_error}") from last_error


def _build_flat_progress(
    *,
    activities_by_id: dict[str, ActivityDef],
    per_activity_unit_pct: dict[str, dict[tuple[str, str], float]],
    per_activity_unit_conf: dict[str, dict[tuple[str, str], float]],
    per_activity_unit_evidence: dict[str, dict[tuple[str, str], str]],
    flat_room_rosters: dict[str, list[str]],
) -> list[FlatProgress]:
    """
    Builds the Flat Finishing Works breakdown: for each flat, for each of its
    rooms, every "flat"-section activity that was confirmed there (post the
    same confidence floor and MEP gate already applied upstream) — a room is
    "complete" only if EVERY confirmed activity in it individually reached
    the completion threshold. A room with zero confirmed activities is never
    "complete" (there's nothing to confirm yet). The flat's own
    completion_pct is (rooms complete) / (rooms total in its roster) — a flat
    only reaches 100% once every one of its rooms is independently done, not
    once any single room is photographed.
    """
    flat_activity_ids = {aid for aid, a in activities_by_id.items() if a.section == "flat"}
    flats: list[FlatProgress] = []
    for flat_name, room_names in flat_room_rosters.items():
        rooms: list[RoomProgress] = []
        rooms_complete = 0
        for room_name in room_names:
            unit = (flat_name, room_name)
            room_activities: list[RoomActivityAssessment] = []
            for activity_id in flat_activity_ids:
                units_pct = per_activity_unit_pct.get(activity_id)
                if not units_pct or unit not in units_pct:
                    continue
                room_activities.append(
                    RoomActivityAssessment(
                        activity_id=activity_id,
                        activity_name=activities_by_id[activity_id].name,
                        completion_pct=units_pct[unit],
                        confidence_pct=per_activity_unit_conf.get(activity_id, {}).get(unit, 0.0),
                        evidence_capture_ids=(
                            [cid] if (cid := per_activity_unit_evidence.get(activity_id, {}).get(unit)) else []
                        ),
                    )
                )
            room_activities.sort(key=lambda a: activities_by_id[a.activity_id].sequence_index)
            is_complete = bool(room_activities) and all(
                a.completion_pct >= COMPLETE_THRESHOLD for a in room_activities
            )
            if is_complete:
                rooms_complete += 1
            rooms.append(RoomProgress(room_name=room_name, is_complete=is_complete, activities=room_activities))
        rooms_total = len(room_names)
        completion_pct = round((rooms_complete / rooms_total) * 100, 1) if rooms_total else 0.0
        flats.append(
            FlatProgress(
                flat_name=flat_name,
                completion_pct=completion_pct,
                rooms_complete=rooms_complete,
                rooms_total=rooms_total,
                rooms=rooms,
            )
        )
    return flats


def _status_for_pct(pct: float) -> ActivityStatus:
    # Only called once real evidence exists somewhere for this activity (the
    # caller handles the "nobody photographed this at all" case as
    # "no_evidence" before reaching here). "completed" requires near-total,
    # visible confirmation across every unit; anything short of that is
    # "in_progress" — a wrong "completed" is worse than an honest "still in
    # progress", so the bar stays high.
    if pct >= COMPLETE_THRESHOLD:
        return "completed"
    return "in_progress"


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"vLLM returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("vLLM response JSON must be an object")
    return data


def _build_executive_summary(assessments: list[ActivityAssessment], overall_pct: float, image_count: int) -> str:
    # "Determined" = actually assessed by at least one capture (confidence_pct
    # > 0); this naturally excludes every "no_evidence" activity, since those
    # always carry confidence_pct == 0.0.
    determined = [a for a in assessments if a.confidence_pct > 0]
    if not determined:
        return (
            f"{image_count} image(s) were analyzed but no finishing activities could be confidently "
            "identified yet — more captures covering different rooms may be needed."
        )
    completed = [a for a in determined if a.status == "completed"]
    in_progress = [a for a in determined if a.status == "in_progress"]
    not_yet_assessed_count = len(assessments) - len(determined)

    def _names(items: list[ActivityAssessment], n: int) -> list[str]:
        ordered = sorted(items, key=lambda a: a.activity.sequence_index)
        return [a.activity.name for a in ordered[:n]]

    parts = [f"Based on {image_count} analyzed image(s), this floor is approximately {overall_pct:.0f}% complete across the full finishing checklist."]
    completed_names = _names(completed, 3)
    if completed_names:
        parts.append(f"{', '.join(completed_names)} {'appears' if len(completed_names) == 1 else 'appear'} complete.")
    in_progress_names = _names(in_progress, 3)
    if in_progress_names:
        parts.append(f"{', '.join(in_progress_names)} {'is' if len(in_progress_names) == 1 else 'are'} in progress.")
    if not_yet_assessed_count:
        parts.append(f"{not_yet_assessed_count} activit{'y' if not_yet_assessed_count == 1 else 'ies'} could not be confirmed from the available photos.")
    return " ".join(parts)
