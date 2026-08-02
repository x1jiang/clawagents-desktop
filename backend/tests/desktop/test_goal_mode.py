"""Goal mode must reach ``create_claw_agent(goal_mode=True)``.

The flag travels UI checkbox → POST body → run_chat_turn → agent kwargs, and
every hop is a place it can be dropped silently: run_chat_turn filters its
kwargs against the real ``create_claw_agent`` signature, so a typo'd key simply
vanishes with no error. These tests pin the whole chain.

Mirrors tests/desktop/test_caveman.py, which pins the sibling flag.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest


class _FakeTools:
    def register(self, _tool) -> None:
        pass


class _Result:
    status = "done"
    iterations = 1
    result = "ok"


def _seed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.chdir(tmp_path)
    captured: dict = {}

    class _Agent:
        tools = _FakeTools()

        async def invoke(self, task, **kwargs):
            return _Result()

    from clawagents.agent import create_claw_agent as _real

    def _make(*args, **kwargs):
        captured.update(kwargs)
        return _Agent()

    # Must introspect to the real signature: run_chat_turn both probes it for
    # capability and filters the final kwargs through it.
    _make.__signature__ = inspect.signature(_real)
    monkeypatch.setattr("clawagents.agent.create_claw_agent", _make)

    chat_id = "chat-goal"
    sessions_dir = tmp_path / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / f"{chat_id}.jsonl").touch()
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_chat",
        lambda cid: (sessions_dir / f"{cid}.jsonl", "proj"),
    )
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_root_for_chat",
        lambda cid: (str(tmp_path), "proj"),
    )
    return captured


async def _run(tmp_path: Path, captured: dict, **kwargs) -> None:
    from clawagents.gateway.chats_api import run_chat_turn

    await run_chat_turn(
        chat_id="chat-goal",
        content="ship the feature",
        project_root=str(tmp_path),
        mode="auto",
        model="",
        on_event=lambda k, d: None,
        **kwargs,
    )


def test_engine_actually_supports_goal_mode() -> None:
    """If this fails the feature is dead regardless of the wiring below."""
    from clawagents.agent import create_claw_agent

    assert "goal_mode" in inspect.signature(create_claw_agent).parameters


@pytest.mark.asyncio
async def test_goal_true_sets_goal_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _seed(tmp_path, monkeypatch)
    await _run(tmp_path, captured, goal=True)
    assert captured.get("goal_mode") is True


@pytest.mark.asyncio
async def test_goal_false_omits_goal_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _seed(tmp_path, monkeypatch)
    await _run(tmp_path, captured, goal=False)
    assert "goal_mode" not in captured


@pytest.mark.asyncio
async def test_goal_defaults_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Long-horizon autopilot costs real tokens; it must be opt-in."""
    captured = _seed(tmp_path, monkeypatch)
    await _run(tmp_path, captured)
    assert "goal_mode" not in captured


def test_post_body_accepts_and_defaults_goal() -> None:
    from clawagents.gateway.chats_api import MessageBody

    assert MessageBody(content="hi").goal is False
    assert MessageBody(content="hi", goal=True).goal is True
