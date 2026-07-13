"""Cancellation must actually interrupt a running turn.

``POST /chats/:id/cancel`` (and client disconnect) set a per-chat
``cancel_event``. Historically nothing consumed it: ``agent.invoke`` was
awaited with no cancel signal, so a turn ran to completion in the background
— burning tokens — after the user hit Stop. ``test_cancel.py`` only checked
that the event got *set*, which hid the gap.

This drives ``run_chat_turn`` with an agent whose ``invoke`` blocks, sets the
cancel event, and asserts the turn stops promptly and the agent was actually
interrupted. On the pre-fix code this test times out.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest


class _FakeTools:
    def register(self, _tool) -> None:  # run_chat_turn registers ask_user
        pass


class _BlockingAgent:
    def __init__(self) -> None:
        self.cancelled = False
        self.started = asyncio.Event()
        self.tools = _FakeTools()

    async def invoke(self, task, **kwargs):
        self.started.set()
        try:
            await asyncio.sleep(30)  # a "long" turn
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        return object()


@pytest.mark.asyncio
async def test_cancel_event_interrupts_running_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)

    agent = _BlockingAgent()
    monkeypatch.setattr(
        "clawagents.agent.create_claw_agent", lambda *a, **k: agent
    )

    chat_id = "chat-cancel"
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

    from clawagents.gateway.chats_api import run_chat_turn

    cancel_event = asyncio.Event()
    events: list[tuple[str, dict]] = []

    turn = asyncio.create_task(
        run_chat_turn(
            chat_id=chat_id,
            content="do a long thing",
            project_root=str(tmp_path),
            mode="auto",
            model="",
            on_event=lambda k, d: events.append((k, d)),
            cancel_event=cancel_event,
        )
    )

    # Wait until the agent is mid-invoke, then cancel.
    await asyncio.wait_for(agent.started.wait(), timeout=5)
    cancel_event.set()

    # The turn must stop promptly (NOT wait out the 30s sleep).
    await asyncio.wait_for(turn, timeout=5)

    assert agent.cancelled, "agent.invoke was not interrupted by cancel_event"
    assert any(
        k == "error" and d.get("message") == "cancelled" for k, d in events
    ), f"no cancelled event emitted; got {[k for k, _ in events]}"


@pytest.mark.asyncio
async def test_no_cancel_event_completes_normally(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Happy path unchanged: without a cancel_event the turn runs to done."""
    monkeypatch.chdir(tmp_path)

    class _QuickAgent:
        tools = _FakeTools()

        async def invoke(self, task, *, on_event=None, **kwargs):
            if on_event:
                on_event("assistant_token", {"text": "ok"})

            class _R:
                status = "done"
                iterations = 1
                result = "ok"

            return _R()

    monkeypatch.setattr(
        "clawagents.agent.create_claw_agent", lambda *a, **k: _QuickAgent()
    )
    chat_id = "chat-ok"
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

    from clawagents.gateway.chats_api import run_chat_turn

    events: list[tuple[str, dict]] = []
    await run_chat_turn(
        chat_id=chat_id,
        content="hi",
        project_root=str(tmp_path),
        mode="auto",
        model="",
        on_event=lambda k, d: events.append((k, d)),
    )
    assert any(k == "turn_completed" for k, _ in events)
    assert not any(
        k == "error" and d.get("message") == "cancelled" for k, d in events
    )
