"""Top-level test conftest.

Phase 4 fix for cross-test pollution:

`clawagents.config.config._discover_env_file` is a one-shot lazy loader gated
by a module-level `_loaded` flag. It walks up from `Path.cwd()` looking for
a `.env`. If the FIRST call happens while a test has chdir'd into a
`tmp_path`, the loader runs with the wrong cwd, fails to find any `.env`,
and sets `_loaded = True` — permanently disabling discovery for the rest of
the test session.

That permanently strips `OPENAI_API_KEY` (et al.) from the environment, so
later tests that construct an `OpenAIProvider` (which eagerly calls
`AsyncOpenAI(api_key=...)`) crash with "Missing credentials".

Fix: force the loader to run BEFORE any test can chdir away.
"""

from __future__ import annotations

import pytest


@pytest.fixture(scope="session", autouse=True)
def _preload_env_file():
    """Force `.env` discovery before any test can chdir away from project cwd."""
    from clawagents.config.config import _discover_env_file
    _discover_env_file()
