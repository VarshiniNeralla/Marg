"""
Minimal text-only LLM client for Drishti.

Deliberately NOT part of either existing provider hierarchy
(`construction_progress_providers/vllm_provider.py` or the older
`vision_providers/vllm_provider.py`) — both are vision-call-shaped (image
payloads, surface-group batching); Drishti's calls are plain text-in/text-out
(a question + a compact JSON facts payload -> a structured JSON answer).

The function signature below only accepts plain string prompts — there is no
code path here that can attach an `image_url` content part, which structurally
enforces "no images sent to the LLM in v1" rather than leaving it as a policy
note someone could accidentally violate later.

Uses the exact same VLLM_* settings as the existing providers — no new env
vars are introduced.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Optional

import httpx
from loguru import logger

from app.core.config import Settings, get_settings


class DrishtiLLMError(RuntimeError):
    """Raised when the LLM call fails or returns unparsable content after
    retries. Callers must catch this and degrade to a safe fallback answer —
    it must never propagate as a raw 500 to the API response."""


async def chat_completion_json(
    system_prompt: str,
    user_prompt: str,
    *,
    settings: Optional[Settings] = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    usage_out: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Returns the parsed JSON content (unchanged contract). When `usage_out`
    is passed, it is mutated in place with `model`, `usage` (the raw
    OpenAI-shaped usage object), and `latency_ms` on success — callers that
    don't care about token accounting simply omit it."""
    settings = settings or get_settings()
    base = (settings.VLLM_BASE_URL or "http://127.0.0.1:8000").strip().rstrip("/")
    chat_url = f"{base}/v1/chat/completions"
    model = (settings.VLLM_MODEL or "gemma4-31b").strip()
    api_key = (settings.VLLM_API_KEY or "").strip()
    timeout = float(settings.VLLM_HTTP_TIMEOUT_S)
    max_retries = int(settings.VLLM_MAX_RETRIES)

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature if temperature is not None else settings.VLLM_TEMPERATURE,
        "max_tokens": max_tokens if max_tokens is not None else settings.VLLM_MAX_TOKENS,
        "response_format": {"type": "json_object"},
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    last_error: Optional[Exception] = None
    started = time.perf_counter()

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(chat_url, headers=headers, json=payload)

            if response.status_code >= 500 and attempt < max_retries:
                last_error = DrishtiLLMError(f"Drishti LLM API error: {response.status_code}")
                continue
            if response.status_code == 429 and attempt < max_retries:
                await asyncio.sleep(min(2.0 * (attempt + 1), 30.0))
                last_error = DrishtiLLMError("Drishti LLM API rate limited: 429")
                continue

            response.raise_for_status()
            body = response.json()
            latency_ms = (time.perf_counter() - started) * 1000
            choices = body.get("choices") or []
            if not choices:
                raise DrishtiLLMError("Drishti LLM API returned no choices")
            raw_content = (choices[0].get("message") or {}).get("content") or ""
            parsed = _parse_json_content(raw_content)
            logger.info("Drishti LLM call completed model={} latency_ms={:.0f}", model, latency_ms)
            if usage_out is not None:
                usage_out["model"] = model
                usage_out["usage"] = body.get("usage") or {}
                usage_out["latency_ms"] = latency_ms
            return parsed
        except httpx.TimeoutException as exc:
            last_error = exc
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if exc.response.status_code < 500:
                # A 4xx here (e.g. context-length exceeded) previously
                # surfaced as a bare status code with the server's actual
                # explanation discarded — a real bug where a 400 "context
                # window exceeded" was indistinguishable from a genuine
                # malformed-request error, and both looked identical to the
                # caller's generic "couldn't structure a confident answer"
                # fallback text with no way to diagnose which one occurred
                # short of manually replaying the request. Logging the
                # response body means this class of failure is visible in
                # server logs going forward instead of requiring that.
                logger.warning(
                    "Drishti LLM API rejected request status={} body={}",
                    exc.response.status_code, exc.response.text[:2000],
                )
                raise DrishtiLLMError(f"Drishti LLM API rejected request: {exc.response.status_code}") from exc
        except DrishtiLLMError:
            raise
        except Exception as exc:  # noqa: BLE001 - convert any transport-level failure
            last_error = exc

    raise DrishtiLLMError(f"Drishti LLM call failed after retries: {last_error}") from last_error


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DrishtiLLMError(f"Drishti LLM returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise DrishtiLLMError("Drishti LLM response JSON must be an object")
    return data
