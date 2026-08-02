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
    # Toggle the flag through the features API rather than replacing
    # ``features.is_enabled`` itself. 52 modules do ``from clawagents.config
    # .features import is_enabled``, binding the function object at import
    # time; any of them first imported while a fake was installed would keep
    # that fake forever, since monkeypatch only restores the attribute on the
    # features module. That is not hypothetical — it silently disabled
    # hunk_review for the rest of the session and broke an unrelated test
    # ~100 files later. ``temporary_overrides`` mutates the dict the real
    # ``is_enabled`` reads, so nothing can capture a stale callable.
    from clawagents.config.features import temporary_overrides

    with temporary_overrides({"session_persistence": True}):
        await _run_two_turns(tmp_path, monkeypatch)


async def _run_two_turns(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:

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

    # The current prompt is written to the JSONL before the turn runs (so a
    # crashed turn still shows it) AND passed as the task. Replaying a log that
    # already contains it handed the model the same prompt twice, which reads
    # as the user repeating themselves.
    current_prompt = [m for m in second_turn if "What was my favourite" in m]
    assert len(current_prompt) == 1, (
        "current prompt replayed as history *and* passed as the task. "
        f"messages were: {second_turn}"
    )

    # Turn 1's answer must be durable, not just streamed: GET /chats/:id/messages
    # rebuilds the transcript from this file, and cross-turn memory reads it.
    persisted = chat_jsonl.read_text(encoding="utf-8")
    assert '"assistant_message"' in persisted, (
        "no assistant_message persisted; a turn ending in plain prose writes "
        "none from the engine, so the gateway must record the final answer"
    )


@pytest.mark.asyncio
async def test_final_answer_is_not_double_persisted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The gateway's final-answer write must not duplicate the engine's.

    Guards the case where a run ends right after a tool round whose content the
    engine already stored: appending the identical text again would show the
    user the same reply twice on reload.
    """
    import json

    from clawagents.gateway.chats_api import _persist_final_assistant
    from clawagents.session.persistence import SessionWriter

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True)
    chat_id = "chat-dupe"
    path = sessions_dir / f"{chat_id}.jsonl"
    SessionWriter(session_id=chat_id, session_dir=sessions_dir).write_assistant_message(
        "already stored"
    )

    def _count(text: str) -> int:
        n = 0
        for line in path.read_text(encoding="utf-8").splitlines():
            event = json.loads(line)
            if event.get("type") == "assistant_message" and event.get("content") == text:
                n += 1
        return n

    _persist_final_assistant(path, sessions_dir, chat_id, "already stored")
    assert _count("already stored") == 1, "identical final answer was appended twice"

    _persist_final_assistant(path, sessions_dir, chat_id, "a genuinely new answer")
    assert _count("a genuinely new answer") == 1, "a new final answer must be recorded"

    for empty in ("", "   ", None):
        _persist_final_assistant(path, sessions_dir, chat_id, empty)
    assert len(path.read_text(encoding="utf-8").splitlines()) == 2, (
        "empty results should not create assistant messages"
    )
