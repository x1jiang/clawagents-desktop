"""Across two POSTs to the same chat, the agent must see prior turns.

Before this test we discovered that desktop chats were creating a fresh
agent per turn without replaying history — every turn started amnesic.
The gateway now preloads the JSONL into a Session before invoking the
agent. This test pins that contract.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_second_turn_sees_first_turn_messages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("clawagents.config.features.is_enabled", lambda name: name == "session_persistence")

    # Stub LLM that records what it was given on each call.
    from clawagents.providers.llm import LLMProvider, LLMResponse

    received: list[list[str]] = []

    class _RecordingLLM(LLMProvider):
        name = "stub"

        async def chat(self, messages, on_chunk=None, cancel_event=None, tools=None, **kwargs):
            received.append([f"{m.role}:{(m.content or '')[:40]}" for m in messages])
            return LLMResponse(
                content="ack",
                model="stub",
                tokens_used=1,
                cache_read_tokens=0,
                cache_creation_tokens=0,
            )

    from clawagents.gateway.chats_api import run_chat_turn

    # Patch create_claw_agent at its source — the gateway imports it
    # lazily inside the function body, so the patch lands on the agent
    # module's binding.
    from clawagents.agent import create_claw_agent as _real_create
    def _make_with_stub(*args, **kwargs):
        kwargs["model"] = _RecordingLLM()
        return _real_create(*args, **kwargs)
    monkeypatch.setattr("clawagents.agent.create_claw_agent", _make_with_stub)

    # Seed a chat JSONL where the gateway expects it.
    chat_id = "chat-memtest"
    sessions_dir = tmp_path / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True)
    chat_jsonl = sessions_dir / f"{chat_id}.jsonl"
    chat_jsonl.touch()

    # Stub _resolve_chat to make the gateway find our seeded chat without
    # going through the full project store.
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_chat",
        lambda cid: (chat_jsonl, "proj"),
    )
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_root_for_chat",
        lambda cid: (str(tmp_path), "proj"),
    )

    events: list[tuple[str, dict]] = []
    def on_event(kind: str, data: dict) -> None:
        events.append((kind, data))

    # ── Turn 1 ───────────────────────────────────────────────────────
    await run_chat_turn(
        chat_id=chat_id,
        content="My favourite number is 42.",
        project_root=str(tmp_path),
        mode="full_access",
        model="",
        on_event=on_event,
    )
    assert len(received) >= 1, "first turn should call the LLM"
    first_turn = received[0]
    # First call: no prior assistant turn referenced.
    first_blob = "\n".join(first_turn)
    assert "ack" not in first_blob, (
        f"first turn shouldn't see a previous assistant reply; got {first_turn}"
    )

    # ── Turn 2 ───────────────────────────────────────────────────────
    received.clear()
    await run_chat_turn(
        chat_id=chat_id,
        content="What was my favourite number?",
        project_root=str(tmp_path),
        mode="full_access",
        model="",
        on_event=on_event,
    )
    assert len(received) >= 1, "second turn should call the LLM"
    second_turn = received[0]

    # The second call MUST include the first user message and the first
    # assistant reply (otherwise the model has no memory of the prior turn).
    second_blob = "\n".join(second_turn)
    assert "favourite number is 42" in second_blob, (
        "second turn lost the first user message; preload broke. "
        f"messages were: {second_turn}"
    )
    assert "ack" in second_blob, (
        "second turn lost the first assistant reply; preload broke. "
        f"messages were: {second_turn}"
    )
