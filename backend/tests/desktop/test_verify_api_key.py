"""POST /settings/verify-key probes the provider's models-list endpoint.

We intercept httpx so the test doesn't hit the network. Three cases:
valid key (200), invalid key (401), and a network/transport failure.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CLAWAGENTS_DESKTOP_APP_SUPPORT", str(tmp_path / "appsupport"))
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    from clawagents.gateway.server import create_app
    app, _llm, _model = create_app()
    return TestClient(app)


class _StubClient:
    """Stand-in for `httpx.AsyncClient` capturing the request the gateway makes."""

    def __init__(self, responder, captured):
        self._respond = responder
        self._captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url: str, headers: dict | None = None, params: dict | None = None) -> httpx.Response:
        self._captured.append({"url": url, "headers": headers or {}, "params": params or {}})
        return self._respond(url)


def _install_stub(monkeypatch: pytest.MonkeyPatch, responder, captured: list[dict[str, Any]]) -> None:
    monkeypatch.setattr(
        "httpx.AsyncClient",
        lambda *a, **kw: _StubClient(responder, captured),
    )


def test_verify_openai_key_success(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, Any]] = []
    def respond(_url: str) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "gpt-5.4"}, {"id": "gpt-5.4-mini"}]})
    _install_stub(monkeypatch, respond, captured)

    r = client.post("/settings/verify-key", json={"provider": "openai", "api_key": "sk-test"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"ok": True, "status": 200, "message": "OK", "model_count": 2}
    # Confirm the gateway used the Authorization header and called the right URL.
    assert captured[0]["url"] == "https://api.openai.com/v1/models"
    assert captured[0]["headers"].get("Authorization") == "Bearer sk-test"


def test_verify_anthropic_key_unauthorized(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, Any]] = []
    def respond(_url: str) -> httpx.Response:
        return httpx.Response(401, text='{"error":{"message":"invalid x-api-key"}}')
    _install_stub(monkeypatch, respond, captured)

    r = client.post("/settings/verify-key", json={"provider": "anthropic", "api_key": "bad"})
    body = r.json()
    assert body["ok"] is False
    assert body["status"] == 401
    assert "Auth failed" in body["message"]
    assert captured[0]["headers"].get("x-api-key") == "bad"
    assert captured[0]["headers"].get("anthropic-version") == "2023-06-01"


def test_verify_gemini_uses_query_param(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, Any]] = []
    def respond(_url: str) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "models/gemini-3.1-pro-preview"}]})
    _install_stub(monkeypatch, respond, captured)

    r = client.post("/settings/verify-key", json={"provider": "gemini", "api_key": "abc"})
    body = r.json()
    assert body["ok"] is True
    assert body["model_count"] == 1
    # Gemini uses ?key=... not a header.
    assert captured[0]["params"] == {"key": "abc"}
    assert "Authorization" not in captured[0]["headers"]


def test_verify_network_error_surfaces_message(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def respond(_url: str) -> httpx.Response:
        raise httpx.ConnectError("simulated network failure")
    _install_stub(monkeypatch, respond, [])

    r = client.post("/settings/verify-key", json={"provider": "openai", "api_key": "sk-x"})
    body = r.json()
    assert body["ok"] is False
    assert body["status"] == 0
    assert "network error" in body["message"]


def test_verify_rejects_empty_key(client: TestClient) -> None:
    r = client.post("/settings/verify-key", json={"provider": "openai", "api_key": ""})
    assert r.status_code == 400


def test_verify_rejects_unknown_provider(client: TestClient) -> None:
    r = client.post("/settings/verify-key", json={"provider": "deepseek", "api_key": "k"})
    # Pydantic Literal rejects the value before our handler runs.
    assert r.status_code == 422
