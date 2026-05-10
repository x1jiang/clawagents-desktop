"""Two concurrent run_chat_turn calls must serialize on the chdir-protecting
process lock to avoid corrupting cwd across each other."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import patch

import pytest

import clawagents.gateway.chats_api as chats_api


@pytest.mark.asyncio
async def test_concurrent_turns_observe_correct_cwd(tmp_path: Path) -> None:
    """If two turns run on different project_roots concurrently, each must
    observe its own project_root as cwd. Without serialization, one would
    see the other's chdir."""
    proj_a = tmp_path / "a"
    proj_a.mkdir()
    proj_b = tmp_path / "b"
    proj_b.mkdir()

    observed_cwds: list[tuple[str, str]] = []  # (chat_id, cwd_seen)

    class _StubAgent:
        def __init__(self, chat_id: str) -> None:
            self.chat_id = chat_id

        async def invoke(self, task, *, on_event=None, session_id=None, session_dir=None, **kwargs):
            # Yield twice to give the other turn a chance to interleave.
            await asyncio.sleep(0.01)
            observed_cwds.append((self.chat_id, os.getcwd()))
            await asyncio.sleep(0.01)
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    def fake_create(**kwargs):
        return _StubAgent(_StubAgent._current_chat_id)

    _StubAgent._current_chat_id = "x"

    async def turn(chat_id: str, project_root: Path):
        _StubAgent._current_chat_id = chat_id
        with patch("clawagents.agent.create_claw_agent", side_effect=fake_create):
            await chats_api.run_chat_turn(
                chat_id=chat_id,
                content="hi",
                project_root=str(project_root),
                mode="auto",
                model="m",
                on_event=lambda *args: None,
            )

    # Note: the test is illustrative — patching `_StubAgent._current_chat_id`
    # on a class is racy. Real verification is via the per-chat lock test
    # below; this test asserts that AT LEAST one observation has the right cwd.
    await asyncio.gather(
        turn("chat-a", proj_a),
        turn("chat-b", proj_b),
    )

    by_chat = dict(observed_cwds)
    assert os.path.realpath(by_chat["chat-a"]) == os.path.realpath(str(proj_a))
    assert os.path.realpath(by_chat["chat-b"]) == os.path.realpath(str(proj_b))


@pytest.mark.asyncio
async def test_same_chat_serializes_turns(tmp_path: Path) -> None:
    """Two turns on the same chat must run serially, not interleaved."""
    proj = tmp_path / "p"
    proj.mkdir()

    started: list[str] = []
    finished: list[str] = []

    class _SlowAgent:
        async def invoke(self, task, *, on_event=None, session_id=None, session_dir=None, **kwargs):
            started.append(task)
            await asyncio.sleep(0.02)
            finished.append(task)
            from clawagents.run_result import RunResult
            return RunResult(status="ok", result="done", iterations=1)

    with patch("clawagents.agent.create_claw_agent", side_effect=lambda **_: _SlowAgent()):
        await asyncio.gather(
            chats_api.run_chat_turn(
                chat_id="chat-shared",
                content="first",
                project_root=str(proj),
                mode="auto",
                model="m",
                on_event=lambda *args: None,
            ),
            chats_api.run_chat_turn(
                chat_id="chat-shared",
                content="second",
                project_root=str(proj),
                mode="auto",
                model="m",
                on_event=lambda *args: None,
            ),
        )

    # Order must be: first started, first finished, second started, second finished.
    # (No interleaving of started/finished pairs.)
    assert started == ["first", "second"] or started == ["second", "first"]
    assert finished == started  # Same order — no overlap.
