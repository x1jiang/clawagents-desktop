"""Session rewind — list and restore workspace file snapshots (VS Code parity)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth
from clawagents.utils.atomic_write import atomic_write_text

router = APIRouter(tags=["rewind"], dependencies=[require_auth()])

# Cap so a long abandoned branch cannot dominate the restored context.
_BRANCH_SUMMARY_MAX_ITEMS = 6
_BRANCH_SUMMARY_SNIPPET = 240


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


def summarize_abandoned_branch(rows: list[dict[str, Any]]) -> str:
    """One note describing the attempt a rewind is throwing away.

    Rewind restores files and truncates the transcript, so everything the
    failed attempt learned is lost — the agent then re-derives it and often
    re-attempts the same thing. A short "tried X, it failed because Y" note
    carried back into the surviving branch removes that loop.

    Deliberately extractive rather than LLM-summarized: a rewind should be
    instant and free. Returns "" when there is nothing worth saying.
    """
    asks: list[str] = []
    outcomes: list[str] = []
    failures: list[str] = []
    for row in rows:
        kind = str(row.get("type") or row.get("kind") or "")
        text = str(row.get("content") or row.get("text") or row.get("message") or "").strip()
        if not text:
            continue
        snippet = " ".join(text.split())[:_BRANCH_SUMMARY_SNIPPET]
        if kind in ("user_message", "user"):
            asks.append(snippet)
        elif kind in ("assistant_final", "assistant_message", "assistant"):
            outcomes.append(snippet)
        elif kind in ("error", "warn"):
            failures.append(snippet)

    if not (asks or outcomes or failures):
        return ""

    lines = ["Rewound past an earlier attempt. What it already established:"]
    if asks:
        lines.append(f"- Asked: {asks[0]}")
        if len(asks) > 1:
            lines.append(f"  (plus {len(asks) - 1} follow-up request(s))")
    for outcome in outcomes[-_BRANCH_SUMMARY_MAX_ITEMS:]:
        lines.append(f"- Result: {outcome}")
    for failure in failures[-_BRANCH_SUMMARY_MAX_ITEMS:]:
        lines.append(f"- FAILED: {failure}")
    lines.append(
        "Do not repeat the failed approach above without changing something; "
        "the files themselves have been restored."
    )
    return "\n".join(lines)


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
    branch_note = ""
    if kept:
        dropped_rows: list[dict[str, Any]] = []
        for ln in lines[len(kept) :]:
            try:
                dropped_rows.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        branch_note = summarize_abandoned_branch(dropped_rows)
        if branch_note:
            kept = kept + [
                json.dumps(
                    {
                        "type": "assistant_message",
                        "content": branch_note,
                        "branch_summary": True,
                        "ts": time.time(),
                    },
                    default=str,
                )
            ]
        atomic_write_text(path, "\n".join(kept) + "\n")
    return {
        "ok": True,
        "kept_events": len(kept),
        "chat_id": chat_id,
        "branch_summary": branch_note,
    }


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
