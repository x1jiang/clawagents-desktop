"""When user picks allow_always for a project chat, persist a PermissionGrant."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api
from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore
from clawagents.desktop_stores.project_store import ProjectStore


@pytest.mark.asyncio
async def test_allow_always_persists_grant(
    app_support_dir: Path, tmp_path: Path
) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    project = ProjectStore().create(name="p", root_path=str(project_root))

    sessions = project_root / ".clawagents" / "sessions"
    sessions.mkdir(parents=True)
    (sessions / "chat-x.jsonl").write_text(
        '{"type": "chat_meta", "ts": 0, "title": "t", "model": "m", "mode": "ask"}\n'
    )

    captured_events: list[tuple[str, dict]] = []

    class _AgentNeedingPermission:
        async def invoke(self, task, *, on_event=None, session_id=None,
                         session_dir=None, permission_callback=None, **kwargs):
            await permission_callback({
                "tool": "write_file",
                "file_path": str(project_root / "out.txt"),
                "reason": "needs confirmation",
            })
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    async def respond_to_permission():
        for _ in range(50):
            await asyncio.sleep(0.02)
            for kind, data in captured_events:
                if kind == "permission_required":
                    from clawagents.gateway.permissions_api import get_registry
                    get_registry().resolve(data["request_id"], "allow_always")
                    return

    with patch("clawagents.agent.create_claw_agent",
               side_effect=lambda **_: _AgentNeedingPermission()):
        await asyncio.gather(
            chats_api.run_chat_turn(
                chat_id="chat-x",
                content="hi",
                project_root=str(project_root),
                mode="ask",
                model="m",
                on_event=lambda kind, data: captured_events.append((kind, data)),
            ),
            respond_to_permission(),
        )

    grants = PermissionGrantStore().list()
    assert len(grants) == 1, f"expected 1 grant, got {grants}"
    g = grants[0]
    assert g.project_id == project.id
    import fnmatch
    assert fnmatch.fnmatch(str(project_root / "out.txt"), g.path_pattern)


@pytest.mark.asyncio
async def test_allow_once_does_not_persist_grant(
    app_support_dir: Path, tmp_path: Path
) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    ProjectStore().create(name="p", root_path=str(project_root))
    sessions = project_root / ".clawagents" / "sessions"
    sessions.mkdir(parents=True)
    (sessions / "chat-y.jsonl").write_text(
        '{"type": "chat_meta", "ts": 0, "title": "t", "model": "m", "mode": "ask"}\n'
    )

    captured_events: list[tuple[str, dict]] = []

    class _Agent:
        async def invoke(self, task, *, on_event=None, session_id=None,
                         session_dir=None, permission_callback=None, **kwargs):
            await permission_callback({"tool": "write_file", "file_path": "/x", "reason": "r"})
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    async def respond():
        for _ in range(50):
            await asyncio.sleep(0.02)
            for kind, data in captured_events:
                if kind == "permission_required":
                    from clawagents.gateway.permissions_api import get_registry
                    get_registry().resolve(data["request_id"], "allow_once")
                    return

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _Agent()):
        await asyncio.gather(
            chats_api.run_chat_turn(
                chat_id="chat-y", content="hi",
                project_root=str(project_root), mode="ask", model="m",
                on_event=lambda kind, data: captured_events.append((kind, data)),
            ),
            respond(),
        )

    assert PermissionGrantStore().list() == []
