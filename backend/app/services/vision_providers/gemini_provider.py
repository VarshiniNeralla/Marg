from __future__ import annotations

from app.services.vision_providers.base import VisionAnalysisResult, VisionProvider


class GeminiVisionProvider(VisionProvider):
    """Placeholder for future Google Gemini Vision integration."""

    async def analyze_construction_progress(
        self,
        *,
        before_image_b64: str,
        after_image_b64: str,
        before_mime: str,
        after_mime: str,
        context: dict[str, str],
    ) -> VisionAnalysisResult:
        raise NotImplementedError("Gemini vision provider is not yet implemented")
