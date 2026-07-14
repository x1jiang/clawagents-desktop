"""Skill folder resolution for desktop (VS Code parity).

Loads project-registered dirs, personal skill homes (~/.codex/skills etc.),
and optional auto-discovery under the active project root.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

_AUTO_NAMES = (
    "skills",
    ".skills",
    "skill",
    ".skill",
    "Skills",
    ".agents/skills",
    ".agent/skills",
    ".cursor/skills",
)
# Ordered lowest→highest precedence (later dirs win name collisions).
_USER_SKILL_HOMES = (
    "~/.codex/skills",
    "~/.claude/skills",
    "~/.agents/skills",
    "~/.clawagents/skills",
)


def _norm(raw: str) -> Path | None:
    text = (raw or "").strip()
    if not text:
        return None
    path = Path(text).expanduser()
    if not path.is_absolute():
        return None
    path = path.resolve()
    return path if path.is_dir() else None


def resolve_skill_dirs(
    settings: Any,
    *,
    project_root: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Return skill roots with origin metadata."""
    ignore: set[str] = set()
    for raw in getattr(settings, "skill_ignore_dirs", None) or []:
        if isinstance(raw, str):
            p = _norm(raw)
            if p is not None:
                ignore.add(str(p))

    seen: set[str] = set()
    entries: list[dict[str, Any]] = []

    def _add(path: Path, origin: str) -> None:
        key = str(path)
        if key in seen or key in ignore:
            return
        seen.add(key)
        entries.append({"path": key, "origin": origin})

    for raw in getattr(settings, "skill_dirs", None) or []:
        if isinstance(raw, str):
            p = _norm(raw)
            if p is not None:
                _add(p, "registered")

    if getattr(settings, "skill_user_homes", True):
        for home in _USER_SKILL_HOMES:
            p = _norm(home)
            if p is not None:
                _add(p, "user_home")

    if getattr(settings, "skill_auto_discover", True) and project_root:
        root = Path(project_root).expanduser().resolve()
        if root.is_dir():
            for name in _AUTO_NAMES:
                candidate = root / name
                if candidate.is_dir():
                    _add(candidate.resolve(), "auto")

    return entries


def resolve_skill_dir_paths(
    settings: Any,
    *,
    project_root: str | Path | None = None,
) -> list[str]:
    return [e["path"] for e in resolve_skill_dirs(settings, project_root=project_root)]
