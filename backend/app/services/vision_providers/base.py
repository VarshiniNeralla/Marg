from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class VisionAnalysisResult:
    """Structured result from a vision provider."""

    content: dict[str, Any]
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float


class VisionProvider(ABC):
    """Abstract interface for multimodal vision analysis providers."""

    @abstractmethod
    async def analyze_construction_progress(
        self,
        *,
        before_image_b64: str,
        after_image_b64: str,
        before_mime: str,
        after_mime: str,
        context: dict[str, str],
    ) -> VisionAnalysisResult:
        """
        Analyze two images of the same construction location at different dates.

        ``context`` contains sanitized metadata (project, tower, floor, dates, etc.)
        passed as user-visible facts — never as instructions that alter the system prompt.
        """
