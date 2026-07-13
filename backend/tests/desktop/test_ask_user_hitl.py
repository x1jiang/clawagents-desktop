"""ask_user HITL thread-bridge regression.

The interactive ask_user path runs ``ask_fn`` inside a thread-pool executor
(AskUserTool.execute -> run_in_executor). Two things must hold:

  1. ``ask_fn`` cannot call ``asyncio.get_event_loop()`` (raises in a worker
     thread) — it must marshal back onto the *gateway* loop captured at
     registration time.
  2. ``resolve_ask`` may run on a different thread (FastAPI sync endpoints run
     in a threadpool), so it must wake the waiter via ``call_soon_threadsafe``,
     not a bare ``set_result``.

Before the fix, ``ask_fn`` swallowed a RuntimeError and returned None, so the
tool always reported "User skipped" and the prompt never reached the UI.
"""

from __future__ import annotations

import asyncio

import pytest

from clawagents.gateway.agent_power_api import (
    create_ask_request,
    resolve_ask,
    wait_ask,
)
from clawagents.tools.interactive import AskUserTool


def _build_ask_fn(gateway_loop: asyncio.AbstractEventLoop, captured: dict):
    """Mirror chats_api._make_ask_user_tool's interactive ask_fn."""

    def ask_fn(question: str) -> str | None:
        async def _ask() -> str | None:
            request_id = create_ask_request()
            captured["request_id"] = request_id
            return await wait_ask(request_id, timeout=5.0)

        try:
            fut = asyncio.run_coroutine_threadsafe(_ask(), gateway_loop)
            return fut.result(timeout=6)
        except Exception:  # noqa: BLE001
            return None

    return ask_fn


@pytest.mark.asyncio
async def test_interactive_ask_user_returns_answer_across_threads() -> None:
    gateway_loop = asyncio.get_running_loop()
    captured: dict = {}
    tool = AskUserTool(ask_fn=_build_ask_fn(gateway_loop, captured))

    async def resolver() -> None:
        # Wait until the ask request has been registered by the worker thread.
        for _ in range(200):
            if "request_id" in captured:
                break
            await asyncio.sleep(0.01)
        assert "request_id" in captured, "ask_fn never registered a request"
        # Resolve from a worker thread — exercises the cross-thread wake path.
        await asyncio.to_thread(resolve_ask, captured["request_id"], "use bullets")

    exec_task = asyncio.create_task(tool.execute({"question": "how?"}))
    await resolver()
    result = await exec_task

    assert result.success, f"ask_user did not succeed: {result.error!r}"
    assert "use bullets" in result.output


@pytest.mark.asyncio
async def test_interactive_ask_user_times_out_to_none() -> None:
    gateway_loop = asyncio.get_running_loop()
    captured: dict = {}

    def ask_fn(question: str) -> str | None:
        async def _ask() -> str | None:
            request_id = create_ask_request()
            captured["request_id"] = request_id
            return await wait_ask(request_id, timeout=0.2)

        try:
            fut = asyncio.run_coroutine_threadsafe(_ask(), gateway_loop)
            return fut.result(timeout=3)
        except Exception:  # noqa: BLE001
            return None

    tool = AskUserTool(ask_fn=ask_fn)
    result = await tool.execute({"question": "no one answers"})
    # Timeout -> None -> AskUserTool reports skip, not a crash/hang.
    assert not result.success
    assert "skipped" in (result.error or "").lower()
