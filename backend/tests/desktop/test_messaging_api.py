"""POST /chats/:id/messages must stream SSE events for an agent turn.

We don't run a real LLM; we monkeypatch ``run_chat_turn`` (defined in
chats_api) to push deterministic events.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.permissions_api import router as permissions_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(permissions_router)
    return TestClient(app)


def _parse_sse(body: str) -> list[dict]:
    events: list[dict] = []
    for block in body.strip().split("\n\n"):
        kind = ""
        data = ""
        for line in block.splitlines():
            if line.startswith("event:"):
                kind = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data += line[len("data:"):].strip()
        if kind:
            events.append({"event": kind, "data": json.loads(data) if data else None})
    return events


def test_messages_stream_emits_turn_started_and_completed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t", "model": "x", "mode": "auto"}).json()["chat_id"]

    async def fake_turn(*, chat_id, content, project_root, mode, model, on_event):
        on_event("assistant_token", {"text": "hello"})
        on_event("turn_completed", {"chat_id": chat_id, "status": "ok"})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)

    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    assert r.status_code == 200
    events = _parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert kinds == ["turn_started", "assistant_token", "turn_completed"]


def test_messages_stream_emits_error_event(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)

    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    assert r.status_code == 200
    events = _parse_sse(r.text)
    assert events[-1]["event"] == "error"
    assert "boom" in events[-1]["data"]["message"]


def test_messages_stream_unknown_chat_returns_404(client: TestClient) -> None:
    r = client.post("/chats/nope/messages", json={"content": "hi"})
    assert r.status_code == 404


def test_run_chat_turn_uses_project_root_as_cwd(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Smoke-check: the handler resolves project_root correctly before invoking run_chat_turn."""
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    captured: dict = {}

    async def fake_turn(**kwargs):
        captured.update(kwargs)
        kwargs["on_event"]("turn_completed", {"chat_id": kwargs["chat_id"]})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)

    client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    assert captured["project_root"] == str(tmp_path / "p")
    assert captured["chat_id"] == cid
    assert captured["content"] == "hi"
