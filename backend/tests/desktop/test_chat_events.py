"""GET /chats/:id/events — raw event stream powering the activity panel."""

from __future__ import annotations

from pathlib import Path

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


def _make(client: TestClient, tmp_path: Path) -> tuple[str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "hi"})
    w.write_assistant_message("hi back")
    w.write_turn_completed(iteration=1, tool_calls=0, status="ok")
    return cid, sessions_dir


def test_returns_events_newest_first(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _make(client, tmp_path)
    events = client.get(f"/chats/{cid}/events").json()
    types = [e["type"] for e in events]
    # Newest-first → expect turn_completed before user_message.
    assert types.index("turn_completed") < types.index("user_message")
    assert "chat_meta" in types  # always present from chat creation


def test_404_unknown(client: TestClient) -> None:
    assert client.get("/chats/none/events").status_code == 404


def test_limit_caps_results(client: TestClient, tmp_path: Path) -> None:
    cid, sessions_dir = _make(client, tmp_path)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    for i in range(50):
        w.append("usage", {"input_tokens": i, "output_tokens": 0, "total_tokens": i, "model": "gpt"})
    events = client.get(f"/chats/{cid}/events", params={"limit": 5}).json()
    assert len(events) == 5
