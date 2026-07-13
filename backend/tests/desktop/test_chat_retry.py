"""POST /chats/:id/truncate-after-last-user-message powers edit/retry."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.session.persistence import SessionReader, SessionWriter


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def _make(client: TestClient, tmp_path: Path) -> tuple[str, str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    return pid, cid, sessions_dir


def test_truncates_after_last_user_message(client: TestClient, tmp_path: Path) -> None:
    _, cid, sessions_dir = _make(client, tmp_path)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "first"})
    w.write_assistant_message("first reply")
    w.append("user_message", {"content": "second"})
    w.write_assistant_message("second reply, with tools")
    w.write_tool_result(tool_call_id="t1", tool_name="read", success=True, output="x")
    w.write_turn_completed(iteration=1, tool_calls=1, status="ok")

    r = client.post(f"/chats/{cid}/truncate-after-last-user-message")
    assert r.status_code == 200
    truncated = r.json()["truncated"]
    assert truncated >= 4  # second user_message + assistant + tool_result + turn_completed

    msgs = client.get(f"/chats/{cid}/messages").json()
    roles = [m["role"] for m in msgs]
    # "second" user message + the assistant_message + tool_result are gone;
    # only "first" + "first reply" remain.
    assert roles == ["user", "assistant"]
    assert msgs[0]["content"] == "first"
    assert msgs[1]["content"] == "first reply"


def test_idempotent_on_empty(client: TestClient, tmp_path: Path) -> None:
    _, cid, _ = _make(client, tmp_path)
    # No user_message events yet — only chat_meta.
    r = client.post(f"/chats/{cid}/truncate-after-last-user-message")
    assert r.status_code == 200
    assert r.json()["truncated"] == 0


def test_404_unknown_chat(client: TestClient) -> None:
    r = client.post("/chats/does-not-exist/truncate-after-last-user-message")
    assert r.status_code == 404


def test_subsequent_messages_continue_cleanly(client: TestClient, tmp_path: Path) -> None:
    """After truncation, appending another user_message should work and the
    SessionReader should reconstruct messages in order."""
    _, cid, sessions_dir = _make(client, tmp_path)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "first"})
    w.write_assistant_message("reply A")
    w.append("user_message", {"content": "second (to be retried)"})
    w.write_assistant_message("reply B - bad")

    client.post(f"/chats/{cid}/truncate-after-last-user-message")
    # Simulate the next /messages call writing a new user_message.
    w2 = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w2.append("user_message", {"content": "second (edited)"})
    w2.write_assistant_message("reply B - good")

    reader = SessionReader(sessions_dir / f"{cid}.jsonl")
    msgs = reader.reconstruct_messages()
    contents = [m.content for m in msgs]
    assert contents == ["first", "reply A", "second (edited)", "reply B - good"]
