"""run_chat_turn must wire on_stream_event so token deltas surface as
assistant_delta events on the SSE stream."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api


@pytest.mark.asyncio
async def test_stream_event_emits_assistant_delta(tmp_path: Path) -> None:
    proj = tmp_path / "p"
    proj.mkdir()

    captured: list[tuple[str, dict]] = []

    class _StreamingAgent:
        async def invoke(self, task, *, on_event=None, on_stream_event=None,
                         session_id=None, session_dir=None, **kwargs):
            assert on_stream_event is not None, "expected on_stream_event hook"
            on_stream_event({"delta": "Hel"})
            on_stream_event({"delta": "lo"})
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="Hello", iterations=1)

    with patch("clawagents.agent.create_claw_agent",
               side_effect=lambda **_: _StreamingAgent()):
        await chats_api.run_chat_turn(
            chat_id="chat-stream",
            content="hi",
            project_root=str(proj),
            mode="auto",
            model="m",
            on_event=lambda kind, data: captured.append((kind, data)),
        )

    deltas = [data for kind, data in captured if kind == "assistant_delta"]
    assert len(deltas) == 2
    assert deltas[0].get("delta") == "Hel"
    assert deltas[1].get("delta") == "lo"
