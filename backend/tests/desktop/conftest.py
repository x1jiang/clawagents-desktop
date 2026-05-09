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
