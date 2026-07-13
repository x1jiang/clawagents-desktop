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

from clawagents.agent import _DEFAULT_SKILL_DIRS
from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth
from clawagents.tools.skills import parse_skill_file


router = APIRouter(tags=["skills"], dependencies=[require_auth()])


def _discover_for_root(root: Path) -> list[dict]:
    """Walk the project's default skill dirs and parse each SKILL.md.

    Returns a list of {name, description, source_dir, path} dicts. Skills
    are de-duplicated by name; whichever instance wins is undefined and
    callers shouldn't rely on it (no realistic project ships duplicates).
    """
    out: list[dict] = []
    seen: set[str] = set()
    for d in _DEFAULT_SKILL_DIRS:
        skill_dir = root / d
        if not skill_dir.is_dir():
            continue
        try:
            entries = list(skill_dir.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.name.startswith("."):
                continue
            try:
                if entry.is_dir():
                    skill_md = entry / "SKILL.md"
                    if skill_md.exists():
                        skill = parse_skill_file(skill_md.read_text("utf-8"), str(skill_md))
                    else:
                        continue
                elif entry.suffix == ".md":
                    skill = parse_skill_file(entry.read_text("utf-8"), str(entry))
                else:
                    continue
            except (OSError, UnicodeDecodeError):
                continue
            if skill.name in seen:
                continue
            seen.add(skill.name)
            out.append({
                "name": skill.name,
                "description": skill.description,
                "source_dir": str(skill_dir.relative_to(root)),
                "path": str(Path(skill.path).relative_to(root)) if skill.path.startswith(str(root)) else skill.path,
            })
    return out


@router.get("/skills/discovered")
def get_skills_discovered(project_id: str | None = Query(default=None)) -> dict:
    """List skills auto-discovered for ``project_id`` (or cwd if omitted).

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
    return {"root": str(root), "skills": _discover_for_root(root)}
