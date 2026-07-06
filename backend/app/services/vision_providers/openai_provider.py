from __future__ import annotations

from app.services.vision_providers.base import VisionAnalysisResult, VisionProvider


class OpenAIVisionProvider(VisionProvider):
    """Placeholder for future OpenAI GPT-4 Vision integration."""

    async def analyze_construction_progress(
        self,
        *,
        before_image_b64: str,
        after_image_b64: str,
        before_mime: str,
        after_mime: str,
        context: dict[str, str],
    ) -> VisionAnalysisResult:
        raise NotImplementedError("OpenAI vision provider is not yet implemented")
