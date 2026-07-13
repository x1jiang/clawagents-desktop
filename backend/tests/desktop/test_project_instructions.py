"""Project instructions auto-injection on first turn.

When a chat's project root has CLAUDE.md (or .clawagents/instructions.md /
AGENTS.md), the first user message gets wrapped with the instructions inside
<project_instructions>...</project_instructions> tags. Subsequent turns in
the same chat see the raw user content because the chat history already
carries the instructions.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api


class _CaptureAgent:
    def __init__(self) -> None:
        self.received_task: str | None = None

    async def invoke(self, task: str, **kwargs):
        self.received_task = task
        from clawagents.run_result import RunResult
        return RunResult(status="ok", result="done", iterations=1)


@pytest.mark.asyncio
async def test_injects_claude_md_on_first_turn(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "CLAUDE.md").write_text("Use TypeScript for new files.")

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id="chat-instr-1",
            content="What's up?",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert agent.received_task is not None
    assert "<project_instructions>" in agent.received_task
    assert "Use TypeScript for new files." in agent.received_task
    assert agent.received_task.endswith("What's up?")


@pytest.mark.asyncio
async def test_does_not_reinject_on_second_turn(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "CLAUDE.md").write_text("Use TypeScript.")

    # Simulate that the chat already has a user_message in its JSONL.
    sessions_dir = project_root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / "chat-instr-2.jsonl").write_text(
        '{"type": "user_message", "ts": 0, "content": "prior"}\n'
    )

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id="chat-instr-2",
            content="Second turn here.",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert agent.received_task == "Second turn here."
    assert "<project_instructions>" not in agent.received_task


@pytest.mark.asyncio
async def test_falls_back_to_clawagents_instructions(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / ".clawagents").mkdir()
    (project_root / ".clawagents" / "instructions.md").write_text("Be terse.")

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id="chat-instr-3",
            content="Hello.",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert "Be terse." in (agent.received_task or "")


@pytest.mark.asyncio
async def test_claude_md_wins_over_agents_md(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "CLAUDE.md").write_text("FROM_CLAUDE")
    (project_root / "AGENTS.md").write_text("FROM_AGENTS")

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id="chat-instr-4",
            content="hi",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert "FROM_CLAUDE" in (agent.received_task or "")
    assert "FROM_AGENTS" not in (agent.received_task or "")


@pytest.mark.asyncio
async def test_no_instruction_file_means_raw_task(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()

    agent = _CaptureAgent()
    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: agent):
        await chats_api.run_chat_turn(
            chat_id="chat-instr-5",
            content="just hi",
            project_root=str(project_root),
            mode="auto",
            model="claude-opus-4-7",
            on_event=lambda *_: None,
        )

    assert agent.received_task == "just hi"
