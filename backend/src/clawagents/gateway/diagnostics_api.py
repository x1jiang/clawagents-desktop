"""Diagnostics endpoint — what's the gateway running and where is its data?

Returns version info, Python info, app-support paths, and counts of stored
artifacts. No secrets — every value is safe to surface in the UI.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from clawagents.desktop_stores.app_paths import (
    app_support_dir,
    projectless_chats_dir,
    projects_file,
    user_commands_dir,
    user_templates_dir,
)
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.desktop_stores.settings_store import SettingsStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["diagnostics"], dependencies=[require_auth()])


def _companion_payloads() -> list[dict]:
    try:
        from clawagents.companions import probe_companions

        return [
            {
                "name": s.name,
                "found": s.found,
                "version": s.version,
                "min_version": s.min_version,
                "ok": s.ok_vs_floor,
                "detail": s.summary(),
                "path": s.path,
                "hint": s.hint,
            }
            for s in probe_companions()
        ]
    except Exception as exc:  # noqa: BLE001
        return [
            {
                "name": "companions",
                "found": False,
                "ok": False,
                "detail": f"probe failed: {exc}",
            }
        ]


class EnsureCompanionsBody(BaseModel):
    force: bool = False


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
                ("bedrock", "BEDROCK_API_KEY"),
            ) if os.environ.get(env)
        ] + (
            ["bedrock"]
            if (
                not os.environ.get("BEDROCK_API_KEY")
                and (
                    (os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"))
                    or os.environ.get("AWS_PROFILE")
                    or os.environ.get("AWS_REGION")
                    or os.environ.get("AWS_DEFAULT_REGION")
                    or os.path.isfile(os.path.expanduser("~/.aws/credentials"))
                )
            )
            else []
        ),
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
                "npm",
                "brew",
                "ffmpeg",
                "pdftotext",
                "pdftoppm",
                "tesseract",
                "context-mode",
                "rtk",
            )
        },
        "companions": _companion_payloads(),
        "ensure_companions": bool(SettingsStore().load().ensure_companions),
    }


def _run_cmd(cmd: list[str], *, timeout: float = 180.0) -> dict:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "cmd": cmd,
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": (proc.stdout or "")[-4000:],
            "stderr": (proc.stderr or "")[-4000:],
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"cmd": cmd, "ok": False, "error": str(exc)}


@router.post("/diagnostics/ensure-companions")
def ensure_companions(body: EnsureCompanionsBody | None = None) -> dict:
    """Best-effort install/upgrade of context-mode + rtk (non-fatal)."""
    force = bool(body.force) if body is not None else False
    settings = SettingsStore().load()
    if not force and not settings.ensure_companions:
        return {
            "ok": False,
            "skipped": True,
            "reason": "ensure_companions=false",
            "companions": _companion_payloads(),
        }

    before = _companion_payloads()
    actions: list[dict] = []
    by_name = {c.get("name"): c for c in before}

    cm = by_name.get("context-mode") or {}
    if force or not cm.get("ok"):
        npm = shutil.which("npm")
        if npm:
            actions.append(_run_cmd([npm, "install", "-g", "context-mode@latest"]))
        else:
            actions.append({"cmd": ["npm"], "ok": False, "error": "npm not found"})

    rtk = by_name.get("rtk") or {}
    if force or not rtk.get("ok"):
        brew = shutil.which("brew")
        if brew:
            # upgrade when present, install when missing
            if rtk.get("found"):
                actions.append(_run_cmd([brew, "upgrade", "rtk"]))
            else:
                actions.append(_run_cmd([brew, "install", "rtk"]))
        else:
            actions.append({"cmd": ["brew"], "ok": False, "error": "brew not found"})

    after = _companion_payloads()
    return {
        "ok": all(c.get("ok") for c in after if c.get("name") in ("context-mode", "rtk")),
        "before": before,
        "after": after,
        "actions": actions,
    }
