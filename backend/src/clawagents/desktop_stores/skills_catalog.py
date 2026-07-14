"""Skill folder resolution for desktop (VS Code parity).

Loads project-registered dirs, personal skill homes (~/.codex/skills etc.),
and optional auto-discovery under the active project root.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import os
import threading
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

_ScanResult = tuple[list[dict[str, Any]], dict[str, str], list[str], dict[str, str]]
_scan_cache_lock = threading.RLock()
_scan_cache: dict[tuple[str, ...], tuple[str, _ScanResult]] = {}
_skill_file_digests: dict[
    tuple[str, ...], dict[str, tuple[int, int, int, str]]
] = {}


def clear_skill_catalog_cache() -> None:
    with _scan_cache_lock:
        _scan_cache.clear()
        _skill_file_digests.clear()


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(128 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _catalog_fingerprint(
    dirs: list[str],
    file_digests: dict[str, tuple[int, int, int, str]],
) -> tuple[str, dict[str, tuple[int, int, int, str]]]:
    catalog = hashlib.sha256()
    seen: set[str] = set()
    for raw in dirs:
        root = Path(raw).resolve()
        catalog.update(f"root\0{root}\0".encode("utf-8", "surrogatepass"))
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames.sort()
            for filename in sorted(filenames):
                if not filename.lower().endswith(".md"):
                    continue
                path = Path(dirpath) / filename
                key = str(path.resolve())
                try:
                    stat = path.stat()
                except OSError:
                    continue
                seen.add(key)
                metadata = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
                cached = file_digests.get(key)
                if cached and cached[:3] == metadata:
                    file_digest = cached[3]
                else:
                    try:
                        file_digest = _hash_file(path)
                    except OSError:
                        continue
                    file_digests[key] = (*metadata, file_digest)
                catalog.update(key.encode("utf-8", "surrogatepass"))
                catalog.update(b"\0")
                catalog.update(file_digest.encode("ascii"))
                catalog.update(b"\0")
    for stale in [path for path in file_digests if path not in seen]:
        file_digests.pop(stale, None)
    return catalog.hexdigest(), file_digests


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


def scan_skill_catalog(dirs: list[str]) -> _ScanResult:
    """Load a reusable catalog through the same SkillStore as agent startup."""
    if not dirs:
        return [], {}, [], {}
    cache_key = tuple(str(Path(directory).resolve()) for directory in dirs)
    with _scan_cache_lock:
        file_digests = dict(_skill_file_digests.get(cache_key, {}))
    fingerprint, file_digests = _catalog_fingerprint(dirs, file_digests)
    with _scan_cache_lock:
        _skill_file_digests[cache_key] = file_digests
        cached = _scan_cache.get(cache_key)
        if cached and cached[0] == fingerprint:
            return copy.deepcopy(cached[1])

    from clawagents.tools.skills import SkillStore

    store = SkillStore()
    for directory in dirs:
        store.add_directory(directory)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(store.load_all())
    else:
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(asyncio.run, store.load_all()).result()

    roots = [Path(directory).resolve() for directory in dirs]
    skills: list[dict[str, Any]] = []
    for skill in store.list():
        skill_path = str(getattr(skill, "path", "") or "")
        source_dir = ""
        try:
            resolved = Path(skill_path).resolve()
            for root in roots:
                try:
                    resolved.relative_to(root)
                    source_dir = str(root)
                    break
                except ValueError:
                    continue
        except OSError:
            pass
        skills.append({
            "name": skill.name,
            "description": (skill.description or "").strip(),
            "path": skill_path,
            "source_dir": source_dir,
        })
    skills.sort(key=lambda item: item["name"].lower())
    result: _ScanResult = (
        skills,
        dict(store.ineligible),
        list(store.warnings),
        dict(store.quarantined),
    )
    with _scan_cache_lock:
        _scan_cache[cache_key] = (fingerprint, copy.deepcopy(result))
    return result
