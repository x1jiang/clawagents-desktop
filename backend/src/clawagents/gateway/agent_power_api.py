"""Checkpoints, file snapshots, MCP listing, and ask_user HITL endpoints."""

from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.desktop_stores.settings_store import SettingsStore, effective_settings
from clawagents.gateway.desktop_router import require_auth
from clawagents.gateway.mcp_loader import context_mode_available, list_mcp_config

router = APIRouter(tags=["agent-power"], dependencies=[require_auth()])

# ── ask_user waiters (async, event-loop safe) ────────────────────────────

_ask_waiters: dict[str, asyncio.Future[str | None]] = {}


def create_ask_request() -> str:
    request_id = uuid.uuid4().hex
    loop = asyncio.get_running_loop()
    _ask_waiters[request_id] = loop.create_future()
    return request_id


async def wait_ask(request_id: str, timeout: float = 600.0) -> str | None:
    fut = _ask_waiters.get(request_id)
    if fut is None:
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(fut), timeout=timeout)
    except asyncio.TimeoutError:
        resolve_ask(request_id, None)
        return None
    finally:
        _ask_waiters.pop(request_id, None)


def resolve_ask(request_id: str, answer: str | None) -> bool:
    fut = _ask_waiters.get(request_id)
    if fut is None or fut.done():
        return False
    loop = fut.get_loop()
    # ``set_result`` must run on the future's own loop. If we're already on it
    # (async endpoint), set directly; otherwise marshal across threads so the
    # waiting coroutine is actually woken (a bare cross-thread ``set_result``
    # schedules callbacks without waking the loop selector).
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        fut.set_result(answer)
    else:
        loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(answer))
    return True


class AskUserBody(BaseModel):
    answer: str | None = None
    skip: bool = False


@router.post("/ask_user/{request_id}")
def post_ask_user(request_id: str, body: AskUserBody) -> dict:
    answer = None if body.skip else body.answer
    if not resolve_ask(request_id, answer):
        raise HTTPException(status_code=404, detail="unknown or already resolved ask_user request")
    return {"ok": True}


# ── MCP ─────────────────────────────────────────────────────────────────

@router.get("/mcp")
def get_mcp(project_id: str | None = None) -> dict:
    """List configured MCP servers for a project (or home-only if no project)."""
    workspace = Path.home()
    if project_id:
        from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
        try:
            workspace = Path(ProjectStore().get(project_id).root_path)
        except ProjectNotFoundError:
            raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    settings = effective_settings(workspace) if project_id else SettingsStore().load()
    if not project_id:
        settings.mcp_trust_workspace = False
    return {
        "mcp_enabled": settings.mcp_enabled,
        "mcp_trust_workspace": settings.mcp_trust_workspace,
        "context_mode": settings.context_mode,
        "context_mode_available": context_mode_available(),
        "servers": list_mcp_config(
            workspace,
            trust_workspace=bool(settings.mcp_trust_workspace),
        ),
    }


# ── Helpers for chat-scoped workspace ───────────────────────────────────

def _workspace_for_chat(chat_id: str) -> tuple[Path, Path]:
    """Return (workspace_root, session_jsonl_path)."""
    from clawagents.gateway.chats_api import _resolve_chat, _resolve_root_for_chat

    path, _ = _resolve_chat(chat_id)
    root, _ = _resolve_root_for_chat(chat_id)
    return Path(root), path


# ── Checkpoints ──────────────────────────────────────────────────────────

@router.get("/chats/{chat_id}/checkpoints")
def list_chat_checkpoints(chat_id: str, limit: int = 30) -> list[dict[str, Any]]:
    workspace, _ = _workspace_for_chat(chat_id)
    try:
        from clawagents.memory.shadow_checkpoint import list_checkpoints
        return list_checkpoints(workspace=str(workspace), limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class CheckpointRestoreBody(BaseModel):
    sha: str
    mode: Literal["files", "conversation", "both"] = "files"


@router.post("/chats/{chat_id}/checkpoints/restore")
def restore_chat_checkpoint(chat_id: str, body: CheckpointRestoreBody) -> dict[str, Any]:
    workspace, session_path = _workspace_for_chat(chat_id)
    try:
        from clawagents.memory.shadow_checkpoint import restore_checkpoint
        return restore_checkpoint(
            body.sha,
            workspace=str(workspace),
            mode=body.mode,
            session_path=session_path,
            chat_ui_path=None,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/chats/{chat_id}/checkpoints/diff")
def diff_chat_checkpoint(chat_id: str, lhs: str, rhs: str | None = None) -> dict[str, Any]:
    workspace, _ = _workspace_for_chat(chat_id)
    try:
        from clawagents.memory.shadow_checkpoint import checkpoint_diff
        return checkpoint_diff(lhs, rhs, workspace=str(workspace))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── File snapshots ───────────────────────────────────────────────────────

def _snapshots_dir(workspace: Path) -> Path:
    return workspace / ".clawagents" / "snapshots"


@router.get("/chats/{chat_id}/snapshots")
def list_chat_snapshots(chat_id: str, limit: int = 50) -> list[dict[str, Any]]:
    workspace, _ = _workspace_for_chat(chat_id)
    snap_root = _snapshots_dir(workspace)
    if not snap_root.exists():
        return []
    dirs = sorted(
        [p for p in snap_root.iterdir() if p.is_dir()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    out: list[dict[str, Any]] = []
    for d in dirs[:limit]:
        files = [
            str(f.relative_to(d))
            for f in d.rglob("*")
            if f.is_file()
        ][:100]
        out.append({
            "id": d.name,
            "path": str(d),
            "mtime": d.stat().st_mtime,
            "files": files,
        })
    return out


class SnapshotRestoreBody(BaseModel):
    snapshot_id: str
    rel: str
    dest_rel: str | None = None


@router.post("/chats/{chat_id}/snapshots/restore")
def restore_chat_snapshot(chat_id: str, body: SnapshotRestoreBody) -> dict[str, Any]:
    workspace, _ = _workspace_for_chat(chat_id)
    snap_root = _snapshots_dir(workspace)
    sid = body.snapshot_id
    if not sid or ".." in sid or "/" in sid or "\\" in sid:
        raise HTTPException(status_code=400, detail="invalid snapshot_id")
    src_base = (snap_root / sid).resolve()
    try:
        src_base.relative_to(snap_root.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="snapshot escapes store") from exc
    if not src_base.is_dir():
        raise HTTPException(status_code=404, detail="snapshot not found")
    rel = body.rel
    if not rel or rel.startswith(("/", "\\")) or ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail="invalid rel")
    src = (src_base / rel).resolve()
    try:
        src.relative_to(src_base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="file escapes snapshot") from exc
    if not src.is_file():
        raise HTTPException(status_code=404, detail="snapshot file not found")
    out_rel = body.dest_rel or rel
    if not out_rel or out_rel.startswith(("/", "\\")) or ".." in Path(out_rel).parts:
        raise HTTPException(status_code=400, detail="invalid dest")
    dest = (workspace / out_rel).resolve()
    try:
        dest.relative_to(workspace.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="dest escapes workspace") from exc
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return {"ok": True, "restored": str(dest.relative_to(workspace.resolve()))}
