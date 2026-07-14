"""REST router exposing skills discovered for a given project root.

Skill auto-discovery normally happens at agent boot time and is invisible
to the UI. This endpoint walks the same default skill directories (the
ones listed in ``clawagents.agent._DEFAULT_SKILL_DIRS``) for a given
project, parses each ``SKILL.md`` frontmatter, and returns a JSON list.
The UI uses it to show "what does this project come with?" so the user
knows the agent has document-parsing, PDF, etc. skills available.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth
from clawagents.tools.skills import parse_skill_file


router = APIRouter(tags=["skills"], dependencies=[require_auth()])


def _discover_for_root(root: Path, *, include_user_homes: bool = True) -> list[dict]:
    """Walk project skill dirs + optional personal homes; parse each SKILL.md."""
    from clawagents.desktop_stores.skills_catalog import resolve_skill_dirs
    from clawagents.desktop_stores.settings_store import SettingsStore

    try:
        settings = SettingsStore().load()
    except Exception:  # noqa: BLE001
        from clawagents.desktop_stores.settings_store import AppSettings
        settings = AppSettings()
    # Endpoint may override user-homes independently of persisted settings
    # (project panel wants a clean project view when include_user_homes=False).
    settings.skill_user_homes = bool(include_user_homes) and bool(
        getattr(settings, "skill_user_homes", True)
    )
    settings.skill_auto_discover = True
    dirs = resolve_skill_dirs(settings, project_root=root)

    out: list[dict] = []
    seen: set[str] = set()
    for entry in dirs:
        skill_dir = Path(entry["path"])
        origin = entry.get("origin", "auto")
        if not skill_dir.is_dir():
            continue
        try:
            entries = list(skill_dir.iterdir())
        except OSError:
            continue
        for item in entries:
            if item.name.startswith("."):
                continue
            try:
                if item.is_dir():
                    skill_md = item / "SKILL.md"
                    if skill_md.exists():
                        skill = parse_skill_file(skill_md.read_text("utf-8"), str(skill_md))
                    else:
                        continue
                elif item.suffix == ".md":
                    skill = parse_skill_file(item.read_text("utf-8"), str(item))
                else:
                    continue
            except (OSError, UnicodeDecodeError):
                continue
            if skill.name in seen:
                continue
            seen.add(skill.name)
            try:
                rel_source = str(skill_dir.relative_to(root))
            except ValueError:
                rel_source = str(skill_dir)
            try:
                rel_path = str(Path(skill.path).relative_to(root)) if skill.path.startswith(str(root)) else skill.path
            except Exception:  # noqa: BLE001
                rel_path = skill.path
            out.append({
                "name": skill.name,
                "description": skill.description,
                "source_dir": rel_source,
                "path": rel_path,
                "origin": origin,
            })
    return out


@router.get("/skills/discovered")
def get_skills_discovered(
    project_id: str | None = Query(default=None),
    include_user_homes: bool = Query(default=False),
) -> dict:
    """List skills auto-discovered for ``project_id`` (or cwd if omitted).

    Personal skill homes are off by default for this listing (project panel
    clarity); chat turns still load them via settings.skill_user_homes.
    Response: ``{"root": "/abs/path", "skills": [...]}``.
    """
    if project_id:
        try:
            project = ProjectStore().get(project_id)
        except ProjectNotFoundError:
            raise HTTPException(status_code=404, detail=f"project {project_id} not found")
        root = Path(project.root_path)
    else:
        root = Path(os.getcwd())
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"root {root} is not a directory")
    return {
        "root": str(root),
        "skills": _discover_for_root(root, include_user_homes=include_user_homes),
    }
