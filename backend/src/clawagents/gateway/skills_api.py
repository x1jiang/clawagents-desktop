"""REST router for skill discovery, workshop review, and marketplace install."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.desktop_stores.settings_store import SettingsStore, effective_settings, settings_store_lock
from clawagents.gateway.desktop_router import require_auth


router = APIRouter(tags=["skills"], dependencies=[require_auth()])


def _project_root(project_id: str | None) -> Path:
    if project_id:
        try:
            project = ProjectStore().get(project_id)
        except ProjectNotFoundError as exc:
            raise HTTPException(status_code=404, detail=f"project {project_id} not found") from exc
        root = Path(project.root_path).expanduser()
    else:
        root = Path(os.getcwd())
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"root {root} is not a directory")
    return root.resolve()


def _settings_for_root(root: Path):
    try:
        return effective_settings(root)
    except Exception:  # noqa: BLE001
        from clawagents.desktop_stores.settings_store import AppSettings

        return AppSettings()


def _discover_for_root(root: Path, *, include_user_homes: bool | None = None) -> dict[str, Any]:
    """Return a VS Code–shaped skills preview for Settings + project panels."""
    from clawagents.desktop_stores.skills_catalog import (
        clear_skill_catalog_cache,
        resolve_skill_dirs,
        scan_skill_catalog,
    )

    settings = _settings_for_root(root)
    if include_user_homes is not None:
        settings.skill_user_homes = bool(include_user_homes)
    folders = resolve_skill_dirs(settings, project_root=root)
    paths = [entry["path"] for entry in folders]
    clear_skill_catalog_cache()
    skills, unavailable, warnings, quarantined = scan_skill_catalog(paths)
    origins = {entry["path"]: entry.get("origin", "auto") for entry in folders}
    excluded = [
        str(x).strip()
        for x in (getattr(settings, "skill_exclude", None) or [])
        if str(x).strip()
    ]
    excluded_set = {name.lower() for name in excluded}
    for skill in skills:
        source = skill["source_dir"]
        skill["origin"] = origins.get(source, "auto")
        skill["excluded"] = skill["name"].lower() in excluded_set
        try:
            skill["source_dir"] = str(Path(source).relative_to(root))
        except ValueError:
            pass
        try:
            skill["path"] = str(Path(skill["path"]).relative_to(root))
        except ValueError:
            pass

    folder_rows: list[dict[str, str]] = []
    for entry in folders:
        path = str(entry["path"])
        try:
            display = str(Path(path).relative_to(root))
        except ValueError:
            display = path
        folder_rows.append({
            "path": path,
            "display": display,
            "origin": str(entry.get("origin") or "auto"),
        })

    return {
        "root": str(root),
        "folders": folder_rows,
        "skills": skills,
        "excluded": excluded,
        "ignored_dirs": list(getattr(settings, "skill_ignore_dirs", None) or []),
        "auto_discover": bool(getattr(settings, "skill_auto_discover", True)),
        "skill_user_homes": bool(getattr(settings, "skill_user_homes", True)),
        "allow_external_skill_dirs": bool(
            getattr(settings, "allow_external_skill_dirs", False)
        ),
        "unavailable": unavailable,
        "quarantined": quarantined,
        "warnings": warnings,
    }


@router.get("/skills/discovered")
def get_skills_discovered(
    project_id: str | None = Query(default=None),
    include_user_homes: bool | None = Query(default=None),
) -> dict:
    root = _project_root(project_id)
    # Preserve prior default (False) when caller omits the query flag.
    homes = False if include_user_homes is None else bool(include_user_homes)
    return _discover_for_root(root, include_user_homes=homes)


@router.get("/skills")
def get_skills_preview(
    project_id: str | None = Query(default=None),
    include_user_homes: bool | None = Query(default=None),
) -> dict:
    """VS Code–parity skills preview (folders + exclusions + catalog)."""
    root = _project_root(project_id)
    return _discover_for_root(root, include_user_homes=include_user_homes)


class SkillExcludeBody(BaseModel):
    project_id: str | None = None
    name: str
    exclude: bool = True


@router.post("/skills/exclude")
def set_skill_exclude(body: SkillExcludeBody) -> dict:
    """Add/remove a skill name from settings.skill_exclude (project-scoped when possible)."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    root = _project_root(body.project_id) if body.project_id else None
    with settings_store_lock:
        store = SettingsStore()
        settings = store.load()
        current = [
            str(x).strip()
            for x in (settings.skill_exclude or [])
            if str(x).strip()
        ]
        lower = {n.lower() for n in current}
        key = name.lower()
        if body.exclude:
            if key not in lower:
                current.append(name)
        else:
            current = [n for n in current if n.lower() != key]
        settings.skill_exclude = current
        store.save(settings)
    payload = _discover_for_root(root) if root else {"excluded": current}
    return {"ok": True, "excluded": current, **({} if root is None else payload)}


# ── Skill workshop ───────────────────────────────────────────────────────


def _workshop(root: Path):
    from clawagents.skills.workshop.service import SkillWorkshopService

    return SkillWorkshopService(root)


def _safe_proposal_id(proposal_id: str) -> str:
    pid = (proposal_id or "").strip()
    if not pid or ".." in pid or "/" in pid or "\\" in pid:
        raise HTTPException(status_code=400, detail="invalid proposal_id")
    return pid


@router.get("/skills/workshop")
def list_workshop(project_id: str | None = Query(default=None)) -> dict:
    root = _project_root(project_id)
    rows = _workshop(root).list()
    return {"ok": True, "workspace": str(root), "proposals": rows}


@router.get("/skills/workshop/{proposal_id}")
def inspect_workshop(proposal_id: str, project_id: str | None = Query(default=None)) -> dict:
    root = _project_root(project_id)
    out = _workshop(root).inspect(_safe_proposal_id(proposal_id))
    if out.get("error") == "not found":
        raise HTTPException(status_code=404, detail="proposal not found")
    return {"ok": True, "workspace": str(root), **out}


class WorkshopActionBody(BaseModel):
    project_id: str | None = None
    reason: str = ""


@router.post("/skills/workshop/{proposal_id}/apply")
def apply_workshop(proposal_id: str, body: WorkshopActionBody | None = None) -> dict:
    root = _project_root((body.project_id if body else None))
    from clawagents.desktop_stores.skills_catalog import clear_skill_catalog_cache

    out = _workshop(root).apply(_safe_proposal_id(proposal_id))
    if out.get("ok"):
        clear_skill_catalog_cache()
    return out


@router.post("/skills/workshop/{proposal_id}/reject")
def reject_workshop(proposal_id: str, body: WorkshopActionBody | None = None) -> dict:
    root = _project_root((body.project_id if body else None))
    reason = body.reason if body else ""
    return _workshop(root).reject(_safe_proposal_id(proposal_id), reason=reason)


@router.post("/skills/workshop/{proposal_id}/quarantine")
def quarantine_workshop(proposal_id: str, body: WorkshopActionBody | None = None) -> dict:
    root = _project_root((body.project_id if body else None))
    reason = body.reason if body else ""
    return _workshop(root).quarantine(_safe_proposal_id(proposal_id), reason=reason)


class WorkshopRollbackBody(BaseModel):
    project_id: str | None = None
    rollback_id: str


@router.post("/skills/workshop/rollback")
def rollback_workshop(body: WorkshopRollbackBody) -> dict:
    root = _project_root(body.project_id)
    from clawagents.desktop_stores.skills_catalog import clear_skill_catalog_cache

    out = _workshop(root).rollback(body.rollback_id)
    if out.get("ok"):
        clear_skill_catalog_cache()
    return out


# ── Marketplace ──────────────────────────────────────────────────────────


@router.get("/skills/marketplace")
def list_marketplace(project_id: str | None = Query(default=None)) -> dict:
    root = _project_root(project_id)
    from clawagents.marketplace import list_installed

    return {"ok": True, "workspace": str(root), "packages": list_installed(root)}


class MarketplaceInstallBody(BaseModel):
    project_id: str | None = None
    source: str = Field(..., min_length=1)
    kind: str = "skill"  # skill | plugin


@router.post("/skills/marketplace/install")
def install_marketplace(body: MarketplaceInstallBody) -> dict:
    root = _project_root(body.project_id)
    from clawagents.desktop_stores.skills_catalog import clear_skill_catalog_cache
    from clawagents.marketplace import install_from_source

    kind = body.kind if body.kind in ("skill", "plugin") else "skill"
    result = install_from_source(body.source.strip(), workspace=root, kind=kind)
    payload = result.to_dict() if hasattr(result, "to_dict") else dict(result)
    if payload.get("ok"):
        clear_skill_catalog_cache()
    return {"ok": bool(payload.get("ok")), **payload}
