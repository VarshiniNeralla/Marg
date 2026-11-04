"""Collects the token usage of every LLM call made while a feature runs, including calls that fail afterwards.

The Audit page must show EVERY token the provider billed. Reading totals from a feature's final result misses:
  * calls whose reply could not be parsed (billed, then retried or given up on),
  * retries,
  * features that fail half-way (a floor analysis that made 5 calls and then raised).

So the low-level LLM clients call :func:`note_llm_call` the moment a billed response arrives (before it is parsed),
and a feature wraps its LLM work in :func:`capture_usage` and records what was collected, success or failure.
Captures do not nest into each other: a call is counted by the innermost active capture only, so a feature that
triggers another feature's calls (e.g. a floor analysis that first rebuilds a room map) never double-counts them.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator, Optional


@dataclass
class UsageCapture:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: float = 0.0
    calls: int = 0
    models: list[str] = field(default_factory=list)

    @property
    def model(self) -> Optional[str]:
        return self.models[0] if self.models else None

    def add(self, model: Optional[str], prompt: int, completion: int, total: int, latency_ms: float) -> None:
        self.prompt_tokens += prompt
        self.completion_tokens += completion
        self.total_tokens += total
        self.latency_ms += latency_ms
        self.calls += 1
        if model and model not in self.models:
            self.models.append(model)


_current: ContextVar[Optional[UsageCapture]] = ContextVar("llm_usage_capture", default=None)


@contextmanager
def capture_usage() -> Iterator[UsageCapture]:
    cap = UsageCapture()
    token = _current.set(cap)
    try:
        yield cap
    finally:
        _current.reset(token)


def begin_capture() -> tuple[UsageCapture, object]:
    """Start a capture without a ``with`` block (for long methods). Pair with :func:`end_capture` in a finally."""
    cap = UsageCapture()
    return cap, _current.set(cap)


def end_capture(token: object) -> None:
    _current.reset(token)  # type: ignore[arg-type]


def note_llm_call(
    model: Optional[str],
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None = None,
    latency_ms: float | None = None,
) -> None:
    """Called by the LLM clients for every billed response. Does nothing when no capture is active."""
    cap = _current.get()
    if cap is None:
        return
    prompt = int(prompt_tokens or 0)
    completion = int(completion_tokens or 0)
    total = int(total_tokens or (prompt + completion))
    cap.add(model, prompt, completion, total, float(latency_ms or 0.0))
