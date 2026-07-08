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

    @abstractmethod
    async def read_flat_labels(
        self,
        *,
        image_b64: str,
        mime: str,
    ) -> VisionAnalysisResult:
        """
        Read the apartment/unit labels ("01 FLAT", "02 FLAT", ...) visible in a cropped tile of a
        floor plan and return just their numbers.

        LLM vision can't reliably LOCATE tiny labels in a full dense plan, but reads them well in a
        focused crop — so the caller tiles the plan and calls this per tile.

        ``content`` must be ``{"flats": ["01", "03"]}`` (the two-digit flat numbers, empty if none).
        """

    @abstractmethod
    async def extract_rooms_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
    ) -> VisionAnalysisResult:
        """
        Given a cropped image of ONE flat with a labelled ``cols`` x ``rows`` grid overlaid on it
        (columns A.., rows 1.., cells labelled like "C4"), return the rooms in that flat, each as
        the set of grid CELLS it covers.

        LLM vision can't read pixel-precise polygons off CAD drawings, so we constrain it to naming
        grid cells — the caller converts cells (relative to the crop) back to full-image geometry.

        ``content`` must be ``{"rooms": [{"name": str, "cells": ["C4", ...], "confidence": int,
        "reason": str}]}``.
        """

    @abstractmethod
    async def extract_common_areas_in_crop(
        self,
        *,
        image_b64: str,
        mime: str,
        cols: int,
        rows: int,
    ) -> VisionAnalysisResult:
        """
        Like ``extract_rooms_in_crop`` but for the building CORE crop: returns shared/common areas
        (lift lobby, staircase, shafts, ...) so pins there resolve to the core instead of being
        misattributed to a neighbouring flat. Same ``{"rooms": [...]}`` cell-based shape.
        """
