"""Regression: PermissionEngine's declarative "ask" tier (the .env write
rule from clawagents.security.secret_paths) must not be permanently denied,
and "auto" mode must not silently auto-allow secret-shaped writes.

Two independent gates run per write-class tool call:
  1. evaluate_tool_permission() + permission_callback (registry.py) --
     desktop's own mode-aware, SSE-backed approval flow.
  2. PermissionEngine.gate() (registry.py) -- a separate declarative rule
     set whose "ask" tier calls ask_handler synchronously and, left unset,
     always denies regardless of what gate (1) already decided.

Before the fix: run_chat_turn never wired PermissionEngine.ask_handler, so
a .env write approved by full_access/auto mode (or an explicit user Allow)
was still refused by gate (2) with "Permission ask required for write_file".
"""

from __future__ import annotations

from pathlib import Path

import pytest

import clawagents.gateway.chats_api as chats_api
from clawagents.tools.permissions import load_permission_engine


@pytest.fixture(autouse=True)
def _permission_rules_enabled(monkeypatch: pytest.MonkeyPatch):
    """This suite's ambient workspace .env sets CLAW_FEATURE_PERMISSION_RULES=0
    (a dev-machine default, not a test-hermeticity choice), which makes
    load_permission_engine() return an empty, rule-less engine -- everything
    defaults to "allow" and the bug this file tests for can't be observed.
    Force the flag on for these tests regardless of ambient .env state."""
    from clawagents.config import features as feat

    monkeypatch.setenv("CLAW_FEATURE_PERMISSION_RULES", "1")
    feat.reset()
    yield
    feat.reset()


def test_decide_by_mode_auto_falls_through_for_secret_paths(tmp_path: Path) -> None:
    proj = str(tmp_path)
    env_path = str(tmp_path / ".env")
    normal_path = str(tmp_path / "src" / "app.py")

    # Ordinary files: auto mode still auto-allows (unchanged convenience default).
    assert chats_api._decide_by_mode("auto", normal_path, proj) == "allow_once"

    # Secret-shaped files: auto mode now falls through to the grant-store +
    # prompt flow instead of silently auto-allowing.
    assert chats_api._decide_by_mode("auto", env_path, proj) is None


def test_decide_by_mode_full_access_still_auto_allows_secrets(tmp_path: Path) -> None:
    # full_access is an explicit "trust everything" opt-in (unlike auto's
    # convenience default) and must remain unaffected.
    env_path = str(tmp_path / ".env")
    assert chats_api._decide_by_mode("full_access", env_path, str(tmp_path)) == "allow_once"


def test_decide_by_mode_read_only_still_denies(tmp_path: Path) -> None:
    env_path = str(tmp_path / ".env")
    assert chats_api._decide_by_mode("read_only", env_path, str(tmp_path)) == "deny"


def test_permission_engine_env_ask_tier_wired_to_allow():
    """Simulates exactly what run_chat_turn now does after create_claw_agent()."""
    engine = load_permission_engine("/proj")

    # Sanity: without wiring, the ask tier is permanently denied (the bug).
    ok, _ = engine.gate("write_file", {"path": "/proj/.env"})
    assert ok is False

    # After wiring (as chats_api.run_chat_turn now does post-construction):
    engine.ask_handler = lambda tool_name, args, message: True
    ok, msg = engine.gate("write_file", {"path": "/proj/.env"})
    assert ok is True


def test_permission_engine_deny_tier_unaffected_by_ask_handler_wiring():
    """Wiring ask_handler must never weaken deny-tier rules."""
    engine = load_permission_engine("/proj")
    engine.ask_handler = lambda tool_name, args, message: True

    for path in ("/proj/credentials.json", "/proj/secrets.yaml", "/proj/id_rsa"):
        ok, _ = engine.gate("write_file", {"path": path})
        assert ok is False, f"{path} must remain hard-denied"


@pytest.mark.asyncio
async def test_run_chat_turn_wires_ask_handler_and_does_not_set_approval_handler(tmp_path):
    """End-to-end: run_chat_turn must leave agent.approval_handler unset
    (so the unrelated pre-dispatch approval gate in agent_loop.py stays
    dormant) while still wiring PermissionEngine.ask_handler.

    fake_create returns the REAL agent object built by the real
    create_claw_agent() (only its .invoke bound method is stubbed in place),
    and captures that exact object -- the same one run_chat_turn's own code
    (tool registration, permission-engine wiring, invoke()) operates on. A
    separately-constructed decoy object would never observe the wiring.
    """
    from unittest.mock import patch

    from clawagents.agent import create_claw_agent as real_create_claw_agent
    from clawagents.run_result import RunResult

    proj = tmp_path / "p"
    proj.mkdir()
    captured: dict = {}

    def fake_create(**kwargs):
        agent = real_create_claw_agent(workspace=str(proj), model="mock-model")

        async def _stub_invoke(task, *, on_event=None, session_id=None, session_dir=None, **kw):
            return RunResult(status="ok", result="done", iterations=1)

        agent.invoke = _stub_invoke  # bind a stub over the real object, in place
        captured["agent"] = agent
        return agent

    with patch("clawagents.agent.create_claw_agent", side_effect=fake_create):
        await chats_api.run_chat_turn(
            chat_id="chat-env-test",
            content="hi",
            project_root=str(proj),
            mode="full_access",
            model="mock-model",
            on_event=lambda *args: None,
        )

    assert captured, "create_claw_agent must have been called via the patched import site"
    agent = captured["agent"]
    assert agent.approval_handler is None, "Gate 3 (_wait_for_tool_approval) must stay dormant"
    perm_engine = getattr(agent, "_permission_engine", None)
    assert perm_engine is not None
    assert callable(perm_engine.ask_handler), "PermissionEngine.ask_handler must be wired"
    ok, _ = perm_engine.gate("write_file", {"path": str(proj / ".env")})
    assert ok is True
