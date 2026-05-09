"""REST router for desktop Chat CRUD (both project-scoped and projectless).

Streaming POST /chats/:id/messages is added in Task 13; this file lays out
the storage + listing + metadata reads.
"""

from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from clawagents.desktop_stores.app_paths import (
    projectless_chats_dir,
    projectless_scratch_dir,
)
from clawagents.desktop_stores.project_store import (
    Project,
    ProjectNotFoundError,
    ProjectStore,
)
from clawagents.desktop_stores.settings_store import SettingsStore
from clawagents.gateway.desktop_router import require_auth
from clawagents.session.persistence import SessionReader, SessionWriter

router = APIRouter(tags=["chats"], dependencies=[require_auth()])


class ChatCreateBody(BaseModel):
    title: str | None = None
    model: str | None = None
    mode: str | None = None


def _project_sessions_dir(project: Project) -> Path:
    return Path(project.root_path) / ".clawagents" / "sessions"


def _projectless_sessions_dir() -> Path:
    d = projectless_chats_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _scratch_dir(chat_id: str) -> Path:
    d = projectless_scratch_dir() / chat_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _list_session_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)


def _read_chat_meta(jsonl_path: Path) -> dict:
    """Reads the first chat_meta event; returns sane defaults if absent."""
    meta = {"title": jsonl_path.stem, "model": "", "mode": "auto"}
    try:
        with jsonl_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("type") == "chat_meta":
                    meta.update({k: ev.get(k, meta[k]) for k in ("title", "model", "mode")})
                    break
    except (OSError, json.JSONDecodeError):
        pass
    return meta


def _chat_record(jsonl_path: Path, project_id: str | None) -> dict:
    meta = _read_chat_meta(jsonl_path)
    stat = jsonl_path.stat()
    return {
        "id": jsonl_path.stem,
        "project_id": project_id,
        "title": meta["title"],
        "model": meta["model"],
        "mode": meta["mode"],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_ctime)),
        "last_message_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
        "status": "idle",
    }


def _resolve_chat(chat_id: str) -> tuple[Path, str | None]:
    """Find a chat's JSONL path. Returns (path, project_id|None)."""
    pl = _projectless_sessions_dir() / f"{chat_id}.jsonl"
    if pl.exists():
        return pl, None
    for project in ProjectStore().list():
        candidate = _project_sessions_dir(project) / f"{chat_id}.jsonl"
        if candidate.exists():
            return candidate, project.id
    raise HTTPException(status_code=404, detail=f"chat {chat_id} not found")


# ─── Project-scoped chats ───────────────────────────────────────────────


@router.get("/projects/{project_id}/chats")
def list_project_chats(project_id: str) -> list[dict]:
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    return [_chat_record(p, project.id) for p in _list_session_files(_project_sessions_dir(project))]


@router.post("/projects/{project_id}/chats", status_code=201)
def create_project_chat(project_id: str, body: ChatCreateBody) -> dict:
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    chat_id = f"chat-{uuid.uuid4().hex[:12]}"
    sessions = _project_sessions_dir(project)
    sessions.mkdir(parents=True, exist_ok=True)
    writer = SessionWriter(session_id=chat_id, session_dir=sessions)
    settings = SettingsStore().load()
    writer.write_chat_meta(
        title=body.title or "New chat",
        model=body.model or project.default_model or settings.default_model or "",
        mode=body.mode or project.default_mode or settings.default_mode or "auto",
    )
    return {"chat_id": chat_id}


# ─── Projectless chats ──────────────────────────────────────────────────


@router.get("/chats")
def list_projectless_chats() -> list[dict]:
    return [_chat_record(p, None) for p in _list_session_files(_projectless_sessions_dir())]


@router.post("/chats", status_code=201)
def create_projectless_chat(body: ChatCreateBody) -> dict:
    chat_id = f"chat-{uuid.uuid4().hex[:12]}"
    writer = SessionWriter(session_id=chat_id, session_dir=_projectless_sessions_dir())
    settings = SettingsStore().load()
    writer.write_chat_meta(
        title=body.title or "New chat",
        model=body.model or settings.default_model or "",
        # Projectless chats prefer Read-only by default — they have no project
        # boundary, so giving the agent write access feels unsafe. Per spec §5.3.
        mode=body.mode or "read_only",
    )
    _scratch_dir(chat_id)  # create empty scratch dir up front
    return {"chat_id": chat_id}


# ─── Chat-level reads + delete ──────────────────────────────────────────


@router.get("/chats/{chat_id}")
def get_chat(chat_id: str) -> dict:
    path, project_id = _resolve_chat(chat_id)
    return _chat_record(path, project_id)


@router.get("/chats/{chat_id}/messages")
def get_chat_messages(chat_id: str) -> list[dict]:
    path, _ = _resolve_chat(chat_id)
    reader = SessionReader(path)
    out: list[dict] = []
    for m in reader.reconstruct_messages():
        out.append({
            "role": m.role,
            "content": m.content if isinstance(m.content, str) else str(m.content),
            "tool_call_id": m.tool_call_id,
            "tool_calls": m.tool_calls_meta,
            "thinking": m.thinking,
        })
    return out


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str) -> Response:
    path, project_id = _resolve_chat(chat_id)
    path.unlink()
    if project_id is None:
        scratch = projectless_scratch_dir() / chat_id
        if scratch.exists():
            shutil.rmtree(scratch)
    return Response(status_code=204)


# ─── Streaming turn handler ─────────────────────────────────────────────

import asyncio
from typing import Any, Awaitable, Callable

from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as _BM


class MessageBody(_BM):
    content: str
    model_override: str | None = None
    mode_override: str | None = None


# Per-chat cancellation events. A `POST /chats/:id/cancel` flips the event;
# the running turn checks it at every safe point and aborts cleanly.
_cancel_events: dict[str, asyncio.Event] = {}


def _scratch_for(chat_id: str) -> str:
    return str(_scratch_dir(chat_id))


async def run_chat_turn(
    *,
    chat_id: str,
    content: str,
    project_root: str,
    mode: str,
    model: str,
    on_event: Callable[[str, dict], None],
) -> None:
    """Invoke the agent for one user turn, emitting SSE-shaped events."""
    from contextlib import contextmanager

    from clawagents.agent import create_claw_agent

    @contextmanager
    def _chdir(path: str):
        prev = os.getcwd()
        os.chdir(path)
        try:
            yield
        finally:
            os.chdir(prev)

    on_event("user_message", {"content": content})

    sessions_dir = Path(project_root) / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)

    with _chdir(project_root):
        agent = create_claw_agent(model=model) if model else create_claw_agent()
        try:
            result = await agent.invoke(
                content,
                on_event=on_event,
                session_id=chat_id,
                session_dir=sessions_dir,
            )
        except Exception as exc:  # noqa: BLE001
            on_event("error", {"message": str(exc)})
            return

    status = getattr(result, "status", "unknown")
    iterations = getattr(result, "iterations", 0)
    out = getattr(result, "result", "")
    on_event("turn_completed", {
        "chat_id": chat_id,
        "status": status,
        "iterations": iterations,
        "result": out if isinstance(out, str) else str(out),
    })


def _resolve_root_for_chat(chat_id: str) -> tuple[str, str | None]:
    """Return (cwd / project_root, project_id|None)."""
    path, project_id = _resolve_chat(chat_id)
    if project_id is None:
        return _scratch_for(chat_id), None
    project = ProjectStore().get(project_id)
    return project.root_path, project.id


@router.post("/chats/{chat_id}/messages")
async def post_chat_message(chat_id: str, body: MessageBody, request: Request) -> StreamingResponse:
    # Resolve early to surface 404 before opening the stream.
    path, _ = _resolve_chat(chat_id)
    project_root, project_id = _resolve_root_for_chat(chat_id)
    meta = _read_chat_meta(path)
    mode = body.mode_override or meta.get("mode") or "auto"
    model = body.model_override or meta.get("model") or ""

    cancel_event = _cancel_events.setdefault(chat_id, asyncio.Event())
    cancel_event.clear()

    queue: asyncio.Queue[str | None] = asyncio.Queue()

    def emit(kind: str, data: dict) -> None:
        line = f"event: {kind}\ndata: {json.dumps(data, default=str)}\n\n"
        queue.put_nowait(line)

    async def run() -> None:
        try:
            emit("turn_started", {"chat_id": chat_id})
            await run_chat_turn(
                chat_id=chat_id,
                content=body.content,
                project_root=project_root,
                mode=mode,
                model=model,
                on_event=emit,
            )
        except asyncio.CancelledError:
            emit("error", {"message": "cancelled"})
        except Exception as exc:  # noqa: BLE001
            emit("error", {"message": str(exc)})
        finally:
            queue.put_nowait(None)

    asyncio.create_task(run())

    async def gen():
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
            if await request.is_disconnected():
                cancel_event.set()
                break

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/chats/{chat_id}/cancel")
def cancel_chat(chat_id: str) -> dict:
    _resolve_chat(chat_id)  # 404 if unknown
    event = _cancel_events.setdefault(chat_id, asyncio.Event())
    event.set()
    return {"ok": True}
