"""Backup + restore for the desktop app.

The backup is a single zip with this layout:

    projects.json
    chats/                       # projectless chat JSONLs
        chat-<id>.jsonl
    project_chats/<project_id>/  # per-project chat JSONLs
        chat-<id>.jsonl
    commands/                    # user-defined slash commands
        <name>.md

Restore is "merge": existing chats with the same id are overwritten, but
projects in projects.json are only added if not already present (so the
user doesn't lose grants / settings on the side they're restoring into).
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from clawagents.desktop_stores.app_paths import (
    projectless_chats_dir,
    projects_file,
    user_commands_dir,
)
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["backup"], dependencies=[require_auth()])


def _add_dir(zf: zipfile.ZipFile, src: Path, arc_prefix: str) -> None:
    if not src.exists():
        return
    for path in sorted(src.glob("*.jsonl")):
        zf.write(path, arcname=f"{arc_prefix}/{path.name}")


def _add_commands(zf: zipfile.ZipFile, src: Path) -> None:
    if not src.exists():
        return
    for path in sorted(src.glob("*.md")):
        zf.write(path, arcname=f"commands/{path.name}")


@router.get("/backup/export")
def export_backup() -> StreamingResponse:
    """Bundle projects.json + every chat JSONL + user commands into a zip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        pf = projects_file()
        if pf.exists():
            zf.write(pf, arcname="projects.json")
        _add_dir(zf, projectless_chats_dir(), "chats")
        for project in ProjectStore().list():
            project_sessions = Path(project.root_path) / ".clawagents" / "sessions"
            _add_dir(zf, project_sessions, f"project_chats/{project.id}")
        _add_commands(zf, user_commands_dir())
    buf.seek(0)

    def gen():
        yield buf.getvalue()

    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return StreamingResponse(
        gen(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="clawagents-backup-{stamp}.zip"',
        },
    )


@router.post("/backup/import")
async def import_backup(file: UploadFile = File(...)) -> dict:
    """Restore from a previously-exported zip. Merges into existing state.

    For each entry in the archive:
      - projects.json: missing projects are added to the local store. Existing
        ids are left alone (so the local copy stays authoritative for any
        edits made since the backup).
      - chats/*.jsonl: overwrite same-id projectless chats.
      - project_chats/<id>/*.jsonl: overwrite same-id chats inside whichever
        project root the local store has for that id. Project entries that
        don't exist locally are skipped (their chats would have no home).
      - commands/*.md: overwrite same-name custom commands.
    """
    data = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="not a valid zip file")

    counts = {"projects_added": 0, "chats_restored": 0, "commands_restored": 0}

    # ── projects.json merge ────────────────────────────────────────────────
    try:
        with zf.open("projects.json") as pj:
            archived = json.loads(pj.read().decode("utf-8") or "[]")
        store = ProjectStore()
        existing_ids = {p.id for p in store._load()}  # noqa: SLF001
        for entry in archived:
            if not isinstance(entry, dict):
                continue
            if entry.get("id") in existing_ids:
                continue
            # Only restore projects whose root still exists, to avoid
            # littering the store with dead paths.
            root = entry.get("root_path", "")
            if not root or not Path(root).exists():
                continue
            from clawagents.desktop_stores.project_store import Project
            projects = store._load()  # noqa: SLF001
            projects.append(Project(**entry))
            store._save(projects)  # noqa: SLF001
            counts["projects_added"] += 1
    except KeyError:
        pass  # no projects.json in archive

    # ── projectless chats ──────────────────────────────────────────────────
    pl_dir = projectless_chats_dir()
    pl_dir.mkdir(parents=True, exist_ok=True)
    for name in zf.namelist():
        if name.startswith("chats/") and name.endswith(".jsonl"):
            target = pl_dir / Path(name).name
            with zf.open(name) as src:
                target.write_bytes(src.read())
            counts["chats_restored"] += 1

    # ── project chats ──────────────────────────────────────────────────────
    by_id = {p.id: p for p in ProjectStore().list()}
    for name in zf.namelist():
        if not name.startswith("project_chats/") or not name.endswith(".jsonl"):
            continue
        parts = name.split("/")
        if len(parts) < 3:
            continue
        pid = parts[1]
        project = by_id.get(pid)
        if project is None:
            continue
        sessions_dir = Path(project.root_path) / ".clawagents" / "sessions"
        sessions_dir.mkdir(parents=True, exist_ok=True)
        target = sessions_dir / parts[2]
        with zf.open(name) as src:
            target.write_bytes(src.read())
        counts["chats_restored"] += 1

    # ── custom commands ────────────────────────────────────────────────────
    cd = user_commands_dir()
    cd.mkdir(parents=True, exist_ok=True)
    for name in zf.namelist():
        if name.startswith("commands/") and name.endswith(".md"):
            target = cd / Path(name).name
            with zf.open(name) as src:
                target.write_bytes(src.read())
            counts["commands_restored"] += 1

    return {"ok": True, **counts}
