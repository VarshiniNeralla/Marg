"""
Real vision-model-backed ConstructionProgressProvider using the same local
vLLM endpoint already used for room-map extraction and before/after progress
analysis elsewhere in this codebase (app/services/vision_providers/vllm_provider.py).

Design: one vision call per capture image (not per activity — 49 activities x
N captures would be far too many calls), asking the model to identify which
of the given activities are visible in THIS photo and their apparent
completion state. Per-activity results are then aggregated across every
capture available for the floor: an activity's final completion % is the
average of every capture that reported evidence for it; an activity no
capture ever reported on stays "unable_to_determine" — never guessed.
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
    FloorProgressResult,
)

_VALID_STATUSES = {"not_started", "in_progress", "mostly_complete", "completed", "unable_to_determine"}

# A capture the model itself was unsure about (weak/indirect/partial view) must not surface as
# "evidence" for an activity or be averaged into its score — see the confidence-floor check in
# assess_floor_progress for why (an unrelated-room photo landing under an activity as if it were
# confirming evidence).
_MIN_EVIDENCE_CONFIDENCE = 50.0

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
- A bare, unplastered concrete/block wall means all wall-finish activities are "not_started".
- Mark an activity "unable_to_determine" (by omitting it) whenever this specific photo does
  not clearly show that activity's own work — it is normal and expected for most photos to
  only speak to a handful of checklist items, not most of them. Do not pad the response with
  inferred activities to seem thorough.
- Never fabricate evidence for something the photo contradicts or that is truly absent from
  frame (e.g. do not claim toilet fixtures are installed if the toilet itself is not visible
  at all in this photo).
- completion_pct is YOUR estimate of how finished that specific activity looks (0-100), based
  strictly on what this photo directly shows.
- confidence_pct (0-100) reflects how certain you are, given image quality, framing, and how
  directly you observed it — a direct, clear, close view scores high; anything inferred,
  partial, distant, or ambiguous must score low (well under 50).
- status must be exactly one of: "not_started", "in_progress", "mostly_complete", "completed".

Respond ONLY with a JSON object of this exact shape:
{
  "assessments": [
    {"activity_id": "<id from the checklist>", "status": "in_progress", "completion_pct": 55, "confidence_pct": 70}
  ]
}
Omit any activity this photo does not clearly and directly show. Do not include any other text.
"""


def _activities_checklist_text(activities: list[ActivityDef]) -> str:
    lines = [f"- {a.activity_id}: {a.name} ({'flat interior' if a.section == 'flat' else 'common/shared area'})"
             for a in activities]
    return "Checklist of finishing activities to assess:\n" + "\n".join(lines)


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
    ) -> FloorProgressResult:
        if not captures:
            return FloorProgressResult(
                overall_progress_pct=0.0,
                overall_confidence_pct=0.0,
                activities=[
                    ActivityAssessment(activity=a, status="unable_to_determine", completion_pct=0.0, confidence_pct=0.0)
                    for a in activities
                ],
                executive_summary="No captures are available for this floor yet — analysis requires at least one uploaded photo.",
                model=self._model,
            )

        activities_by_id = {a.activity_id: a for a in activities}
        checklist_text = _activities_checklist_text(activities)

        # One real vision call per capture, run concurrently (bounded) —
        # each capture is assessed independently against the full checklist.
        semaphore = asyncio.Semaphore(3)

        async def _assess_one(capture: CaptureRef) -> tuple[CaptureRef, dict[str, dict[str, Any]]]:
            async with semaphore:
                try:
                    result = await self._assess_capture(capture, checklist_text)
                    return capture, result
                except Exception as exc:
                    logger.warning(
                        "[construction-progress] vLLM assessment failed for capture={}: {}",
                        capture.capture_id, exc,
                    )
                    return capture, {}

        results = await asyncio.gather(*[_assess_one(c) for c in captures])

        # Aggregate per activity across all captures that reported on it.
        per_activity_pcts: dict[str, list[float]] = {}
        per_activity_conf: dict[str, list[float]] = {}
        per_activity_evidence: dict[str, list[str]] = {}
        for capture, per_capture in results:
            for activity_id, entry in per_capture.items():
                if activity_id not in activities_by_id:
                    continue
                # A wrong/weak match is worse than a missing one: a capture the
                # model itself was unsure about must not surface as "evidence"
                # for an activity, or be averaged into that activity's score —
                # this is what let a photo of an unrelated room get shown
                # alongside genuinely relevant ones under the same activity.
                if entry["confidence_pct"] < _MIN_EVIDENCE_CONFIDENCE:
                    continue
                per_activity_pcts.setdefault(activity_id, []).append(entry["completion_pct"])
                per_activity_conf.setdefault(activity_id, []).append(entry["confidence_pct"])
                per_activity_evidence.setdefault(activity_id, []).append(capture.capture_id)

        assessments: list[ActivityAssessment] = []
        for activity in activities:
            pcts = per_activity_pcts.get(activity.activity_id)
            if not pcts:
                assessments.append(
                    ActivityAssessment(
                        activity=activity, status="unable_to_determine",
                        completion_pct=0.0, confidence_pct=0.0, evidence_capture_ids=[],
                    )
                )
                continue
            avg_pct = sum(pcts) / len(pcts)
            confs = per_activity_conf.get(activity.activity_id, [])
            avg_conf = sum(confs) / len(confs) if confs else 0.0
            status = _status_for_pct(avg_pct)
            evidence = per_activity_evidence.get(activity.activity_id, [])[:3]
            assessments.append(
                ActivityAssessment(
                    activity=activity, status=status,
                    completion_pct=round(avg_pct, 1), confidence_pct=round(avg_conf, 1),
                    evidence_capture_ids=evidence,
                )
            )

        determined = [a for a in assessments if a.status != "unable_to_determine"]
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
        # imagesAnalyzedCount / activitiesPending, shown separately).
        overall_confidence_pct = round(sum(a.confidence_pct for a in determined) / len(determined), 1) if determined else 0.0

        executive_summary = _build_executive_summary(assessments, overall_progress_pct, len(captures))

        return FloorProgressResult(
            overall_progress_pct=overall_progress_pct,
            overall_confidence_pct=overall_confidence_pct,
            activities=assessments,
            executive_summary=executive_summary,
            model=self._model,
        )

    async def _assess_capture(self, capture: CaptureRef, checklist_text: str) -> dict[str, dict[str, Any]]:
        image_bytes, mime = await download_image(capture.image_url, timeout=self._timeout)
        image_bytes = resize_if_needed(image_bytes)
        image_b64 = base64.b64encode(image_bytes).decode("ascii")

        user_text = (
            f"Room/location shown: {capture.room_name} ({capture.flat_name}).\n\n"
            f"{checklist_text}\n\n"
            "Assess this photo against the checklist above per the system instructions."
        )

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                    ],
                },
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


def _status_for_pct(pct: float) -> ActivityStatus:
    if pct <= 2:
        return "not_started"
    if pct < 55:
        return "in_progress"
    if pct < 92:
        return "mostly_complete"
    return "completed"


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
    determined = [a for a in assessments if a.status != "unable_to_determine"]
    if not determined:
        return (
            f"{image_count} image(s) were analyzed but no finishing activities could be confidently "
            "identified yet — more captures covering different rooms may be needed."
        )
    completed = [a for a in determined if a.status == "completed"]
    in_progress = [a for a in determined if a.status in ("in_progress", "mostly_complete")]
    pending = [a for a in determined if a.status == "not_started"]
    undetermined_count = len(assessments) - len(determined)

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
    pending_names = _names(pending, 3)
    if pending_names:
        parts.append(f"{', '.join(pending_names)} not yet started.")
    if undetermined_count:
        parts.append(f"{undetermined_count} activit{'y' if undetermined_count == 1 else 'ies'} could not be confirmed from the available photos.")
    return " ".join(parts)
