"""Session rewind — list and restore workspace file snapshots (VS Code parity)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth
from clawagents.utils.atomic_write import atomic_write_text

router = APIRouter(tags=["rewind"], dependencies=[require_auth()])


class RewindBody(BaseModel):
    prompt_index: int
    project_id: str | None = None
    chat_id: str | None = None
    root_path: str | None = None


def _resolve_workspace(
    *,
    project_id: str | None,
    root_path: str | None,
    chat_id: str | None,
) -> Path:
    if root_path:
        return Path(root_path).expanduser().resolve()
    if project_id:
        try:
            return Path(ProjectStore().get(project_id).root_path).resolve()
        except ProjectNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    if chat_id:
        from clawagents.gateway.chats_api import _resolve_root_for_chat

        root, _ = _resolve_root_for_chat(chat_id)
        return Path(root).resolve()
    raise HTTPException(
        status_code=400,
        detail="project_id, root_path, or chat_id required",
    )


def _truncate_chat_jsonl(
    chat_id: str,
    *,
    user_text: str = "",
    message_count: int | None = None,
) -> dict[str, Any]:
    """Truncate Desktop session JSONL to a rewind conversation marker."""
    from clawagents.gateway.chats_api import _resolve_chat

    try:
        path, _ = _resolve_chat(chat_id)
    except HTTPException:
        return {"ok": False, "error": "chat not found", "kept_events": 0}

    if not path.exists():
        return {"ok": True, "kept_events": 0}

    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    kept: list[str] = []
    target = (user_text or "").strip()
    if target:
        user_seen = 0
        for i, ln in enumerate(lines):
            try:
                row = json.loads(ln)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "user_message":
                content = str(row.get("content") or "").strip()
                if content == target:
                    kept = lines[: i + 1]
                    break
                user_seen += 1
    if not kept and message_count is not None and message_count > 0:
        user_seen = 0
        for i, ln in enumerate(lines):
            try:
                row = json.loads(ln)
            except json.JSONDecodeError:
                continue
            if row.get("type") == "user_message":
                user_seen += 1
                if user_seen >= message_count:
                    kept = lines[: i + 1]
                    break
    if kept:
        atomic_write_text(path, "\n".join(kept) + "\n")
    return {"ok": True, "kept_events": len(kept), "chat_id": chat_id}


@router.get("/rewind")
def list_rewind(
    project_id: str | None = Query(default=None),
    root_path: str | None = Query(default=None),
    chat_id: str | None = Query(default=None),
) -> dict:
    workspace = _resolve_workspace(
        project_id=project_id, root_path=root_path, chat_id=chat_id
    )
    try:
        from clawagents.memory.hunk_watcher import get_watcher

        rows = get_watcher(str(workspace)).list_snapshots()
        return {"ok": True, "snapshots": rows, "workspace": str(workspace)}
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(exc),
            "snapshots": [],
            "workspace": str(workspace),
        }


@router.post("/rewind")
def rewind_to(body: RewindBody) -> dict:
    workspace = _resolve_workspace(
        project_id=body.project_id,
        root_path=body.root_path,
        chat_id=body.chat_id,
    )
    try:
        from clawagents.memory.hunk_watcher import get_watcher

        result = get_watcher(str(workspace)).rewind_to_prompt(int(body.prompt_index))
        if body.chat_id and result.get("ok"):
            try:
                trunc = _truncate_chat_jsonl(
                    body.chat_id,
                    user_text=str(result.get("truncate_to_user_text") or ""),
                    message_count=result.get("message_count"),
                )
                result["conversation_truncated"] = trunc
            except Exception as trunc_exc:  # noqa: BLE001
                result["conversation_truncated"] = {
                    "ok": False,
                    "error": str(trunc_exc),
                }
        return {"ok": bool(result.get("ok")), **result}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
