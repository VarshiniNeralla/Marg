"""
Amazon Bedrock (Converse API) backend for the OpenAI-shaped chat calls the AI features already make.

The three AI clients (construction-progress analysis, vision/flat-label extraction and the Drishti assistant) build an
OpenAI-style chat payload. With ``LLM_BACKEND=bedrock`` they hand that same payload to ``chat_completion`` here, which
sends it to a Bedrock model (Amazon Nova Pro by default) through the instance's IAM role - no API key is stored - and
returns an OpenAI-shaped body, so each client's own parsing, retries and logging stay exactly as they are.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import re
import threading
from typing import Any

from loguru import logger

from app.core.config import Settings

# Converse refuses images over ~3.75 MB; stay safely under it.
_MAX_IMAGE_BYTES = int(3.5 * 1024 * 1024)
# Nova accepts up to 8000 px per side.
_MAX_IMAGE_SIDE = 8000
_DATA_URI = re.compile(r"^data:(?P<mime>[\w.+-]+/[\w.+-]+);base64,(?P<data>.*)$", re.DOTALL)
_FORMATS = {"image/jpeg": "jpeg", "image/jpg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
_JSON_INSTRUCTION = (
    "Respond with a single valid JSON object only: no markdown, no code fences and no text outside the JSON."
)

_client_lock = threading.Lock()
_clients: dict[tuple[str, float], Any] = {}


class BedrockChatError(RuntimeError):
    """A Bedrock call failed; ``retryable`` is True for throttling/timeouts/server errors."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def is_enabled(settings: Settings) -> bool:
    # getattr: minimal settings stand-ins (tests, scripts) may not define the setting at all.
    return (getattr(settings, "LLM_BACKEND", "") or "").strip().lower() == "bedrock"


def model_id(settings: Settings) -> str:
    return (settings.BEDROCK_MODEL_ID or "").strip()


def _get_client(region: str, read_timeout: float):
    key = (region, float(read_timeout))
    with _client_lock:
        client = _clients.get(key)
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "bedrock-runtime",
                region_name=region,
                config=Config(
                    read_timeout=read_timeout,
                    connect_timeout=10,
                    retries={"max_attempts": 3, "mode": "adaptive"},
                ),
            )
            _clients[key] = client
        return client


def _shrink_image(raw: bytes) -> bytes:
    """Re-encode as JPEG, scaling down until under the Converse image limits."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise BedrockChatError("Image could not be decoded for Bedrock")
    h, w = img.shape[:2]
    scale = min(1.0, _MAX_IMAGE_SIDE / max(h, w))
    quality = 90
    for _ in range(8):
        cur = img if scale >= 0.999 else cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", cur, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok and len(buf) <= _MAX_IMAGE_BYTES:
            return buf.tobytes()
        scale *= 0.8
        quality = max(70, quality - 5)
    raise BedrockChatError("Image is too large for Bedrock even after downscaling")


def _image_block(url: str) -> dict[str, Any]:
    m = _DATA_URI.match(url or "")
    if not m:
        raise BedrockChatError("Only base64 data: image URLs can be sent to Bedrock")
    mime = m.group("mime").lower()
    fmt = _FORMATS.get(mime)
    if fmt is None:
        raise BedrockChatError(f"Unsupported image type for Bedrock: {mime}")
    try:
        raw = base64.b64decode(m.group("data"), validate=False)
    except (binascii.Error, ValueError) as exc:
        raise BedrockChatError("Invalid base64 image data") from exc
    if len(raw) > _MAX_IMAGE_BYTES:
        raw, fmt = _shrink_image(raw), "jpeg"
    return {"image": {"format": fmt, "source": {"bytes": raw}}}


def _content_blocks(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"text": content}] if content.strip() else []
    blocks: list[dict[str, Any]] = []
    for part in content or []:
        kind = part.get("type")
        if kind == "text":
            if str(part.get("text") or "").strip():
                blocks.append({"text": str(part["text"])})
        elif kind == "image_url":
            image = part.get("image_url")
            blocks.append(_image_block(image.get("url") if isinstance(image, dict) else image))
    return blocks


def to_converse_request(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    """Translate an OpenAI-style chat payload into Converse arguments."""
    system: list[dict[str, Any]] = []
    messages: list[dict[str, Any]] = []
    for msg in payload.get("messages") or []:
        role = msg.get("role")
        blocks = _content_blocks(msg.get("content"))
        if not blocks:
            continue
        if role == "system":
            system.extend(blocks)
            continue
        role = "assistant" if role == "assistant" else "user"
        if messages and messages[-1]["role"] == role:  # Converse needs alternating roles
            messages[-1]["content"].extend(blocks)
        else:
            messages.append({"role": role, "content": blocks})

    wants_json = (payload.get("response_format") or {}).get("type") in {"json_object", "json_schema"}
    if wants_json:
        system.append({"text": _JSON_INSTRUCTION})

    cap = max(1, int(settings.BEDROCK_MAX_OUTPUT_TOKENS))
    requested = int(payload.get("max_tokens") or cap)
    inference: dict[str, Any] = {"maxTokens": min(requested, cap)}
    if payload.get("temperature") is not None:
        inference["temperature"] = float(payload["temperature"])

    request: dict[str, Any] = {
        "modelId": model_id(settings),
        "messages": messages,
        "inferenceConfig": inference,
    }
    if system:
        request["system"] = system
    return request


def _to_openai_body(response: dict[str, Any]) -> dict[str, Any]:
    parts = (response.get("output") or {}).get("message", {}).get("content") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    usage = response.get("usage") or {}
    prompt = int(usage.get("inputTokens") or 0)
    completion = int(usage.get("outputTokens") or 0)
    return {
        "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": response.get("stopReason")}],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": int(usage.get("totalTokens") or prompt + completion),
        },
    }


_RETRYABLE_CODES = {
    "ThrottlingException", "ServiceUnavailableException", "InternalServerException",
    "ModelTimeoutException", "ModelNotReadyException",
}


def _call_sync(request: dict[str, Any], settings: Settings) -> dict[str, Any]:
    from botocore.exceptions import BotoCoreError, ClientError

    client = _get_client(settings.BEDROCK_REGION, float(settings.VLLM_HTTP_TIMEOUT_S))
    try:
        return client.converse(**request)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        msg = exc.response.get("Error", {}).get("Message", "")
        logger.warning("Bedrock Converse rejected request code={} message={}", code, msg[:500])
        raise BedrockChatError(f"Bedrock {code}: {msg[:200]}", retryable=code in _RETRYABLE_CODES) from exc
    except BotoCoreError as exc:  # timeouts, connection resets, missing credentials
        raise BedrockChatError(f"Bedrock transport error: {exc}", retryable=True) from exc


async def chat_completion(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    """Send ``payload`` (OpenAI chat shape) to Bedrock; returns an OpenAI-shaped body."""
    request = to_converse_request(payload, settings)
    response = await asyncio.to_thread(_call_sync, request, settings)
    return _to_openai_body(response)
