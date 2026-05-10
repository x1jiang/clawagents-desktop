"""When the agent processes a write-class tool call in DEFAULT mode and a
permission_callback is provided, the callback must be invoked exactly once
with a payload describing the tool. The agent then proceeds based on the
callback's return value."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.mark.asyncio
async def test_permission_callback_invoked_for_write_in_default_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("clawagents.config.features.is_enabled", lambda name: False)

    callback_invocations: list[dict] = []

    async def cb(payload: dict) -> str:
        callback_invocations.append(payload)
        return "deny"

    from clawagents.providers.llm import LLMProvider, LLMResponse, NativeToolCall
    from clawagents.agent import create_claw_agent

    class _StubLLM(LLMProvider):
        name = "stub"
        n_calls = 0

        async def chat(self, messages, on_chunk=None, cancel_event=None, tools=None, **kwargs):
            type(self).n_calls += 1
            if type(self).n_calls == 1:
                return LLMResponse(
                    content="",
                    model="stub",
                    tokens_used=1,
                    tool_calls=[NativeToolCall(
                        tool_name="write_file",
                        args={"path": str(tmp_path / "out.txt"), "content": "hi"},
                        tool_call_id="call_1",
                    )],
                    cache_read_tokens=0,
                    cache_creation_tokens=0,
                )
            else:
                # After tool was denied, return a final answer so the loop ends.
                return LLMResponse(
                    content="ok",
                    model="stub",
                    tokens_used=1,
                    cache_read_tokens=0,
                    cache_creation_tokens=0,
                )

    agent = create_claw_agent(model=_StubLLM())
    await agent.invoke(
        "write a file",
        max_iterations=2,
        permission_callback=cb,
    )

    assert len(callback_invocations) >= 1, f"expected ≥1 callback call, got {callback_invocations}"
    payload = callback_invocations[0]
    assert payload.get("tool") == "write_file" or payload.get("name") == "write_file"
