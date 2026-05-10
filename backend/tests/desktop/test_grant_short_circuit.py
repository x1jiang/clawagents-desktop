"""Existing grants short-circuit prompts."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api
from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore
from clawagents.desktop_stores.project_store import ProjectStore


@pytest.mark.asyncio
async def test_grant_short_circuits_prompt(
    app_support_dir: Path, tmp_path: Path
) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    project = ProjectStore().create(name="p", root_path=str(project_root))
    sessions = project_root / ".clawagents" / "sessions"
    sessions.mkdir(parents=True)
    (sessions / "chat-z.jsonl").write_text(
        '{"type": "chat_meta", "ts": 0, "title": "t", "model": "m", "mode": "ask"}\n'
    )

    PermissionGrantStore().add(
        project_id=project.id,
        path_pattern=str(project_root / "out.txt"),
        scope="write",
    )

    captured_events: list[tuple[str, dict]] = []
    decisions: list[str] = []

    class _Agent:
        async def invoke(self, task, *, on_event=None, session_id=None,
                         session_dir=None, permission_callback=None, **kwargs):
            d = await permission_callback({
                "tool": "write_file",
                "file_path": str(project_root / "out.txt"),
                "reason": "needs confirmation",
            })
            decisions.append(d)
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _Agent()):
        await chats_api.run_chat_turn(
            chat_id="chat-z", content="hi",
            project_root=str(project_root), mode="ask", model="m",
            on_event=lambda kind, data: captured_events.append((kind, data)),
        )

    kinds = [k for k, _ in captured_events]
    assert "permission_required" not in kinds, f"grant should have short-circuited, got {kinds}"
    assert decisions == ["allow_once"], f"expected auto-allow, got {decisions}"
