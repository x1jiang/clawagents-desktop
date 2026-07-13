"""Streaming assistant text: no doubling, and the sanitized final wins.

Streaming is on by default, so the typed channel emits per-token
``assistant_delta`` events (raw, may include ``<think>`` tokens) followed by
``assistant_message`` carrying the COMPLETE, sanitized text. The UI appends
deltas live, then ``assistant_final`` REPLACES them with the clean message.

Two regressions are guarded here:
  1. text must not double ("hello" not "hellohello"), and
  2. the sanitized final must win over raw streamed text (``<think>`` stripped).

This drives a real ``run_chat_turn`` with a streaming stub LLM and replays the
exact UI reducer (append ``assistant_token`` / replace on ``assistant_final``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from clawagents.providers.llm import LLMProvider, LLMResponse


def _render(events: list[tuple[str, dict]]) -> str:
    """Replay the UI store reducer for assistant text."""
    content = ""
    have_msg = False
    for kind, data in events:
        if kind == "assistant_token":
            content += data.get("text", "")
            have_msg = True
        elif kind == "assistant_final":
            content = data.get("content", "")  # replace, not append
            have_msg = True
    assert have_msg, "no assistant text rendered"
    return content


async def _run_and_render(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stream_chunks, final_content
) -> str:
    monkeypatch.chdir(tmp_path)

    class _StubLLM(LLMProvider):
        name = "stub"

        async def chat(self, messages, on_chunk=None, cancel_event=None, tools=None, **kwargs):
            if on_chunk is not None:
                for c in stream_chunks:
                    on_chunk(c)
            return LLMResponse(content=final_content, model="stub", tokens_used=1)

    from clawagents.agent import create_claw_agent as _real_create

    def _make_with_stub(*args, **kwargs):
        kwargs["model"] = _StubLLM()
        return _real_create(*args, **kwargs)

    monkeypatch.setattr("clawagents.agent.create_claw_agent", _make_with_stub)

    chat_id = "chat-doubletest"
    sessions_dir = tmp_path / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    chat_jsonl = sessions_dir / f"{chat_id}.jsonl"
    chat_jsonl.touch()
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_chat", lambda cid: (chat_jsonl, "proj")
    )
    monkeypatch.setattr(
        "clawagents.gateway.chats_api._resolve_root_for_chat",
        lambda cid: (str(tmp_path), "proj"),
    )

    from clawagents.gateway.chats_api import _translate_event, run_chat_turn

    rendered_events: list[tuple[str, dict]] = []

    def on_event(kind: str, data: dict) -> None:
        translated = _translate_event(kind, data)
        if translated and translated[0] in ("assistant_token", "assistant_final"):
            rendered_events.append(translated)

    await run_chat_turn(
        chat_id=chat_id,
        content="say it",
        project_root=str(tmp_path),
        mode="full_access",
        model="",
        on_event=on_event,
    )
    return _render(rendered_events)


@pytest.mark.asyncio
async def test_streaming_text_not_doubled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rendered = await _run_and_render(tmp_path, monkeypatch, ["hel", "lo"], "hello")
    assert rendered == "hello", f"assistant text doubled/malformed: {rendered!r}"


@pytest.mark.asyncio
async def test_sanitized_final_replaces_streamed_think_tokens(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rendered = await _run_and_render(
        tmp_path, monkeypatch, ["<think>reason</think>", "Answer: 42"], "Answer: 42"
    )
    assert rendered == "Answer: 42", f"raw think text leaked into render: {rendered!r}"
    assert "<think>" not in rendered
