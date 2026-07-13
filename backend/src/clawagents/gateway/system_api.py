"""macOS-only convenience: reveal a folder in Finder.

We restrict the allowed targets to two roots — the app-support dir and any
of the user's registered project roots — so this endpoint can't be coaxed
into opening an arbitrary path from the network.
"""

from __future__ import annotations

import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.desktop_stores.app_paths import (
    app_support_dir,
    user_commands_dir,
    user_templates_dir,
)
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["system"], dependencies=[require_auth()])


class RevealBody(BaseModel):
    path: str


def _allowed_paths() -> list[Path]:
    out = [app_support_dir().resolve()]
    for p in ProjectStore().list():
        # SSH projects point at remote paths — never resolve them on this host.
        if (p.kind or "local") == "ssh":
            continue
        try:
            out.append(Path(p.root_path).resolve())
        except OSError:
            continue
    return out




@router.post("/system/reveal-folder")
def reveal_folder(body: RevealBody) -> dict:
    """Open a folder in Finder. Refuses anything outside an allow-listed root."""
    try:
        target = Path(body.path).resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"bad path: {exc}")
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="not a directory on disk")

    allowed = _allowed_paths()
    if not any(target == root or root in target.parents for root in allowed):
        raise HTTPException(status_code=403, detail="path not in any allowed root")

    if platform.system() != "Darwin":
        # Other platforms could use `xdg-open` / `explorer.exe`; punt for now.
        raise HTTPException(status_code=501, detail="reveal is macOS-only")

    try:
        subprocess.Popen(["open", str(target)])  # fire-and-forget
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=500, detail=f"open failed: {exc}")
    return {"ok": True, "path": str(target)}


_WELL_KNOWN = {
    "app-support": app_support_dir,
    "commands": user_commands_dir,
    "templates": user_templates_dir,
}


class RevealWellKnownBody(BaseModel):
    name: str  # one of _WELL_KNOWN keys


@router.post("/system/reveal-well-known")
def reveal_well_known(body: RevealWellKnownBody) -> dict:
    """Reveal a named directory (app-support / commands / templates).

    Saves the UI from composing absolute paths — and side-steps the chance
    of the user typing a path that's outside the allow-list. The named
    directories are created on demand so first-time clicks don't 404.
    """
    fn = _WELL_KNOWN.get(body.name)
    if fn is None:
        raise HTTPException(status_code=400, detail=f"unknown name: {body.name}")
    target = fn()
    target.mkdir(parents=True, exist_ok=True)
    if platform.system() != "Darwin":
        raise HTTPException(status_code=501, detail="reveal is macOS-only")
    try:
        subprocess.Popen(["open", str(target)])
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(status_code=500, detail=f"open failed: {exc}")
    return {"ok": True, "path": str(target)}
