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
    assert {"openai", "anthropic", "gemini", "ollama"} <= set(by_id)
    assert by_id["ollama"]["available"] is True
    assert by_id["openai"]["available"] is False


def test_marks_available_when_key_set(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    by_id = {p["id"]: p for p in client.get("/providers").json()}
    assert by_id["anthropic"]["available"] is True
