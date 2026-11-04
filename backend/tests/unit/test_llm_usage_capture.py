"""Every billed LLM token must reach the usage ledger: unparsable replies, retries and half-failed runs included."""
import base64

import pytest

from app.core.config import get_settings
from app.services import bedrock_converse as bc
from app.services import drishti_llm_client as dl
from app.services.llm_usage_context import begin_capture, capture_usage, end_capture, note_llm_call
from app.services.llm_usage_service import LLMUsageService


def _body(text, p=10, c=5):
    return {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": p, "completion_tokens": c, "total_tokens": p + c}}


def _settings(monkeypatch):
    s = get_settings()
    for k, v in {"LLM_BACKEND": "bedrock", "BEDROCK_MODEL_ID": "apac.amazon.nova-pro-v1:0",
                 "BEDROCK_REGION": "ap-south-1", "BEDROCK_MAX_OUTPUT_TOKENS": 10000, "VLLM_MAX_RETRIES": 1}.items():
        monkeypatch.setattr(s, k, v)
    return s


def test_capture_sums_calls_and_ignores_calls_outside():
    note_llm_call("m", 1, 1, 2, 5)                      # no capture active: ignored, no error
    with capture_usage() as cap:
        note_llm_call("m", 100, 20, None, 10)
        note_llm_call("m", 50, 5, 55, 20)
    assert (cap.prompt_tokens, cap.completion_tokens, cap.total_tokens, cap.calls) == (150, 25, 175, 2)
    assert cap.model == "m" and cap.latency_ms == 30


def test_inner_capture_is_counted_separately_not_twice():
    with capture_usage() as outer:
        note_llm_call("m", 10, 0)
        with capture_usage() as inner:
            note_llm_call("m", 7, 0)
        note_llm_call("m", 3, 0)
    assert inner.total_tokens == 7 and outer.total_tokens == 13     # 7 belongs to the inner feature only


@pytest.mark.asyncio
async def test_unparsable_reply_still_counts_its_tokens_and_retries_count_too(monkeypatch):
    s = _settings(monkeypatch)
    monkeypatch.setattr(dl.asyncio, "sleep", lambda *_: _noop())

    async def chat(payload, settings):
        return _body("this is not json", 100, 20)
    monkeypatch.setattr(bc, "chat_completion", chat)
    with capture_usage() as cap:
        with pytest.raises(dl.DrishtiLLMError):
            await dl.chat_completion_json("sys", "user", settings=s)
    assert cap.calls >= 1 and cap.prompt_tokens == 100 * cap.calls and cap.completion_tokens == 20 * cap.calls


async def _noop():
    return None


@pytest.mark.asyncio
async def test_successful_drishti_call_is_counted_once(monkeypatch):
    s = _settings(monkeypatch)

    async def chat(payload, settings):
        return _body('{"a": 1}', 40, 8)
    monkeypatch.setattr(bc, "chat_completion", chat)
    with capture_usage() as cap:
        await dl.chat_completion_json("sys", "user", settings=s)
    assert (cap.calls, cap.total_tokens, cap.model) == (1, 48, "apac.amazon.nova-pro-v1:0")


@pytest.mark.asyncio
async def test_vision_provider_unparsable_reply_is_counted(monkeypatch):
    from app.services.vision_providers.vllm_provider import VllmVisionProvider

    s = _settings(monkeypatch)
    monkeypatch.setattr("app.services.vision_providers.vllm_provider.asyncio.sleep", lambda *_: _noop())

    async def chat(payload, settings):
        return _body("not json", 300, 30)
    monkeypatch.setattr(bc, "chat_completion", chat)
    import cv2, numpy as np
    ok, buf = cv2.imencode(".jpg", np.full((16, 16, 3), 120, np.uint8))
    with capture_usage() as cap:
        with pytest.raises(RuntimeError):
            await VllmVisionProvider(s).read_flat_labels(image_b64=base64.b64encode(buf.tobytes()).decode(), mime="image/jpeg")
    assert cap.calls >= 1 and cap.total_tokens == 330 * cap.calls


class _Coll:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(doc)


class _Db(dict):
    def __missing__(self, k):
        self[k] = _Coll()
        return self[k]


@pytest.mark.asyncio
async def test_record_capture_writes_one_row_with_status_and_calls():
    db = _Db()
    with capture_usage() as cap:
        note_llm_call("nova", 1000, 200, 1200, 800)
        note_llm_call("nova", 500, 100, 600, 400)
    await LLMUsageService(db).record_capture(cap, ok=False, org_id="o1", source="construction_progress", floor="Floor 8")
    (doc,) = db["llm_usage"].docs
    assert (doc["prompt_tokens"], doc["completion_tokens"], doc["total_tokens"]) == (1500, 300, 1800)
    assert doc["status"] == "failed" and doc["calls"] == 2 and doc["org_id"] == "o1" and doc["floor"] == "Floor 8"


@pytest.mark.asyncio
async def test_record_capture_skips_when_nothing_was_billed_and_never_raises():
    db = _Db()
    with capture_usage() as empty:
        pass
    await LLMUsageService(db).record_capture(empty, org_id="o1", source="x")
    assert db["llm_usage"].docs == []

    class _Broken:
        async def insert_one(self, doc):
            raise RuntimeError("db down")

    with capture_usage() as cap:
        note_llm_call("m", 5, 5)
    await LLMUsageService({"llm_usage": _Broken()}).record_capture(cap, org_id="o1", source="x")   # swallowed


def test_begin_end_capture_pair():
    cap, token = begin_capture()
    note_llm_call("m", 2, 3)
    end_capture(token)
    note_llm_call("m", 99, 99)                         # after the capture ended: not counted
    assert cap.total_tokens == 5


def test_audit_entry_carries_status_calls_and_a_utc_timestamp():
    from datetime import datetime

    from app.schemas.progress_analysis import ProgressAnalysisAuditEntry
    from app.services.llm_usage_service import _serialize_audit_entry

    doc = {"_id": "r1", "source": "room_map", "status": "failed", "calls": 7, "prompt_tokens": 9, "completion_tokens": 1,
           "total_tokens": 10, "created_at": datetime(2026, 11, 4, 6, 14, 46)}     # naive, as Mongo returns it
    entry = ProgressAnalysisAuditEntry.model_validate(_serialize_audit_entry(doc, {})).model_dump(by_alias=True, mode="json")
    assert entry["status"] == "failed" and entry["calls"] == 7 and entry["sourceLabel"] == "Floor Plan Room Map"
    assert entry["createdAt"].endswith("Z") or entry["createdAt"].endswith("+00:00")
