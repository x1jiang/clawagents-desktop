"""REST router exposing runtime-accurate, cached skill previews."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth


router = APIRouter(tags=["skills"], dependencies=[require_auth()])


def _discover_for_root(root: Path, *, include_user_homes: bool = True) -> dict:
    """Return a snapshot loaded through the same SkillStore as chat startup."""
    from clawagents.desktop_stores.skills_catalog import resolve_skill_dirs, scan_skill_catalog
    from clawagents.desktop_stores.settings_store import effective_settings

    try:
        settings = effective_settings(root)
    except Exception:  # noqa: BLE001
        from clawagents.desktop_stores.settings_store import AppSettings

        settings = AppSettings()
    settings.skill_user_homes = bool(include_user_homes) and bool(
        getattr(settings, "skill_user_homes", True)
    )
    settings.skill_auto_discover = True
    folders = resolve_skill_dirs(settings, project_root=root)
    paths = [entry["path"] for entry in folders]
    skills, unavailable, warnings, quarantined = scan_skill_catalog(paths)
    origins = {entry["path"]: entry.get("origin", "auto") for entry in folders}
    for skill in skills:
        source = skill["source_dir"]
        skill["origin"] = origins.get(source, "auto")
        try:
            skill["source_dir"] = str(Path(source).relative_to(root))
        except ValueError:
            pass
        try:
            skill["path"] = str(Path(skill["path"]).relative_to(root))
        except ValueError:
            pass
    return {
        "skills": skills,
        "unavailable": unavailable,
        "quarantined": quarantined,
        "warnings": warnings,
    }


@router.get("/skills/discovered")
def get_skills_discovered(
    project_id: str | None = Query(default=None),
    include_user_homes: bool = Query(default=False),
) -> dict:
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
    return {"root": str(root), **_discover_for_root(root, include_user_homes=include_user_homes)}
