"""POST /chats/:id/auto-title — happy paths covered without hitting a real LLM."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.session.persistence import SessionWriter


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def _setup(client: TestClient, tmp_path: Path, model: str = "") -> tuple[str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Initial", "model": model}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "Help me set up Redis connection pooling for my Flask app"})
    w.write_assistant_message("Sure, I'll walk you through it.")
    return cid, sessions_dir


def test_no_user_messages_short_circuits(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Initial"}).json()["chat_id"]
    r = client.post(f"/chats/{cid}/auto-title")
    assert r.status_code == 200
    assert r.json()["changed"] is False
    assert r.json()["title"] == "Initial"


def test_no_model_configured_returns_unchanged(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path, model="")
    r = client.post(f"/chats/{cid}/auto-title")
    assert r.status_code == 200
    body = r.json()
    assert body["changed"] is False
    assert body["title"] == "Initial"


def test_llm_response_persists_title(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path, model="gpt-4o-mini")

    class _FakeResp:
        content = "Redis Pooling For Flask\n"

    fake_provider = type("P", (), {"chat": AsyncMock(return_value=_FakeResp())})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        r = client.post(f"/chats/{cid}/auto-title")
    assert r.status_code == 200
    assert r.json()["title"] == "Redis Pooling For Flask"
    # Survives a fresh GET.
    assert client.get(f"/chats/{cid}").json()["title"] == "Redis Pooling For Flask"


def test_llm_failure_returns_existing_title(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path, model="gpt-4o-mini")
    with patch(
        "clawagents.providers.llm.create_provider",
        side_effect=RuntimeError("provider down"),
    ):
        r = client.post(f"/chats/{cid}/auto-title")
    assert r.status_code == 200
    body = r.json()
    assert body["changed"] is False
    assert body["title"] == "Initial"
    assert "provider down" in body.get("error", "")


def test_empty_response_returns_existing_title(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path, model="gpt-4o-mini")
    fake_resp = type("R", (), {"content": "   "})()
    fake_provider = type("P", (), {"chat": AsyncMock(return_value=fake_resp)})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        r = client.post(f"/chats/{cid}/auto-title")
    assert r.json()["changed"] is False
    assert r.json()["title"] == "Initial"
