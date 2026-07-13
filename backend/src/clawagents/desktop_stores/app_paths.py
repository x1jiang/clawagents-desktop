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


def user_commands_dir() -> Path:
    """Where user-defined slash commands live as `.md` files.

    Each `foo.md` becomes a `/foo` command whose body is sent verbatim to
    the agent. Like Claude Code's custom commands, but discoverable from the
    composer's slash-autocomplete popup.
    """
    return app_support_dir() / "commands"


def user_templates_dir() -> Path:
    """Where chat templates live as `.md` files.

    Each `foo.md` is a seed for a new chat — title + initial message —
    instead of an inline slash command. Useful for starters like
    "Review my recent diff" or "Plan a refactor."
    """
    return app_support_dir() / "templates"


def uploads_dir() -> Path:
    """Where chat-scoped uploaded attachments are stored."""
    return app_support_dir() / "uploads"
