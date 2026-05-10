"""POST /settings/api-keys mutates os.environ for the known provider keys."""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.settings_api import router as settings_router


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(settings_router)
    return TestClient(app)


def test_set_openai_key_writes_env(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/settings/api-keys", json={"provider": "openai", "api_key": "sk-runtime"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["env"] == "OPENAI_API_KEY"
    assert body["set"] is True
    assert os.environ.get("OPENAI_API_KEY") == "sk-runtime"


def test_empty_key_clears_env(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "previous")
    r = client.post("/settings/api-keys", json={"provider": "anthropic", "api_key": ""})
    assert r.status_code == 200
    assert r.json()["set"] is False
    assert "ANTHROPIC_API_KEY" not in os.environ


def test_unknown_provider_returns_422(client: TestClient) -> None:
    # Pydantic Literal rejects with 422 before our handler runs.
    r = client.post("/settings/api-keys", json={"provider": "bogus", "api_key": "x"})
    assert r.status_code == 422
