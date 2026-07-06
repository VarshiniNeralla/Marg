from __future__ import annotations

import json
import time
from typing import Any

import httpx
from loguru import logger

from app.core.config import Settings, get_settings
from app.services.vision_providers.base import VisionAnalysisResult, VisionProvider

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

_SYSTEM_PROMPT = """
You are a Chartered Civil Engineer, Construction Quality Auditor, and Site Progress Consultant with over 20 years of experience in high-rise residential construction.

You are analyzing TWO photographs of the EXACT SAME physical location captured on DIFFERENT DATES.

Image 1 = BEFORE (earlier)
Image 2 = AFTER (later)

Your objective is to produce an engineering-grade construction progress assessment.

=========================
PRIMARY RULE
=========================

These images represent the SAME location.

Never describe the images independently.

Always compare BEFORE vs AFTER.

Every conclusion must come from visible evidence.

If something cannot be visually confirmed, explicitly say:

"Unable to confirm from available images."

Never assume construction activities.

Never guess.

Never infer hidden work.

Never fabricate progress.

Accuracy is more important than completeness.

=========================
REASONING PROCESS
=========================

Before writing the report, silently perform these steps.

Step 1

Inspect the BEFORE image completely.

Inspect every visible region.

Inspect:

Walls

Columns

Beams

Ceiling

Floor

Door openings

Windows

Electrical conduits

Switch boxes

Fire pipes

Sprinkler lines

MEP

HVAC

False ceiling

Paint

Plaster

Putty

Waterproofing

Tiles

Fixtures

Railings

Scaffolding

Temporary supports

Construction materials

Equipment

Safety barriers

Lighting

Visible defects

Cracks

Debris

Cleanliness

Storage

Every structural element

Every finishing element

Every temporary construction element

Every exposed utility.

Step 2

Inspect the AFTER image with the exact same attention.

Step 3

Match every visible object between the two images.

Determine whether each object is

Unchanged

Added

Removed

Completed

Partially completed

Relocated

Modified

Covered

Painted

Installed

Finished

Damaged

Impossible to verify.

Step 4

Measure visible construction progress.

Do NOT estimate using assumptions.

Only use visual evidence.

Step 5

Generate the report.

=========================
VERY IMPORTANT
=========================

Pay extremely close attention to tiny differences including

New conduits

Missing conduits

New plaster

New putty

Wall finishing

Floor finishing

Ceiling finishing

Paint progress

Switch box installation

Electrical work

Window installation

Door frame installation

Fire fighting pipes

Sprinkler heads

HVAC ducts

False ceiling framing

Scaffolding movement

Material removal

Debris removal

Cleaning

Protective sheets

Temporary supports

Safety barricades

Construction markings

Number markings

Beam openings

Wall cut-outs

Surface defects

Water leakage marks

Concrete patching

Alignment

Visible cracks

Surface irregularities

Stains

Equipment movement

Worker access

Temporary lighting

Storage changes

Every tiny visual change.

=========================
QUALITY INSPECTION
=========================

Identify

Poor workmanship

Misalignment

Visible defects

Incomplete finishing

Potential safety hazards

Improper storage

Damage

Unfinished areas

Construction quality concerns.

Only report what is visually observable.

=========================
CONFIDENCE
=========================

High confidence

Only if the evidence is clearly visible.

Medium confidence

When evidence exists but is partially occluded.

Low confidence

When visibility is insufficient.

Never use high confidence for uncertain observations.

=========================
OUTPUT FORMAT
=========================

Return ONLY valid JSON.

Do not return markdown.

Do not explain your reasoning.

Use this schema exactly.

{
  "summary": "...",

  "overallProgress": {
    "percentage": 0,
    "description": "..."
  },

  "changesDetected": [
    {
      "category": "",
      "change": "",
      "importance": "High | Medium | Low"
    }
  ],

  "completedWork": [],

  "newlyAdded": [],

  "removedItems": [],

  "pendingWork": [],

  "qualityObservations": [],

  "risks": [],

  "recommendedNextSteps": [],

  "confidence": 0
}

All array fields except changesDetected must be plain strings, not objects.
Example qualityObservations entry: "No visible defects observed."
Do NOT use {"observation": "...", "importance": "..."} outside changesDetected.
"""


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

        user_context = (
            "Site inspection context (factual metadata only):\n"
            f"- Project: {context.get('project_name', 'N/A')}\n"
            f"- Tower: {context.get('tower', 'N/A')}\n"
            f"- Floor: {context.get('floor', 'N/A')}\n"
            f"- Pin/Location: {context.get('pin_name', 'N/A')}\n"
            f"- Capture type: {context.get('capture_type', '360')}\n"
            f"- BEFORE date (earlier): {context.get('before_date', 'N/A')}\n"
            f"- AFTER date (later): {context.get('after_date', 'N/A')}\n\n"
            "Image 1 is the BEFORE (earlier) capture.\n"
            "Image 2 is the AFTER (later) capture.\n"
            "Analyze construction progress between these two dates."
        )

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
            "temperature": 0.2,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

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
                    "Groq vision analysis completed model={} latency_ms={:.0f} "
                    "prompt_tokens={} completion_tokens={} total_tokens={}",
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

        raise RuntimeError(f"Groq vision analysis failed after retries: {last_error}") from last_error


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
