"""DocumentDB rejects retryable writes, so the setting must reach both Motor clients."""
import importlib


def test_retry_writes_defaults_on_and_can_be_turned_off(monkeypatch):
    from app.core import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("MONGO_URI", "mongodb://localhost")
    assert config.get_settings().MONGO_RETRY_WRITES is True
    config.get_settings.cache_clear()
    monkeypatch.setenv("MONGO_RETRY_WRITES", "false")
    assert config.get_settings().MONGO_RETRY_WRITES is False
    config.get_settings.cache_clear()


def test_both_motor_clients_use_the_setting():
    import inspect
    from app.db import mongodb
    src = inspect.getsource(importlib.reload(mongodb))
    assert src.count("retryWrites=settings.MONGO_RETRY_WRITES") == 2
    assert "retryWrites=True" not in src
