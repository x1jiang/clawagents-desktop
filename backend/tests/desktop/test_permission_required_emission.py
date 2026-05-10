"""When the agent's tool registry returns requires_confirmation, run_chat_turn
must emit permission_required, await a decision, and proceed accordingly."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.permissions_api import get_registry


@pytest.mark.asyncio
async def test_permission_required_event_round_trip(tmp_path: Path) -> None:
    """Agent triggers a permission check; gateway emits permission_required;
    we POST a decision via the registry; agent receives 'allow' and continues."""
    proj = tmp_path / "p"
    proj.mkdir()

    captured_events: list[tuple[str, dict]] = []
    decisions_seen: list[str] = []

    class _AgentNeedingPermission:
        async def invoke(self, task, *, on_event=None, session_id=None, session_dir=None,
                         permission_callback=None, **kwargs):
            # Simulate the tool registry detecting a write outside project root.
            assert permission_callback is not None
            decision = await permission_callback({
                "tool": "write_file",
                "file_path": "/Users/me/Desktop/escape.txt",
                "reason": "acceptEdits scoped to /tmp/p; /Users/me/Desktop/escape.txt is outside",
            })
            decisions_seen.append(decision)
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    async def respond_to_permission():
        # Wait until the event is emitted, then resolve via the registry.
        for _ in range(50):
            await asyncio.sleep(0.02)
            for kind, data in captured_events:
                if kind == "permission_required":
                    get_registry().resolve(data["request_id"], "allow_once")
                    return

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _AgentNeedingPermission()):
        await asyncio.gather(
            chats_api.run_chat_turn(
                chat_id="chat-perm",
                content="please escape",
                project_root=str(proj),
                mode="auto",
                model="m",
                on_event=lambda kind, data: captured_events.append((kind, data)),
            ),
            respond_to_permission(),
        )

    kinds = [k for k, _ in captured_events]
    assert "permission_required" in kinds
    assert decisions_seen == ["allow_once"]
