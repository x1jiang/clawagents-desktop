"""POST /chats/:id/compact — summarises and rewrites the JSONL."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

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


def _setup(client: TestClient, tmp_path: Path, model: str = "gpt-4o-mini") -> tuple[str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Long chat", "model": model}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    for i in range(5):
        w.append("user_message", {"content": f"user message {i}"})
        w.write_assistant_message(f"assistant reply {i}")
    return cid, sessions_dir


def test_short_chat_refuses_to_compact(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Tiny", "model": "gpt-4o-mini"}).json()["chat_id"]
    r = client.post(f"/chats/{cid}/compact")
    assert r.status_code == 200
    assert r.json()["compacted"] is False


def test_compact_writes_summary_and_backup(client: TestClient, tmp_path: Path) -> None:
    cid, sessions_dir = _setup(client, tmp_path)

    fake_resp = type("R", (), {"content": "- did X\n- decided Y\n- open: Z"})()
    fake_provider = type("P", (), {"chat": AsyncMock(return_value=fake_resp)})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        r = client.post(f"/chats/{cid}/compact")
    assert r.status_code == 200
    body = r.json()
    assert body["compacted"] is True
    assert body["summary_chars"] > 0
    assert Path(body["backup_path"]).exists()
    # Original is rewritten — only chat_meta + 1 user + 1 assistant.
    msgs = client.get(f"/chats/{cid}/messages").json()
    roles = [m["role"] for m in msgs]
    assert roles == ["user", "assistant"]
    assert "did X" in msgs[1]["content"]


def test_compact_preserves_pinned_and_title(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path)
    client.patch(f"/chats/{cid}", json={"pinned": True})

    fake_resp = type("R", (), {"content": "summary"})()
    fake_provider = type("P", (), {"chat": AsyncMock(return_value=fake_resp)})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        client.post(f"/chats/{cid}/compact")
    meta = client.get(f"/chats/{cid}").json()
    assert meta["title"] == "Long chat"
    assert meta["pinned"] is True


def test_compact_no_model_refuses(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path, model="")
    r = client.post(f"/chats/{cid}/compact")
    assert r.status_code == 200
    assert r.json()["compacted"] is False
    assert "model" in r.json()["reason"]


def test_compact_llm_failure_is_502(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path)
    with patch("clawagents.providers.llm.create_provider", side_effect=RuntimeError("network down")):
        r = client.post(f"/chats/{cid}/compact")
    assert r.status_code == 502
    assert "network down" in r.json()["detail"]


def test_compact_empty_response_is_502(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _setup(client, tmp_path)
    fake_resp = type("R", (), {"content": "   "})()
    fake_provider = type("P", (), {"chat": AsyncMock(return_value=fake_resp)})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        r = client.post(f"/chats/{cid}/compact")
    assert r.status_code == 502
