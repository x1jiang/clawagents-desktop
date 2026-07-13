"""Diagnostics endpoint — what's the gateway running and where is its data?

Returns version info, Python info, app-support paths, and counts of stored
artifacts. No secrets — every value is safe to surface in the UI.
"""

from __future__ import annotations

import os
import platform
import shutil
import sys
from pathlib import Path

from fastapi import APIRouter

from clawagents.desktop_stores.app_paths import (
    app_support_dir,
    projectless_chats_dir,
    projects_file,
    user_commands_dir,
    user_templates_dir,
)
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["diagnostics"], dependencies=[require_auth()])


def _backend_version() -> str:
    try:
        from importlib.metadata import version as _v
        return _v("clawagents-desktop-backend")
    except Exception:  # noqa: BLE001
        return "unknown"


def _count(glob_iter) -> int:
    try:
        return sum(1 for _ in glob_iter)
    except OSError:
        return 0


@router.get("/diagnostics")
def diagnostics() -> dict:
    projects = ProjectStore().list()
    pl_chats = projectless_chats_dir()
    pl_count = _count(pl_chats.glob("*.jsonl")) if pl_chats.exists() else 0
    project_chat_count = 0
    for p in projects:
        sd = Path(p.root_path) / ".clawagents" / "sessions"
        if sd.exists():
            project_chat_count += _count(sd.glob("*.jsonl"))

    cd = user_commands_dir()
    td = user_templates_dir()
    commands_count = _count(cd.glob("*.md")) if cd.exists() else 0
    templates_count = _count(td.glob("*.md")) if td.exists() else 0

    return {
        "backend_version": _backend_version(),
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "host": platform.node(),
        "app_support_dir": str(app_support_dir()),
        "projects_file": str(projects_file()),
        "counts": {
            "projects": len(projects),
            "projectless_chats": pl_count,
            "project_chats": project_chat_count,
            "custom_commands": commands_count,
            "chat_templates": templates_count,
        },
        "providers_with_env_keys": [
            name for name, env in (
                ("openai", "OPENAI_API_KEY"),
                ("anthropic", "ANTHROPIC_API_KEY"),
                ("gemini", "GEMINI_API_KEY"),
            ) if os.environ.get(env)
        ],
        # Whether common external binaries the bundled skills shell out to
        # are present. Useful for diagnosing "agent reinvented a slow Python
        # parser" symptoms when pandoc is missing.
        "external_tools": {
            name: bool(shutil.which(name))
            for name in (
                "pandoc",
                "git",
                "python3",
                "node",
                "ffmpeg",
                "pdftotext",
                "pdftoppm",
                "tesseract",
            )
        },
    }
