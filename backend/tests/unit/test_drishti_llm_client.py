"""Unit tests for drishti_llm_client's HTTP error handling.

Regression coverage for a real production bug: a 4xx response's actual
error body (e.g. a vLLM "context length exceeded" explanation) was
discarded entirely — only the bare status code was ever logged or raised —
making a context-window overflow indistinguishable from a genuine
malformed-request error without manually replaying the request against the
LLM server."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services import drishti_llm_client as llm_client_module
from app.services.drishti_llm_client import DrishtiLLMError, chat_completion_json


class _FakeSettings:
    VLLM_BASE_URL = "http://fake-vllm:8000"
    VLLM_MODEL = "gemma4-31b"
    VLLM_API_KEY = ""
    VLLM_TEMPERATURE = 0.3
    VLLM_MAX_TOKENS = 800
    VLLM_HTTP_TIMEOUT_S = 30
    VLLM_MAX_RETRIES = 0


def _fake_400_response(body: str) -> httpx.Response:
    request = httpx.Request("POST", "http://fake-vllm:8000/v1/chat/completions")
    return httpx.Response(status_code=400, text=body, request=request)


@pytest.mark.asyncio
async def test_4xx_error_body_is_logged_not_discarded(monkeypatch):
    response = _fake_400_response(
        '{"error": {"message": "This model\'s maximum context length is 32768 tokens."}}'
    )

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(llm_client_module.httpx, "AsyncClient", MagicMock(return_value=mock_client))

    logged = {}

    def fake_warning(fmt, *args, **kwargs):
        logged["message"] = fmt.format(*args, **kwargs) if args else fmt

    monkeypatch.setattr(llm_client_module.logger, "warning", fake_warning)

    with pytest.raises(DrishtiLLMError):
        await chat_completion_json("system", "user", settings=_FakeSettings())

    assert "32768" in logged.get("message", "")


@pytest.mark.asyncio
async def test_4xx_raises_drishti_llm_error_without_retry(monkeypatch):
    response = _fake_400_response('{"error": "bad request"}')

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(llm_client_module.httpx, "AsyncClient", MagicMock(return_value=mock_client))
    monkeypatch.setattr(llm_client_module.logger, "warning", lambda *a, **k: None)

    with pytest.raises(DrishtiLLMError, match="400"):
        await chat_completion_json("system", "user", settings=_FakeSettings())

    # A 4xx is a client-side error, not transient — must not be retried.
    assert mock_client.post.call_count == 1
