"""Caveman mode must inject its terse-style instruction into the agent.

Previously shipped with zero coverage; this pins the wiring so a refactor
can't silently drop it.
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

    # run_chat_turn filters kwargs by ``inspect.signature(create_claw_agent)``,
    # so the fake must introspect to the real parameter list (else instruction
    # / model would be filtered out before the call).
    _make.__signature__ = inspect.signature(_real)
    monkeypatch.setattr("clawagents.agent.create_claw_agent", _make)

    chat_id = "chat-caveman"
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


@pytest.mark.asyncio
async def test_caveman_true_injects_instruction(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _seed(tmp_path, monkeypatch)
    from clawagents.gateway.chats_api import run_chat_turn

    await run_chat_turn(
        chat_id="chat-caveman",
        content="hi",
        project_root=str(tmp_path),
        mode="auto",
        model="",
        on_event=lambda k, d: None,
        caveman=True,
    )
    assert "Caveman mode ON" in (captured.get("instruction") or "")


@pytest.mark.asyncio
async def test_caveman_false_omits_instruction(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _seed(tmp_path, monkeypatch)
    from clawagents.gateway.chats_api import run_chat_turn

    await run_chat_turn(
        chat_id="chat-caveman",
        content="hi",
        project_root=str(tmp_path),
        mode="auto",
        model="",
        on_event=lambda k, d: None,
        caveman=False,
    )
    assert "Caveman" not in (captured.get("instruction") or "")
