from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
from loguru import logger

from app.core.config import Settings, get_settings
from app.services.vision_providers.base import VisionAnalysisResult, VisionProvider
from app.services.vision_providers.compare_progress_prompt import (
    COMPARE_PROGRESS_SYSTEM_PROMPT as _SYSTEM_PROMPT,
    build_compare_user_context,
)

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"


def _last_col_label(cols: int) -> str:
    # A, B, C, ... for the given number of columns (cols <= 26 in practice).
    return chr(ord("A") + cols - 1)


_FLAT_LABELS_PROMPT = """You are an architectural CAD label reader, NOT a general assistant.
Your only job is OCR: read printed unit labels off this cropped region of a floor plan.

A unit label is a two-digit number next to the word "FLAT" (often inside a small hexagon/box),
e.g. "01 FLAT", "02 FLAT".

STRICT RULES:
- Read only the printed digits you can actually SEE. Never guess a flat number from position.
- If a label is blurry, cut off at the crop edge, or you are not sure, DO NOT include it.
- Do NOT assume how many flats exist. Zero is a valid answer.
- Missing a flat is acceptable. Inventing a flat is NOT.
- For each label, also report where it sits WITHIN this crop as fractions of this crop's own
  width/height (0.0 = left/top edge of THIS crop, 1.0 = right/bottom edge of THIS crop) — this is
  used only to tell two same-numbered flats in different parts of the full plan apart, so estimate
  the label's own center position honestly, not the flat's full extent.

Return ONLY valid JSON, no markdown:
{"flats": [{"number": "01", "x": 0.3, "y": 0.7}, {"number": "03", "x": 0.8, "y": 0.2}]}
(empty list if none clearly readable)."""


# Common-area / building-core labels that must NEVER be returned as apartment rooms.
#
# NOTE: bare "lobby" is deliberately NOT in this list. Many floor plans give each
# individual flat its own small entry lobby just inside its front door (e.g. "01 FLAT
# Lobby", confirmed on a real plan) — that is a flat-owned room, not shared circulation,
# and excluding it here caused it to be silently dropped from the flat's own room list,
# leaving any capture pin placed there with no matching room and forced into a
# nearest-neighbour snap onto a wrong, distant room. Only a QUALIFIED lobby name
# ("lift lobby", "service lobby") is unambiguously shared and stays excluded — see
# _is_common_area_name for the flat-scoped bare-"lobby" carve-out.
_COMMON_AREA_TERMS = (
    "lift lobby", "service lobby", "fire lift", "service lift", "lift", "staircase",
    "stair", "fire stair", "refuge", "electrical room", "elec", "pump room", "dg shaft",
    "toilet shaft", "fire shaft", "service shaft", "lift shaft", "shaft", "duct", "ac ledge",
    "ledge", "corridor", "common passage", "passage", "pot wash",
)


def _rooms_in_crop_prompt(cols: int, rows: int, target_flat_number: str | None = None) -> str:
    target_line = (
        f"""STEP 1 — Find the label reading exactly "{target_flat_number} FLAT" (or "{target_flat_number}"
  next to the word FLAT) inside this crop. This crop may show MULTIPLE flat-number labels if two
  apartments are both partly visible — you must target ONLY the "{target_flat_number}" one and
  completely ignore any other flat number's rooms, even if they look closer to the crop centre."""
        if target_flat_number
        else """STEP 1 — Locate the FLAT number label ("01 FLAT" etc.) inside this crop. That identifies the
  ONE apartment you are extracting."""
    )
    return f"""You are an architectural CAD reader. Treat this image as a CAD DRAWING, never a
photograph. Do NOT summarize, do NOT describe, do NOT assume a "typical apartment". Extract ONLY
what is physically drawn. A WRONG room is worse than a MISSING room — when in doubt, omit.

A RED GRID is overlaid: {cols} columns A-{_last_col_label(cols)} (left→right), {rows} rows
1-{rows} (top→bottom). Each cell is labelled like "C4" in its TOP-LEFT corner.

=========================
FOLLOW THIS EXACT ORDER (reason silently, output only JSON at the end)
=========================
{target_line}
STEP 2 — Determine that apartment's BOUNDARY: trace the outer walls enclosing the flat whose label
  you found. This crop may also show PARTS of neighbouring flats and the building core — you must
  IGNORE everything outside the one flat's boundary.
STEP 3 — Inside that boundary, locate every enclosed ROOM.
STEP 4 — Identify common areas (see list) so you can recognise and EXCLUDE them.
STEP 5 — Discard everything outside the apartment boundary. THEN produce JSON.

=========================
ROOM RULES
=========================
- Return a room ONLY if BOTH: (A) it is enclosed by walls, AND (B) it has a printed label OR
  unmistakable fixtures. Otherwise omit it.
- Preserve printed labels EXACTLY — punctuation, hyphens, spacing: "Living / Dining", "Drawing
  Room", "Master Bedroom", "Bedroom-2", "Bedroom-3", "Kitchen", "Utility", "Store", "Dress",
  "Puja", "Sit-Out", "Balcony", "PDR", "Handwash", "M. Toilet", "Toilet-2", "Toilet-3", "Maid-01". Never
  rename, normalise, or expand.
- Fixture inference ONLY when no label AND walls are obvious: bed→"Bedroom", kitchen platform+sink
  →"Kitchen", WC+basin→"Toilet", dining table→"Dining", sofa→"Living Room".
- NEVER invent rooms. If only Bedroom-2 and Bedroom-3 are drawn, do NOT add Bedroom-4. Do not
  invent toilets, stores, utilities, dress, puja, maid rooms, or balconies.
- NEVER merge rooms: "Living" and "Drawing Room" are separate unless the label literally says
  "Living / Dining". Never merge Living and Drawing.
- NEVER absorb small labelled rooms into a larger neighbour:
  * Printed "Puja", "Store", "Utility", "Dress", "Toilet", "Kitchen", "PDR", "Handwash" are ALWAYS their own rooms.
  * Do NOT paint those cells as "Living / Dining", "Living", "Dining", or "Sit-Out".
  * "Utility" is NOT "Sit-Out" and "Sit-Out" is NOT "Utility" — keep the printed label.
  * If Living/Dining shares a wall with Puja/Store, give Living/Dining only its own cells.
- Multiple rooms MAY share a name when the drawing shows two (two "Dress", two "Sit-Out") — return BOTH
  with their own cells. Do NOT collapse them into one.
- If a room is cut off by the crop edge and you cannot confirm it belongs to THIS flat, omit it.
- EVERY grid cell belongs to AT MOST ONE room. Two different rooms must NEVER list the same cell —
  real rooms are separated by a wall, so their cell sets never touch, let alone overlap. Before
  finalising each room's cell list, check it against every other room you are about to return: if a
  cell appears in more than one room's list, the boundary between them is wrong — re-examine the
  wall in the image and assign that cell to whichever ONE room's floor area the cell's centre
  actually falls inside, then remove it from the other room(s).

=========================
NEIGHBOUR FILTERING (critical)
=========================
For every candidate room ask: "Is this room inside THIS flat's boundary?" If there is ANY doubt,
DISCARD it. Never borrow a room (e.g. a Bedroom-3, Puja, Store, or Kitchen) from a neighbouring
apartment — even if that neighbour is visible in this crop.

=========================
NEVER RETURN THESE (building core / common areas)
=========================
Lift Lobby, Service Lobby, Fire Lift, Lift, Service Lift, Staircase, Fire Stair, Refuge
Area, Electrical Room, Pump Room, DG Shaft, Toilet Shaft, Fire Shaft, Service Shaft, Lift Shaft,
Duct, AC Ledge, Corridor, Common Passage. These belong to the building, not any flat — omit them.
EXCEPTION — a plain "Lobby" (not "Lift Lobby" or "Service Lobby") drawn INSIDE this flat's own
boundary, just past its front door, is that flat's own entry lobby — a real room belonging to
THIS flat, not shared circulation. Include it normally like any other room in this flat.

=========================
SIT-OUT (frequently missed — look carefully)
=========================
A Sit-Out is semi-open, shares a wall with Living/Bedroom, opens to the exterior, and is often
bounded by a balcony railing rather than full walls. If a printed "Sit-Out" label is present or the
geometry clearly matches, include it.

=========================
CONFIDENCE (do NOT default to 100)
=========================
100 = printed label fully visible; 90 = printed label mostly visible; 75 = fixture recognition.
If your confidence for a room is below 70, OMIT that room entirely. reason ∈ {{"printed label",
"fixture recognition"}}.

Before returning, verify: any room outside this flat? any shaft/lift-lobby/staircase/corridor? any
duplicate? invented Bedroom-4 or Maid room? merged Living+Drawing? merged Puja/Store/Utility into
Living or Sit-Out? missed Sit-Out / Utility / Puja / Store with a visible printed label? does any
grid cell appear in more than one room's cell list? Fix before output.

For each kept room list ALL grid cells its floor AREA overlaps.

Return ONLY valid JSON, no markdown, no explanation:
{{"rooms": [
  {{"name": "Living / Dining", "cells": ["C4", "D4", "C5", "D5"], "confidence": 100, "reason": "printed label"}},
  {{"name": "Sit-Out", "cells": ["B6"], "confidence": 75, "reason": "fixture recognition"}}
]}}"""


def _common_areas_prompt(cols: int, rows: int) -> str:
    return f"""You are an architectural CAD reader. This crop shows the BUILDING CORE of a floor
plan — the shared circulation between apartments. Treat it as a CAD drawing, not a photograph.

A RED GRID is overlaid: {cols} columns A-{_last_col_label(cols)} (left→right), {rows} rows
1-{rows} (top→bottom); each cell labelled like "C4" in its TOP-LEFT corner.

Identify ONLY common / core areas that are clearly labelled or unmistakable, using EXACT printed
labels where present: "Lift Lobby", "Lobby", "Service Lobby", "Fire Lift", "Lift", "Service Lift",
"Staircase", "Fire Stair", "Refuge Area", "Electrical Room", "Pump Room", "DG Shaft",
"Toilet Shaft", "Fire Shaft", "Service Shaft", "Lift Shaft", "Duct", "Corridor", "Common Passage".
Individual numbered lifts (e.g. "Lift - P1", "Fire Lift") may be grouped as "Lift Lobby" if they
sit together in a lift bank. Do NOT return apartment rooms (bedrooms, kitchens, toilets, etc.).
Do NOT invent. Below 70 confidence, omit.

For each area list ALL grid cells it overlaps.

Return ONLY valid JSON, no markdown:
{{"rooms": [
  {{"name": "Lift Lobby", "cells": ["D4", "D5"], "confidence": 100, "reason": "printed label"}},
  {{"name": "Staircase", "cells": ["C4"], "confidence": 90, "reason": "printed label"}}
]}}"""


class GroqVisionProvider(VisionProvider):
    """Groq Vision implementation using the OpenAI-compatible chat completions API."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._api_key = (self._settings.GROQ_API_KEY or "").strip()
        self._model = (self._settings.GROQ_VISION_MODEL or DEFAULT_MODEL).strip()
        self._timeout = float(self._settings.GROQ_REQUEST_TIMEOUT_SECONDS)
        self._max_retries = int(self._settings.GROQ_MAX_RETRIES)

    async def analyze_construction_progress(
        self,
        *,
        before_image_b64: str,
        after_image_b64: str,
        before_mime: str,
        after_mime: str,
        context: dict[str, str],
    ) -> VisionAnalysisResult:
        if not self._api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

        user_context = build_compare_user_context(context)

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_context},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{before_mime};base64,{before_image_b64}",
                            },
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{after_mime};base64,{after_image_b64}",
                            },
                        },
                    ],
                },
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

        return await self._chat_completion(payload, log_label="Groq vision analysis")

    async def read_flat_labels(
        self,
        *,
        image_b64: str,
        mime: str,
    ) -> VisionAnalysisResult:
        if not self._api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _FLAT_LABELS_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "List the flat numbers visible in this crop."},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                    ],
                },
            ],
            "temperature": 0.0,
            "max_tokens": 256,
            "response_format": {"type": "json_object"},
        }

        return await self._chat_completion(payload, log_label="Groq flat-label read")

    async def extract_rooms_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
        target_flat_number: str | None = None,
    ) -> VisionAnalysisResult:
        if not self._api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _rooms_in_crop_prompt(cols, rows, target_flat_number)},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": (
                            "List this unit's rooms with their grid cells. "
                            "Include every printed label — especially Puja, Store, Utility, Dress, "
                            "PDR, Handwash, Kitchen, Sit-Out, and toilets. Return BOTH Dress/Sit-Out "
                            "when the drawing shows two. Never paint those cells as Living / Dining or Sit-Out."
                        )},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                    ],
                },
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

        return await self._chat_completion(payload, log_label="Groq room extraction")

    async def extract_common_areas_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
    ) -> VisionAnalysisResult:
        if not self._api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _common_areas_prompt(cols, rows)},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "List the common/core areas with their grid cells."},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                    ],
                },
            ],
            "temperature": 0.1,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

        return await self._chat_completion(payload, log_label="Groq common-area extraction")

    async def _chat_completion(
        self,
        payload: dict[str, Any],
        *,
        log_label: str,
    ) -> VisionAnalysisResult:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        last_error: Exception | None = None
        started = time.perf_counter()

        for attempt in range(self._max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(
                        GROQ_CHAT_URL,
                        headers=headers,
                        json=payload,
                    )

                if response.status_code >= 500 and attempt < self._max_retries:
                    logger.warning(
                        "Groq API server error (attempt {}/{}): {}",
                        attempt + 1,
                        self._max_retries + 1,
                        response.status_code,
                    )
                    last_error = RuntimeError(f"Groq API error: {response.status_code}")
                    continue

                # 429 = rate limit (per-minute token/request cap). The room-map pipeline fires
                # several vision calls per floor plan, so this is expected under load — wait out
                # the window (honouring Retry-After) and retry rather than failing extraction.
                if response.status_code == 429 and attempt < self._max_retries:
                    retry_after = _parse_retry_after(response) or (2.0 * (attempt + 1))
                    logger.warning(
                        "Groq API rate limited (attempt {}/{}): retrying in {:.1f}s",
                        attempt + 1,
                        self._max_retries + 1,
                        retry_after,
                    )
                    last_error = RuntimeError("Groq API rate limited: 429")
                    await asyncio.sleep(min(retry_after, 30.0))
                    continue

                response.raise_for_status()
                body = response.json()
                latency_ms = (time.perf_counter() - started) * 1000

                usage = body.get("usage") or {}
                prompt_tokens = int(usage.get("prompt_tokens") or 0)
                completion_tokens = int(usage.get("completion_tokens") or 0)
                total_tokens = int(usage.get("total_tokens") or prompt_tokens + completion_tokens)

                choices = body.get("choices") or []
                if not choices:
                    raise RuntimeError("Groq API returned no choices")

                raw_content = (choices[0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)

                logger.info(
                    "{} completed model={} latency_ms={:.0f} "
                    "prompt_tokens={} completion_tokens={} total_tokens={}",
                    log_label,
                    self._model,
                    latency_ms,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                )

                return VisionAnalysisResult(
                    content=parsed,
                    model=self._model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    latency_ms=latency_ms,
                )

            except httpx.TimeoutException as exc:
                last_error = exc
                logger.warning(
                    "Groq API timeout (attempt {}/{}): {}",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                logger.error(
                    "Groq API HTTP error status={} body={}",
                    status,
                    exc.response.text[:500],
                )
                if status < 500:
                    raise RuntimeError(f"Groq API rejected request: {status}") from exc
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Groq API attempt {}/{} failed: {}",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )

        raise RuntimeError(f"{log_label} failed after retries: {last_error}") from last_error


def _parse_retry_after(response: httpx.Response) -> float | None:
    """Seconds to wait from a 429 response's Retry-After header, if present and numeric."""
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Groq returned invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise RuntimeError("Groq response JSON must be an object")

    return data
