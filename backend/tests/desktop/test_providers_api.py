"""GET /providers returns the catalog with availability flags."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.providers_api import router as providers_router


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(providers_router)
    return TestClient(app)


def test_returns_catalog(client: TestClient) -> None:
    r = client.get("/providers")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()}
    assert {"openai", "anthropic", "gemini"} <= set(by_id)
    assert by_id["openai"]["available"] is False
    openai_ids = {m["id"] for m in by_id["openai"]["models"]}
    assert {"gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6"} <= openai_ids
    gemini_ids = {m["id"] for m in by_id["gemini"]["models"]}
    assert {
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-pro-preview",
    } <= gemini_ids


def test_marks_available_when_key_set(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    by_id = {p["id"]: p for p in client.get("/providers").json()}
    assert by_id["anthropic"]["available"] is True
