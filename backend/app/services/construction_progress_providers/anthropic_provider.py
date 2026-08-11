"""Claude (Anthropic) ConstructionProgressProvider — verification tier (T11).

Implements the same surface-group + discrete-state protocol as the local
vLLM provider. Used alone (`CONSTRUCTION_PROGRESS_PROVIDER=anthropic`) or as
the escalation target inside HybridConstructionProgressProvider.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from loguru import logger

from app.core.config import Settings, get_settings
from app.services.construction_progress_providers.activities import ActivityDef
from app.services.construction_progress_providers.base import (
    CaptureRef,
    ConstructionProgressProvider,
    FloorProgressResult,
)
from app.services.construction_progress_providers.vllm_provider import (
    VllmConstructionProgressProvider,
)


class AnthropicConstructionProgressProvider(ConstructionProgressProvider):
    """Claude vision verification tier.

    For the first ship of T11 we reuse the local surface-group orchestration
    (views, precedence, roster maths) and escalate individual surface-group
    vision calls to Anthropic when a key is configured. Full Message Batches +
    structured-output parse is behind ANTHROPIC_USE_BATCH; until the anthropic
    SDK is installed and a key is present, assess_floor_progress raises a clear
    configuration error rather than silently falling back.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: Any | None = None,
        org_id: str | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._db = db
        self._org_id = org_id
        if not (self._settings.ANTHROPIC_API_KEY or "").strip():
            logger.warning(
                "AnthropicConstructionProgressProvider constructed without ANTHROPIC_API_KEY"
            )

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
        context: dict[str, str] | None = None,
    ) -> FloorProgressResult:
        if not (self._settings.ANTHROPIC_API_KEY or "").strip():
            raise RuntimeError(
                "CONSTRUCTION_PROGRESS_PROVIDER=anthropic requires ANTHROPIC_API_KEY"
            )
        try:
            import anthropic  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "anthropic package is not installed — add it to requirements.txt (T11)"
            ) from exc

        # Delegate orchestration to the vLLM provider's assess path for now,
        # with a clear model tag. Full Claude Messages.parse / Batches wiring
        # lands when ANTHROPIC_API_KEY is live in an environment; Hybrid uses
        # escalate_surface_group below for selective re-asks.
        logger.info(
            "Anthropic provider active (model={}, effort={}, batch={}) — "
            "using hybrid-compatible orchestration shell",
            self._settings.ANTHROPIC_MODEL,
            self._settings.ANTHROPIC_EFFORT,
            self._settings.ANTHROPIC_USE_BATCH,
        )
        # For pure-anthropic mode before full Claude call path lands, fall
        # through is not available — raise so operators know to use hybrid
        # (local first) until Claude group calls are wired end-to-end.
        raise RuntimeError(
            "Full Anthropic-only assess_floor_progress is not yet wired; "
            "set CONSTRUCTION_PROGRESS_PROVIDER=hybrid for local-first + Claude escalation, "
            "or =vllm for local-only."
        )


async def escalate_surface_group_to_claude(
    *,
    settings: Settings,
    system_prompt: str,
    user_text: str,
    image_jpegs: list[bytes],
    custom_id: str,
) -> dict[str, Any] | None:
    """One Claude verification call for an ambiguous surface group.

    Returns parsed assessments dict or None on refusal / failure.
    Structured for Message Batches custom_id join.
    """
    if not (settings.ANTHROPIC_API_KEY or "").strip():
        return None
    try:
        import anthropic
        import base64
    except ImportError:
        logger.error("anthropic package missing — cannot escalate")
        return None

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    content: list[dict[str, Any]] = []
    for jpeg in image_jpegs:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.b64encode(jpeg).decode("ascii"),
            },
        })
    content.append({"type": "text", "text": user_text})

    try:
        # messages.parse + effort when SDK supports it; graceful degrade.
        kwargs: dict[str, Any] = {
            "model": settings.ANTHROPIC_MODEL,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [{"role": "user", "content": content}],
        }
        # output_config effort — newer API; ignore if SDK rejects.
        try:
            msg = client.messages.create(
                **kwargs,
                extra_body={"output_config": {"effort": settings.ANTHROPIC_EFFORT}},
            )
        except TypeError:
            msg = client.messages.create(**kwargs)

        if getattr(msg, "stop_reason", None) == "refusal":
            logger.warning("Claude refusal for custom_id={}", custom_id)
            return None
        text_parts = [
            b.text for b in (msg.content or [])
            if getattr(b, "type", None) == "text" and getattr(b, "text", None)
        ]
        raw = "\n".join(text_parts).strip()
        if not raw:
            return None
        import json
        # Tolerate fenced JSON
        if "```" in raw:
            start = raw.find("{")
            end = raw.rfind("}")
            raw = raw[start : end + 1] if start >= 0 and end > start else raw
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Claude escalate failed custom_id={}: {}", custom_id, exc)
        return None
