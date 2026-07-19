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

Ported fix (parity audit, upstream clawagents_py/tests/conftest.py):
`memory_dream` and `smart_memory` default ON and write session logs /
MEMORY.md under `<cwd>/.clawagents` -- under pytest that's the repo checkout.
Left enabled, the dream time-gate (4h) can open mid-suite and fire dream
consolidation inside whatever test happens to be running at that moment,
touching `.clawagents/` state shared with hunk/rewind tests -- making
failures time- and order-dependent (e.g. green standalone, red only inside
the full suite). Hard-set (not setdefault) so an ambient shell export can't
reintroduce the nondeterminism. Deliberately NOT porting clawagents_py's
CLAWAGENTS_SKIP_DOTENV / placeholder-key hermeticity, which conflicts with
desktop's own _preload_env_file below -- desktop's suite intentionally reads
the real `.env` for some tests.
"""

from __future__ import annotations

import os

import pytest

os.environ["CLAW_FEATURE_MEMORY_DREAM"] = "0"
os.environ["CLAW_FEATURE_SMART_MEMORY"] = "0"


@pytest.fixture(scope="session", autouse=True)
def _preload_env_file():
    """Force `.env` discovery before any test can chdir away from project cwd."""
    from clawagents.config.config import _discover_env_file
    _discover_env_file()
