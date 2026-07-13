"""GET /chats/:id/export renders a chat as a Markdown document."""

from __future__ import annotations

import json
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


def test_export_includes_title_user_and_assistant(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Demo chat", "model": "gpt-4o-mini"}).json()["chat_id"]

    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    writer = SessionWriter(session_id=cid, session_dir=sessions_dir)
    writer.append("user_message", {"content": "Hello from user"})
    writer.write_assistant_message("Hi back!", tool_calls=[{"id": "tc1", "name": "read_file", "args": {"path": "/x"}}])
    writer.write_tool_result(tool_call_id="tc1", tool_name="read_file", success=True, output="file contents")

    r = client.get(f"/chats/{cid}/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert f'filename="{cid}.md"' in r.headers["content-disposition"]

    body = r.text
    assert "# Demo chat" in body
    assert "Hello from user" in body
    assert "Hi back!" in body
    assert "read_file" in body
    assert "file contents" in body


def test_export_unknown_chat_404(client: TestClient) -> None:
    r = client.get("/chats/does-not-exist/export")
    assert r.status_code == 404


def test_export_includes_tool_args_json(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    writer = SessionWriter(session_id=cid, session_dir=sessions_dir)
    writer.write_assistant_message("", tool_calls=[{"id": "x", "name": "edit", "args": {"file": "a.py", "old": "1", "new": "2"}}])

    body = client.get(f"/chats/{cid}/export").text
    # Args should be rendered as readable JSON
    assert '"file": "a.py"' in body
    assert '"new": "2"' in body
