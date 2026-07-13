"""The gateway must translate agent events into the frontend's expected
SSE event vocabulary."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def _parse_sse(body: str) -> list[dict]:
    events = []
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


def test_assistant_delta_translates_to_assistant_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("assistant_delta", {"delta": "hello"})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert "assistant_token" in kinds
    assistant = next(e for e in events if e["event"] == "assistant_token")
    assert assistant["data"]["text"] == "hello"


def test_tool_call_translates_to_tool_use(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("tool_call", {"id": "tc-1", "name": "read_file", "args": {"path": "/x"}})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    assert any(e["event"] == "tool_use" for e in events)


def test_agent_done_translates_to_turn_completed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("agent_done", {"status": "ok", "iterations": 1})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    assert any(e["event"] == "turn_completed" for e in events)


def test_final_content_emits_assistant_token_with_full_text(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If the agent never streams (only emits final_content), the UI should
    still see something to render. Translate final_content into a synthetic
    assistant_token carrying the full text."""
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("final_content", {"content": "Done."})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert "assistant_token" in kinds
    assistant = next(e for e in events if e["event"] == "assistant_token")
    assert assistant["data"]["text"] == "Done."


def test_usage_event_passes_through(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The frontend renders token usage. The translator must forward `usage`
    events emitted by the agent without dropping them."""
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("usage", {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150,
            "cached_input_tokens": 10,
            "cache_creation_tokens": 5,
            "model": "gpt-4o-mini",
        })

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    usage_events = [e for e in events if e["event"] == "usage"]
    assert len(usage_events) == 1
    assert usage_events[0]["data"]["total_tokens"] == 150
    assert usage_events[0]["data"]["model"] == "gpt-4o-mini"


def test_unknown_event_is_dropped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    async def fake_turn(*, on_event, **kwargs):
        on_event("retry", {"reason": "x"})  # unknown to UI; drop silently
        on_event("agent_done", {"status": "ok"})

    monkeypatch.setattr(chats_api, "run_chat_turn", fake_turn)
    r = client.post(f"/chats/{cid}/messages", json={"content": "hi"})
    events = _parse_sse(r.text)
    kinds = [e["event"] for e in events]
    assert "retry" not in kinds
    assert "turn_completed" in kinds
