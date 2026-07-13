"""Provider catalog: static list of providers/models with availability flag."""

from __future__ import annotations

import pytest

from clawagents.desktop_stores.provider_catalog import build_provider_catalog


def test_includes_known_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    catalog = build_provider_catalog()
    ids = {p["id"] for p in catalog}
    assert {"openai", "anthropic", "gemini"} <= ids


def test_marks_available_when_env_key_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    catalog = {p["id"]: p for p in build_provider_catalog()}
    assert catalog["openai"]["available"] is True
    for m in catalog["openai"]["models"]:
        assert m["available"] is True

    assert catalog["anthropic"]["available"] is False
    for m in catalog["anthropic"]["models"]:
        assert m["available"] is False
