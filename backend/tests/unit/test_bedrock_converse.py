"""LLM_BACKEND=bedrock: OpenAI-shaped chat calls are sent to Amazon Bedrock (Converse) and come back OpenAI-shaped."""
import base64

import cv2
import numpy as np
import pytest
from botocore.exceptions import ClientError

from app.core.config import Settings, get_settings
from app.services import bedrock_converse as bc


def _settings(monkeypatch, **over):
    s = get_settings()
    vals = {"LLM_BACKEND": "bedrock", "BEDROCK_MODEL_ID": "apac.amazon.nova-pro-v1:0",
            "BEDROCK_REGION": "ap-south-1", "BEDROCK_MAX_OUTPUT_TOKENS": 10000, "VLLM_MAX_RETRIES": 2}
    vals.update(over)
    for k, v in vals.items():
        monkeypatch.setattr(s, k, v)
    return s


def _data_uri(raw: bytes, mime="image/jpeg"):
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _jpeg(w=64, h=32):
    ok, buf = cv2.imencode(".jpg", np.full((h, w, 3), 127, np.uint8))
    assert ok
    return buf.tobytes()


# ── request translation ──────────────────────────────────────────────────────

def test_request_has_system_text_image_and_json_instruction(monkeypatch):
    s = _settings(monkeypatch)
    raw = _jpeg()
    req = bc.to_converse_request({
        "model": "ignored",
        "messages": [
            {"role": "system", "content": "You are a construction analyst."},
            {"role": "user", "content": [
                {"type": "text", "text": "What is shown?"},
                {"type": "image_url", "image_url": {"url": _data_uri(raw)}},
            ]},
        ],
        "temperature": 0.1, "max_tokens": 512, "response_format": {"type": "json_object"},
    }, s)

    assert req["modelId"] == "apac.amazon.nova-pro-v1:0"
    assert req["inferenceConfig"] == {"maxTokens": 512, "temperature": 0.1}
    assert req["system"][0] == {"text": "You are a construction analyst."}
    assert "JSON" in req["system"][-1]["text"]                       # JSON mode is requested through the prompt
    assert req["messages"] == [{"role": "user", "content": [
        {"text": "What is shown?"},
        {"image": {"format": "jpeg", "source": {"bytes": raw}}},
    ]}]


def test_no_json_instruction_when_not_requested(monkeypatch):
    s = _settings(monkeypatch)
    req = bc.to_converse_request({"messages": [{"role": "user", "content": "hi"}]}, s)
    assert "system" not in req


def test_output_tokens_are_capped_at_the_model_limit(monkeypatch):
    s = _settings(monkeypatch)
    req = bc.to_converse_request({"messages": [{"role": "user", "content": "hi"}], "max_tokens": 20000}, s)
    assert req["inferenceConfig"]["maxTokens"] == 10000              # Nova Pro rejects 20000


def test_consecutive_same_role_messages_are_merged(monkeypatch):
    s = _settings(monkeypatch)
    req = bc.to_converse_request({"messages": [
        {"role": "user", "content": "a"}, {"role": "user", "content": "b"},
        {"role": "assistant", "content": "c"}, {"role": "user", "content": "d"}]}, s)
    assert [(m["role"], len(m["content"])) for m in req["messages"]] == [("user", 2), ("assistant", 1), ("user", 1)]


def test_png_and_webp_formats_are_passed_through(monkeypatch):
    s = _settings(monkeypatch)
    for mime, fmt in (("image/png", "png"), ("image/webp", "webp")):
        req = bc.to_converse_request({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": _data_uri(b"x" * 10, mime)}}]}]}, s)
        assert req["messages"][0]["content"][0]["image"]["format"] == fmt


def test_oversized_image_is_downscaled_under_the_limit(monkeypatch):
    s = _settings(monkeypatch)
    noise = np.random.default_rng(1).integers(0, 255, (2200, 2200, 3), dtype=np.uint8)
    ok, png = cv2.imencode(".png", noise)
    assert ok and len(png) > bc._MAX_IMAGE_BYTES
    req = bc.to_converse_request({"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": _data_uri(png.tobytes(), "image/png")}}]}]}, s)
    block = req["messages"][0]["content"][0]["image"]
    assert block["format"] == "jpeg" and len(block["source"]["bytes"]) <= bc._MAX_IMAGE_BYTES


@pytest.mark.parametrize("url", ["https://example.com/a.jpg", "data:image/tiff;base64,AAAA"])
def test_unsupported_images_raise_a_non_retryable_error(monkeypatch, url):
    s = _settings(monkeypatch)
    with pytest.raises(bc.BedrockChatError) as exc:
        bc.to_converse_request({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": url}}]}]}, s)
    assert exc.value.retryable is False


# ── response translation + calling ───────────────────────────────────────────

class _FakeClient:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.calls = response, error, []

    def converse(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.response


_OK = {"output": {"message": {"role": "assistant", "content": [{"text": '{"a": 1}'}]}},
       "usage": {"inputTokens": 7, "outputTokens": 4, "totalTokens": 11}, "stopReason": "end_turn"}


@pytest.mark.asyncio
async def test_chat_completion_returns_an_openai_shaped_body(monkeypatch):
    s = _settings(monkeypatch)
    fake = _FakeClient(response=_OK)
    monkeypatch.setattr(bc, "_get_client", lambda region, timeout: fake)
    body = await bc.chat_completion({"messages": [{"role": "user", "content": "hi"}]}, s)
    assert body["choices"][0]["message"]["content"] == '{"a": 1}'
    assert body["usage"] == {"prompt_tokens": 7, "completion_tokens": 4, "total_tokens": 11}
    assert fake.calls[0]["modelId"] == "apac.amazon.nova-pro-v1:0"


def _client_error(code):
    return ClientError({"Error": {"Code": code, "Message": "boom"}}, "Converse")


@pytest.mark.asyncio
@pytest.mark.parametrize("code,retryable", [("ThrottlingException", True), ("ServiceUnavailableException", True),
                                            ("ValidationException", False), ("AccessDeniedException", False)])
async def test_errors_are_classified_for_retry(monkeypatch, code, retryable):
    s = _settings(monkeypatch)
    monkeypatch.setattr(bc, "_get_client", lambda region, timeout: _FakeClient(error=_client_error(code)))
    with pytest.raises(bc.BedrockChatError) as exc:
        await bc.chat_completion({"messages": [{"role": "user", "content": "hi"}]}, s)
    assert exc.value.retryable is retryable and code in str(exc.value)


# ── settings ─────────────────────────────────────────────────────────────────

def test_backend_defaults_to_the_existing_http_clients():
    assert Settings().LLM_BACKEND == ""
    assert bc.is_enabled(Settings()) is False


def test_backend_must_be_blank_or_bedrock():
    with pytest.raises(ValueError, match="LLM_BACKEND"):
        Settings(LLM_BACKEND="openai")


def test_bedrock_needs_a_model_id():
    with pytest.raises(ValueError, match="BEDROCK_MODEL_ID"):
        Settings(LLM_BACKEND="bedrock", BEDROCK_MODEL_ID=" ")


def test_bedrock_selects_the_openai_shaped_client_without_touching_an_explicit_choice():
    assert Settings(LLM_BACKEND="bedrock", APP_ENV="development").vision_provider == "vllm"
    assert Settings(LLM_BACKEND="bedrock", VISION_PROVIDER="groq").vision_provider == "groq"
    assert Settings(LLM_BACKEND="").vision_provider in {"groq", "vllm"}      # unchanged behaviour


# ── the three AI clients ─────────────────────────────────────────────────────

def _fake_chat(results):
    """results: list of dicts (returned) or exceptions (raised), consumed in order."""
    calls = []

    async def chat(payload, settings):
        calls.append(payload)
        r = results[min(len(calls) - 1, len(results) - 1)]
        if isinstance(r, Exception):
            raise r
        return r
    return chat, calls


def _body(text):
    return {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}}


@pytest.mark.asyncio
async def test_vision_client_uses_bedrock_and_retries_throttling(monkeypatch):
    from app.services.vision_providers.vllm_provider import VllmVisionProvider

    s = _settings(monkeypatch)
    chat, calls = _fake_chat([bc.BedrockChatError("slow down", retryable=True), _body('```json\n{"flats": ["601"]}\n```')])
    monkeypatch.setattr(bc, "chat_completion", chat)
    monkeypatch.setattr("app.services.vision_providers.vllm_provider.asyncio.sleep", lambda *_: _noop())
    provider = VllmVisionProvider(s)
    result = await provider.read_flat_labels(image_b64=base64.b64encode(_jpeg()).decode(), mime="image/jpeg")
    assert result.content == {"flats": ["601"]}
    assert result.model == "apac.amazon.nova-pro-v1:0" and result.total_tokens == 8
    assert len(calls) == 2


async def _noop():
    return None


@pytest.mark.asyncio
async def test_vision_client_does_not_retry_a_rejected_request(monkeypatch):
    from app.services.vision_providers.vllm_provider import VllmVisionProvider

    s = _settings(monkeypatch)
    chat, calls = _fake_chat([bc.BedrockChatError("ValidationException", retryable=False)])
    monkeypatch.setattr(bc, "chat_completion", chat)
    provider = VllmVisionProvider(s)
    with pytest.raises(RuntimeError, match="rejected by Bedrock"):
        await provider.read_flat_labels(image_b64=base64.b64encode(_jpeg()).decode(), mime="image/jpeg")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_construction_progress_client_uses_bedrock(monkeypatch):
    from app.services.construction_progress_providers.vllm_provider import VllmConstructionProgressProvider

    s = _settings(monkeypatch)
    chat, calls = _fake_chat([_body('{"activities": []}')])
    monkeypatch.setattr(bc, "chat_completion", chat)
    provider = VllmConstructionProgressProvider(s)
    usage: dict = {}
    out = await provider._chat_completion({"messages": [{"role": "user", "content": "x"}]}, log_label="t", usage_out=usage)
    assert out == {"activities": []} and usage["total_tokens"] == 8 and provider._model == "apac.amazon.nova-pro-v1:0"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_drishti_client_uses_bedrock_and_wraps_failures(monkeypatch):
    from app.services import drishti_llm_client as dl

    s = _settings(monkeypatch)
    chat, _ = _fake_chat([_body('{"answer": "ok"}')])
    monkeypatch.setattr(bc, "chat_completion", chat)
    usage: dict = {}
    assert await dl.chat_completion_json("sys", "user", settings=s, usage_out=usage) == {"answer": "ok"}
    assert usage["model"] == "apac.amazon.nova-pro-v1:0" and usage["usage"]["total_tokens"] == 8

    chat, _ = _fake_chat([bc.BedrockChatError("denied", retryable=False)])
    monkeypatch.setattr(bc, "chat_completion", chat)
    with pytest.raises(dl.DrishtiLLMError):
        await dl.chat_completion_json("sys", "user", settings=s)


def test_clients_keep_the_http_path_when_bedrock_is_off(monkeypatch):
    from app.services.vision_providers.vllm_provider import VllmVisionProvider

    s = _settings(monkeypatch, LLM_BACKEND="")
    assert VllmVisionProvider(s)._use_bedrock is False
