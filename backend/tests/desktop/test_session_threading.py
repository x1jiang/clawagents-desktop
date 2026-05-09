"""When agent.invoke is called with session_id + session_dir, the SessionWriter
inside run_agent_graph receives those arguments — not a fresh generated id."""

from __future__ import annotations

from pathlib import Path

import pytest

from clawagents.graph.agent_loop import AgentState


# ---------------------------------------------------------------------------
# Note: The LLMProvider ABC uses chat() — not complete()/stream().  Rather
# than building a full stub that satisfies the entire agent loop, we
# monkey-patch run_agent_graph to a thin async stub that constructs
# SessionWriter with the forwarded kwargs and returns immediately.
# This is the documented fallback approach.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_id_and_dir_route_session_writer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Calling invoke(task, session_id=..., session_dir=...) constructs
    SessionWriter with those exact kwargs."""
    captured: dict = {}

    real_writer_module = __import__(
        "clawagents.session.persistence", fromlist=["SessionWriter"]
    )
    real_writer = real_writer_module.SessionWriter

    async def _stub_run_agent_graph(
        task,
        llm,
        *,
        session_id=None,
        session_dir=None,
        **kwargs,
    ):
        # Construct the SessionWriter with forwarded args so we can assert
        # both on captured kwargs AND on the file being written.
        writer = real_writer(session_id=session_id, session_dir=session_dir)
        writer.append("turn_started", {"iteration": 1})
        captured["session_id"] = session_id
        captured["session_dir"] = session_dir
        captured["writer"] = writer
        return AgentState(
            messages=[],
            current_task=task,
            status="done",
            result="ok",
            iterations=1,
            max_iterations=1,
            tool_calls=0,
        )

    import clawagents.graph.agent_loop as _loop_mod

    monkeypatch.setattr(_loop_mod, "run_agent_graph", _stub_run_agent_graph)

    # Also patch via the agent module's imported reference
    import clawagents.agent as _agent_mod

    monkeypatch.setattr(_agent_mod, "run_agent_graph", _stub_run_agent_graph)

    from clawagents.agent import create_claw_agent

    target_dir = tmp_path / "chats"
    agent = create_claw_agent(model=None)
    await agent.invoke(
        "say ok",
        session_id="chat-x",
        session_dir=target_dir,
        max_iterations=1,
    )

    assert captured.get("session_id") == "chat-x"
    assert captured.get("session_dir") == target_dir
    assert (target_dir / "chat-x.jsonl").exists()


@pytest.mark.asyncio
async def test_default_session_id_uses_generated_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without session_id, the writer falls back to its built-in generated id
    in the cwd-based path (existing behavior, unchanged)."""
    monkeypatch.chdir(tmp_path)

    real_writer_module = __import__(
        "clawagents.session.persistence", fromlist=["SessionWriter"]
    )
    real_writer = real_writer_module.SessionWriter

    async def _stub_run_agent_graph(
        task,
        llm,
        *,
        session_id=None,
        session_dir=None,
        **kwargs,
    ):
        # No session_id/session_dir passed — writer uses generated id + cwd
        writer = real_writer(session_id=session_id, session_dir=session_dir)
        writer.append("turn_started", {"iteration": 1})
        return AgentState(
            messages=[],
            current_task=task,
            status="done",
            result="ok",
            iterations=1,
            max_iterations=1,
            tool_calls=0,
        )

    import clawagents.graph.agent_loop as _loop_mod

    monkeypatch.setattr(_loop_mod, "run_agent_graph", _stub_run_agent_graph)

    import clawagents.agent as _agent_mod

    monkeypatch.setattr(_agent_mod, "run_agent_graph", _stub_run_agent_graph)

    from clawagents.agent import create_claw_agent

    agent = create_claw_agent(model=None)
    await agent.invoke("hi", max_iterations=1)

    sessions_dir = tmp_path / ".clawagents" / "sessions"
    assert sessions_dir.exists()
    files = list(sessions_dir.glob("session-*.jsonl"))
    assert len(files) >= 1, "expected at least one default-named session file"
