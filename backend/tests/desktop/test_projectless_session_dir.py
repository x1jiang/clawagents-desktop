"""run_chat_turn must route projectless chat sessions to the projectless
chats dir, not <scratch>/.clawagents/sessions/."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api
from clawagents.desktop_stores.app_paths import projectless_chats_dir, projectless_scratch_dir


@pytest.mark.asyncio
async def test_projectless_chat_session_dir_is_app_chats_dir(
    app_support_dir: Path,
) -> None:
    """A projectless chat's agent session events must land at
    <app_support>/chats/<cid>.jsonl alongside the chat_meta file."""
    chat_id = "chat-pl-123"
    # Pre-create the projectless chat metadata file (as the POST /chats handler does)
    pl_dir = projectless_chats_dir()
    pl_dir.mkdir(parents=True, exist_ok=True)
    (pl_dir / f"{chat_id}.jsonl").write_text(
        '{"type": "chat_meta", "ts": 0, "title": "t", "model": "m", "mode": "read_only"}\n'
    )
    scratch = projectless_scratch_dir() / chat_id
    scratch.mkdir(parents=True, exist_ok=True)

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
            chat_id=chat_id,
            content="hi",
            project_root=str(scratch),
            mode="read_only",
            model="claude-opus-4-7",
            on_event=lambda kind, data: events.append((kind, data)),
        )

    assert captured["session_id"] == chat_id
    assert Path(captured["session_dir"]) == pl_dir
