from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
from loguru import logger

from app.core.config import Settings, get_settings
from app.services.vision_providers.base import VisionAnalysisResult, VisionProvider
from app.services.vision_providers.groq_provider import (
    _FLAT_LABELS_PROMPT,
    _SYSTEM_PROMPT,
    _common_areas_prompt,
    _parse_retry_after,
    _rooms_in_crop_prompt,
)
from app.services.vision_providers.compare_progress_prompt import build_compare_user_context


class VllmVisionProvider(VisionProvider):
    """Local vLLM OpenAI-compatible vision provider for construction progress analysis."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        base = (self._settings.VLLM_BASE_URL or "http://127.0.0.1:8000").strip().rstrip("/")
        self._chat_url = f"{base}/v1/chat/completions"
        self._model = (self._settings.VLLM_MODEL or "gemma4-31b").strip()
        self._api_key = (self._settings.VLLM_API_KEY or "").strip()
        self._timeout = float(self._settings.VLLM_HTTP_TIMEOUT_S)
        self._max_retries = int(self._settings.VLLM_MAX_RETRIES)
        self._temperature = float(self._settings.VLLM_TEMPERATURE)
        self._max_tokens = int(self._settings.VLLM_MAX_TOKENS)

    async def analyze_construction_progress(
        self,
        *,
        before_image_b64: str,
        after_image_b64: str,
        before_mime: str,
        after_mime: str,
        context: dict[str, str],
    ) -> VisionAnalysisResult:
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
            "temperature": min(self._temperature, 0.15),
            "max_tokens": self._max_tokens,
            "response_format": {"type": "json_object"},
        }

        return await self._chat_completion(payload, log_label="vLLM vision analysis")

    async def read_flat_labels(
        self,
        *,
        image_b64: str,
        mime: str,
    ) -> VisionAnalysisResult:
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
            # Deterministic, precision-first: no creativity when reading printed labels.
            "temperature": 0.0,
            "max_tokens": 512,
            "response_format": {"type": "json_object"},
        }
        return await self._chat_completion(payload, log_label="vLLM flat-label read")

    async def extract_rooms_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
        target_flat_number: str | None = None,
    ) -> VisionAnalysisResult:
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
                            "when the drawing shows two. Never paint those cells as Living / Dining."
                        )},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                    ],
                },
            ],
            # Low temperature for faithful, non-inventive extraction.
            "temperature": 0.1,
            "max_tokens": min(self._max_tokens, 4096),
            "response_format": {"type": "json_object"},
        }
        return await self._chat_completion(payload, log_label="vLLM room extraction")

    async def extract_common_areas_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
    ) -> VisionAnalysisResult:
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
            "max_tokens": min(self._max_tokens, 4096),
            "response_format": {"type": "json_object"},
        }
        return await self._chat_completion(payload, log_label="vLLM common-area extraction")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _chat_completion(
        self,
        payload: dict[str, Any],
        *,
        log_label: str,
    ) -> VisionAnalysisResult:
        last_error: Exception | None = None
        started = time.perf_counter()

        for attempt in range(self._max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(
                        self._chat_url,
                        headers=self._headers(),
                        json=payload,
                    )

                if response.status_code >= 500 and attempt < self._max_retries:
                    logger.warning(
                        "vLLM API server error (attempt {}/{}): {}",
                        attempt + 1,
                        self._max_retries + 1,
                        response.status_code,
                    )
                    last_error = RuntimeError(f"vLLM API error: {response.status_code}")
                    continue

                if response.status_code == 429 and attempt < self._max_retries:
                    retry_after = _parse_retry_after(response) or (2.0 * (attempt + 1))
                    logger.warning(
                        "vLLM API rate limited (attempt {}/{}): retrying in {:.1f}s",
                        attempt + 1,
                        self._max_retries + 1,
                        retry_after,
                    )
                    last_error = RuntimeError("vLLM API rate limited: 429")
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
                    raise RuntimeError("vLLM API returned no choices")

                raw_content = (choices[0].get("message") or {}).get("content") or ""
                parsed = _parse_json_content(raw_content)

                logger.info(
                    "{} completed model={} url={} latency_ms={:.0f} "
                    "prompt_tokens={} completion_tokens={} total_tokens={}",
                    log_label,
                    self._model,
                    self._chat_url,
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
                    "vLLM API timeout (attempt {}/{}): {}",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status = exc.response.status_code
                logger.error(
                    "vLLM API HTTP error status={} body={}",
                    status,
                    exc.response.text[:500],
                )
                if status < 500:
                    raise RuntimeError(f"vLLM API rejected request: {status}") from exc
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "vLLM API attempt {}/{} failed: {}",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )

        raise RuntimeError(f"{log_label} failed after retries: {last_error}") from last_error


def _parse_json_content(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [ln for ln in lines if not ln.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"vLLM returned invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise RuntimeError("vLLM response JSON must be an object")

    return data
