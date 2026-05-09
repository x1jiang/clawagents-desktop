"""run_chat_turn integrates SessionWriter, chdir, and the agent.

We patch ``clawagents.agent.create_claw_agent`` to a fake whose ``invoke``
emits a small set of events, so we exercise the wiring without touching a
real LLM.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api


class _FakeAgent:
    def __init__(self) -> None:
        self.last_cwd: str | None = None

    async def invoke(self, task: str, *, on_event=None, **kwargs):
        self.last_cwd = os.getcwd()
        if on_event:
            on_event("assistant_token", {"text": "hi"})
        from clawagents.run_result import RunResult
        return RunResult(status="ok", result="done", iterations=1)


@pytest.mark.asyncio
async def test_chdirs_to_project_root(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()

    fake = _FakeAgent()

    def fake_create(**kwargs):
        return fake

    with patch("clawagents.agent.create_claw_agent", side_effect=fake_create):
        events: list[tuple[str, dict]] = []
        await chats_api.run_chat_turn(
            chat_id="chat-1",
            content="hi",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda kind, data: events.append((kind, data)),
        )

    assert os.path.realpath(fake.last_cwd) == os.path.realpath(str(project_root))
    assert any(k == "assistant_token" for k, _ in events)
    assert events[-1][0] == "turn_completed"
    assert events[-1][1]["status"] == "ok"


@pytest.mark.asyncio
async def test_appends_user_message_event(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()

    def fake_create(**kwargs):
        return _FakeAgent()

    with patch("clawagents.agent.create_claw_agent", side_effect=fake_create):
        events: list[tuple[str, dict]] = []
        await chats_api.run_chat_turn(
            chat_id="chat-1",
            content="hello there",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda kind, data: events.append((kind, data)),
        )

    kinds = [k for k, _ in events]
    assert "user_message" in kinds
    user_event = next(d for k, d in events if k == "user_message")
    assert user_event["content"] == "hello there"


@pytest.mark.asyncio
async def test_session_writes_land_in_chat_jsonl(tmp_path: Path) -> None:
    """run_chat_turn must pass chat_id+session_dir to agent.invoke so the
    agent's SessionWriter appends to <project_root>/.clawagents/sessions/<chat-id>.jsonl
    rather than a separate session-<ts>.jsonl."""
    project_root = tmp_path / "proj"
    project_root.mkdir()
    sessions_dir = project_root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True)
    chat_jsonl = sessions_dir / "chat-abc.jsonl"
    chat_jsonl.write_text('{"type": "chat_meta", "ts": 0, "title": "t", "model": "m", "mode": "auto"}\n')

    captured: dict = {}

    class _StubAgent:
        async def invoke(self, task, *, on_event=None, session_id=None, session_dir=None, **kwargs):
            captured["session_id"] = session_id
            captured["session_dir"] = session_dir
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _StubAgent()):
        events: list[tuple[str, dict]] = []
        await chats_api.run_chat_turn(
            chat_id="chat-abc",
            content="hi",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda kind, data: events.append((kind, data)),
        )

    assert captured["session_id"] == "chat-abc"
    assert str(captured["session_dir"]) == str(sessions_dir)
