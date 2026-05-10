"""Shared fixtures for desktop-feature tests.

Overrides the app-support directory so each test gets a clean slate
without touching the user's real ~/Library/Application Support/.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def app_support_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "ClawAgentsDesktop"
    target.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CLAWAGENTS_DESKTOP_APP_SUPPORT", str(target))
    return target


@pytest.fixture()
def project_root(tmp_path: Path) -> Path:
    """A throwaway directory that stands in for a user's project folder."""
    root = tmp_path / "myproject"
    root.mkdir()
    return root


@pytest.fixture(autouse=True)
def _reset_chats_api_state():
    """Reset chats_api module-level state between tests.

    Task 3 of Phase 3 introduced `_chat_locks` and `_chdir_lock` at module
    scope. asyncio.Lock instances bind to the event loop on first await,
    and pytest creates a new loop per test. Without this fixture, locks
    leaked from one test's loop break tests in subsequent loops.

    Additionally, tests that use concurrent ``with patch(...)`` inside
    ``asyncio.gather()`` can leave ``clawagents.agent.create_claw_agent``
    pointing at a stale MagicMock because the concurrent patch context-
    managers interleave and one teardown restores to the wrong value.
    Saving the real function before each test and restoring it after
    prevents that cross-test leak.
    """
    import asyncio
    import clawagents.gateway.chats_api as chats_api
    import clawagents.agent as agent_mod

    # Save real create_claw_agent before the test can corrupt it
    real_create_claw_agent = agent_mod.create_claw_agent

    chats_api._chat_locks.clear()
    chats_api._cancel_events.clear()
    chats_api._chdir_lock = asyncio.Lock()

    yield

    chats_api._chat_locks.clear()
    chats_api._cancel_events.clear()
    chats_api._chdir_lock = asyncio.Lock()

    # Restore create_claw_agent in case concurrent patching left a mock behind
    agent_mod.create_claw_agent = real_create_claw_agent
