"""Resolve macOS Application Support paths for ClawAgents Desktop.

Tests override the base path via the ``CLAWAGENTS_DESKTOP_APP_SUPPORT`` env var.
"""

from __future__ import annotations

import os
from pathlib import Path


def app_support_dir() -> Path:
    override = os.environ.get("CLAWAGENTS_DESKTOP_APP_SUPPORT")
    if override:
        return Path(override)
    return Path.home() / "Library" / "Application Support" / "ClawAgentsDesktop"


def projects_file() -> Path:
    return app_support_dir() / "projects.json"


def settings_file() -> Path:
    return app_support_dir() / "settings.json"


def permissions_file() -> Path:
    return app_support_dir() / "permissions.json"


def projectless_chats_dir() -> Path:
    return app_support_dir() / "chats"


def projectless_scratch_dir() -> Path:
    return app_support_dir() / "scratch"
