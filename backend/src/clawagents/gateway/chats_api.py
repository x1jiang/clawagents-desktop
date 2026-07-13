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
    """Reads the latest chat_meta event; returns sane defaults if absent."""
    meta: dict = {"title": jsonl_path.stem, "model": "", "mode": "auto", "pinned": False, "note": ""}
    try:
        with jsonl_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("type") == "chat_meta":
                    # Latest chat_meta wins. PATCH /chats/:id appends new
                    # chat_meta events to update title/model/mode/pinned/note
                    # without mutating the append-only JSONL.
                    for k in ("title", "model", "mode", "pinned", "note"):
                        if k in ev:
                            meta[k] = ev[k]
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
        "pinned": bool(meta.get("pinned")),
        "note": str(meta.get("note") or ""),
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


def _chat_has_user_message(jsonl_path: Path) -> bool:
    """Return True if the chat's JSONL has ever logged a user_message event."""
    if not jsonl_path.exists():
        return False
    try:
        with jsonl_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("type") == "user_message":
                    return True
    except (OSError, json.JSONDecodeError):
        pass
    return False


_INSTRUCTION_FILES = ("CLAUDE.md", ".clawagents/instructions.md", "AGENTS.md")


def _read_project_instructions(project_root: Path) -> str | None:
    """First-match read of CLAUDE.md / .clawagents/instructions.md / AGENTS.md.

    Returns stripped content or None when no file is found or readable.
    """
    for rel in _INSTRUCTION_FILES:
        candidate = project_root / rel
        if candidate.exists() and candidate.is_file():
            try:
                text = candidate.read_text(encoding="utf-8").strip()
                if text:
                    return text
            except OSError:
                pass
    return None


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


class ChatPatchBody(BaseModel):
    title: str | None = None
    model: str | None = None
    mode: str | None = None
    pinned: bool | None = None
    note: str | None = None


@router.patch("/chats/{chat_id}")
def patch_chat(chat_id: str, body: ChatPatchBody) -> dict:
    """Update chat metadata by appending a new chat_meta event.

    JSONL is append-only by design; `_read_chat_meta` resolves to the
    latest entry, so a new chat_meta event takes precedence. Fields not
    provided in the body inherit the current value.
    """
    sent = body.model_fields_set
    path, project_id = _resolve_chat(chat_id)
    current = _read_chat_meta(path)
    sessions_dir = path.parent
    writer = SessionWriter(session_id=chat_id, session_dir=sessions_dir)
    writer.write_chat_meta(
        title=body.title if body.title is not None else current["title"],
        model=body.model if body.model is not None else current["model"],
        mode=body.mode if body.mode is not None else current["mode"],
        pinned=body.pinned if body.pinned is not None else bool(current.get("pinned")),
        # Note uses field-set tracking so PATCH can clear it (note="") without
        # being indistinguishable from "field omitted".
        note=(body.note if "note" in sent else current.get("note", "")) or "",
    )
    return _chat_record(path, project_id)


@router.get("/chats/{chat_id}/events")
def get_chat_events(chat_id: str, limit: int = 500) -> list[dict]:
    """Return raw JSONL events for a chat, newest first up to `limit`.

    Different from /messages — that endpoint returns reconstructed
    role/content messages, while this one exposes the full event stream
    (turn_started, usage, tool_call, tool_result, etc.) for the activity
    panel.
    """
    path, _ = _resolve_chat(chat_id)
    out: list[dict] = []
    try:
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                out.append(ev)
    except OSError:
        return []
    # Newest first is more useful for a timeline panel.
    out.reverse()
    return out[:limit]


@router.get("/chats/{chat_id}/messages")
def get_chat_messages(chat_id: str) -> list[dict]:
    path, _ = _resolve_chat(chat_id)
    reader = SessionReader(path)
    attachments_by_user_idx: dict[int, list[dict]] = {}
    user_idx = 0
    try:
        with path.open(encoding="utf-8") as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") != "user_message":
                    continue
                attachments = ev.get("attachments")
                if isinstance(attachments, list):
                    attachments_by_user_idx[user_idx] = attachments
                user_idx += 1
    except OSError:
        pass
    out: list[dict] = []
    user_idx = 0
    for m in reader.reconstruct_messages():
        item = {
            "role": m.role,
            "content": m.content if isinstance(m.content, str) else str(m.content),
            "tool_call_id": m.tool_call_id,
            "tool_calls": m.tool_calls_meta,
            "thinking": m.thinking,
        }
        if m.role == "user":
            item["attachments"] = attachments_by_user_idx.get(user_idx, [])
            user_idx += 1
        out.append(item)
    return out


@router.get("/search/chats")
def search_chats(q: str, limit: int = 50) -> list[dict]:
    """Cross-chat substring search.

    Walks every chat JSONL (projectless + per-project), inspecting user_message
    and assistant_message events. Returns chat metadata + a snippet centred on
    the first match, newest chat first. Empty `q` returns no results.
    """
    q = q.strip()
    if not q:
        return []
    needle = q.lower()
    results: list[dict] = []

    def scan(jsonl_path: Path, project_id: str | None) -> dict | None:
        try:
            with jsonl_path.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("type") not in ("user_message", "assistant_message"):
                        continue
                    content = str(ev.get("content") or "")
                    if not content:
                        continue
                    idx = content.lower().find(needle)
                    if idx == -1:
                        continue
                    # Build a snippet around the match.
                    start = max(0, idx - 40)
                    end = min(len(content), idx + len(q) + 40)
                    snippet = content[start:end]
                    if start > 0:
                        snippet = "…" + snippet
                    if end < len(content):
                        snippet = snippet + "…"
                    meta = _read_chat_meta(jsonl_path)
                    return {
                        "chat_id": jsonl_path.stem,
                        "project_id": project_id,
                        "title": meta["title"],
                        "role": ev["type"].replace("_message", ""),
                        "snippet": snippet,
                    }
        except OSError:
            return None
        return None

    candidates: list[tuple[float, Path, str | None]] = []
    for p in _list_session_files(_projectless_sessions_dir()):
        candidates.append((p.stat().st_mtime, p, None))
    for project in ProjectStore().list():
        for p in _list_session_files(_project_sessions_dir(project)):
            candidates.append((p.stat().st_mtime, p, project.id))
    candidates.sort(key=lambda t: t[0], reverse=True)

    for _, p, pid in candidates:
        hit = scan(p, pid)
        if hit is not None:
            results.append(hit)
            if len(results) >= limit:
                break
    return results


@router.get("/chats/{chat_id}/export.json")
def export_chat_json(chat_id: str) -> Response:
    """Programmatic export: full chat metadata + reconstructed message list.

    Distinct from /export (Markdown) because the JSON form is meant for
    machine consumers — backup pipelines, replay tooling, archival. Schema:
        { meta: {…chat metadata…},
          messages: [
            { role: str, content: str, tool_call_id?: str|None,
              tool_calls?: [...], thinking?: str|None },
            ...
          ] }
    """
    path, project_id = _resolve_chat(chat_id)
    meta = _read_chat_meta(path)
    reader = SessionReader(path)
    messages_out: list[dict] = []
    for m in reader.reconstruct_messages():
        messages_out.append({
            "role": m.role,
            "content": m.content if isinstance(m.content, str) else str(m.content),
            "tool_call_id": m.tool_call_id,
            "tool_calls": m.tool_calls_meta,
            "thinking": m.thinking,
        })
    payload = {
        "meta": {
            "id": chat_id,
            "project_id": project_id,
            "title": meta["title"],
            "model": meta["model"],
            "mode": meta["mode"],
            "pinned": bool(meta.get("pinned")),
            "note": str(meta.get("note") or ""),
        },
        "messages": messages_out,
    }
    return Response(
        content=json.dumps(payload, indent=2, default=str),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{chat_id}.json"',
        },
    )


@router.get("/chats/{chat_id}/export")
def export_chat_markdown(chat_id: str) -> Response:
    """Render a chat as a single Markdown document for download / sharing.

    System messages, tool calls, and tool results are included as collapsible
    `<details>` blocks so the rendered view is readable on GitHub and similar
    Markdown viewers.
    """
    path, project_id = _resolve_chat(chat_id)
    meta = _read_chat_meta(path)
    reader = SessionReader(path)
    lines: list[str] = []
    lines.append(f"# {meta['title']}\n")
    lines.append(f"_Model: `{meta['model'] or '(default)'}` · Mode: `{meta['mode']}`_\n")
    if project_id:
        lines.append(f"_Project: `{project_id}`_\n")
    lines.append("")

    tool_calls_by_id: dict[str, dict] = {}
    for m in reader.reconstruct_messages():
        if m.role == "system":
            content = m.content if isinstance(m.content, str) else str(m.content)
            lines.append("<details><summary>System prompt</summary>\n")
            lines.append(f"```\n{content}\n```\n")
            lines.append("</details>\n")
        elif m.role == "user":
            content = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"### 👤 User\n\n{content}\n")
        elif m.role == "assistant":
            content = m.content if isinstance(m.content, str) else str(m.content)
            lines.append(f"### 🤖 Assistant\n")
            if m.thinking:
                lines.append("<details><summary>Thinking</summary>\n")
                lines.append(f"```\n{m.thinking}\n```\n</details>\n")
            if content:
                lines.append(f"{content}\n")
            if m.tool_calls_meta:
                for tc in m.tool_calls_meta:
                    tool_calls_by_id[tc["id"]] = tc
                    name = tc.get("name", "")
                    args = tc.get("args", {})
                    lines.append(f"<details><summary>🔧 Tool call: <code>{name}</code></summary>\n")
                    lines.append(f"```json\n{json.dumps(args, indent=2, default=str)}\n```\n")
                    lines.append("</details>\n")
        elif m.role == "tool":
            content = m.content if isinstance(m.content, str) else str(m.content)
            tc = tool_calls_by_id.get(m.tool_call_id or "", {})
            name = tc.get("name", "tool")
            lines.append(f"<details><summary>🔧 Result of <code>{name}</code></summary>\n")
            lines.append(f"```\n{content}\n```\n</details>\n")

    body = "\n".join(lines)
    return Response(
        content=body,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{chat_id}.md"',
        },
    )


_TRASH_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days


def _trash_dir(sessions_dir: Path) -> Path:
    d = sessions_dir / ".trash"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _purge_old_trash(trash_dir: Path) -> None:
    """Best-effort cleanup of trash files older than the TTL."""
    if not trash_dir.exists():
        return
    cutoff = time.time() - _TRASH_TTL_SECONDS
    for p in trash_dir.glob("*.jsonl"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            continue


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str) -> Response:
    """Soft-delete: move the JSONL to a sibling `.trash/` dir.

    Restorable via POST /chats/:id/restore within ~30 days. The chat
    becomes invisible to /chats and /projects/:id/chats but the bytes are
    still there. Existing scratch dirs (for projectless chats) are also
    purged after the restore window expires.
    """
    path, project_id = _resolve_chat(chat_id)
    trash = _trash_dir(path.parent)
    # Stamp the trashed filename with the trash time so retention is easy.
    ts = int(time.time())
    target = trash / f"{path.stem}-{ts}.jsonl"
    try:
        path.rename(target)
    except OSError:
        # rename across mounts can fail; fall back to copy+unlink.
        target.write_bytes(path.read_bytes())
        path.unlink()
    _purge_old_trash(trash)
    _cancel_events.pop(chat_id, None)
    _chat_locks.pop(chat_id, None)
    return Response(status_code=204)


@router.post("/chats/{chat_id}/restore")
def restore_chat(chat_id: str) -> dict:
    """Restore the most recently-trashed copy of a chat by id."""
    # Search across both projectless and per-project trash dirs since the
    # chat is no longer in /chats and _resolve_chat would 404 it.
    candidates: list[Path] = []
    for dirp in (_projectless_sessions_dir(),
                 *(_project_sessions_dir(p) for p in ProjectStore().list())):
        trash = dirp / ".trash"
        if not trash.exists():
            continue
        for f in trash.glob(f"{chat_id}-*.jsonl"):
            candidates.append(f)
    if not candidates:
        raise HTTPException(status_code=404, detail=f"no trashed copy of {chat_id} found")
    # Most recently trashed (largest suffix timestamp) wins.
    best = max(candidates, key=lambda p: p.stat().st_mtime)
    sessions_dir = best.parent.parent
    destination = sessions_dir / f"{chat_id}.jsonl"
    if destination.exists():
        raise HTTPException(status_code=409, detail="a live chat with that id already exists")
    best.rename(destination)
    return {"ok": True}


@router.get("/trash/chats")
def list_trashed_chats() -> list[dict]:
    """List every still-recoverable chat across the projectless dir and
    every project's sessions dir."""
    out: list[dict] = []
    for sessions_dir, project_id in (
        [(_projectless_sessions_dir(), None)]
        + [(_project_sessions_dir(p), p.id) for p in ProjectStore().list()]
    ):
        trash = sessions_dir / ".trash"
        if not trash.exists():
            continue
        for f in trash.glob("*.jsonl"):
            # Filename pattern is <chat_id>-<ts>.jsonl — chat_id may itself
            # contain "-", so rsplit once.
            try:
                stem = f.stem  # without .jsonl
                chat_id, _, _ = stem.rpartition("-")
                ts = int(stem.rsplit("-", 1)[-1])
            except (ValueError, AttributeError):
                continue
            out.append({
                "chat_id": chat_id,
                "project_id": project_id,
                "trashed_at": ts,
                "filename": f.name,
            })
    out.sort(key=lambda r: r["trashed_at"], reverse=True)
    return out


@router.delete("/trash/chats", status_code=204)
def empty_trash() -> Response:
    """Permanently delete every trashed chat across every sessions dir.

    Same as letting the 30-day auto-purge complete, but immediate. Returns
    204 with no body — the client should re-fetch /trash/chats if it cares.
    """
    for sessions_dir, _ in (
        [(_projectless_sessions_dir(), None)]
        + [(_project_sessions_dir(p), p.id) for p in ProjectStore().list()]
    ):
        trash = sessions_dir / ".trash"
        if not trash.exists():
            continue
        for f in trash.glob("*.jsonl"):
            try:
                f.unlink()
            except OSError:
                continue
    return Response(status_code=204)


# ─── Streaming turn handler ─────────────────────────────────────────────

import asyncio
from typing import Any, Awaitable, Callable

from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as _BM


class AutoApproveBody(_BM):
    edit: bool = False
    execute: bool = False
    web: bool = False
    browser: bool = False


class MessageBody(_BM):
    content: str
    model_override: str | None = None
    mode_override: str | None = None
    attachment_ids: list[str] | None = None
    auto_approve: AutoApproveBody | None = None
    caveman: bool = False
    # interactive = ask_user hits the UI; auto = agent decides without waiting.
    interaction: str = "interactive"


# Per-chat cancellation events. A `POST /chats/:id/cancel` flips the event;
# the running turn checks it at every safe point and aborts cleanly.
_cancel_events: dict[str, asyncio.Event] = {}

# Process-wide lock: serializes all chdir-protected sections so concurrent
# turns from different chats can't see each other's cwd.
_chdir_lock = asyncio.Lock()

# Per-chat locks: a chat shouldn't run two turns at once.
_chat_locks: dict[str, asyncio.Lock] = {}


def _chat_lock(chat_id: str) -> asyncio.Lock:
    lock = _chat_locks.get(chat_id)
    if lock is None:
        lock = asyncio.Lock()
        _chat_locks[chat_id] = lock
    return lock


def _translate_event(kind: str, data: dict) -> tuple[str, dict] | None:
    """Map agent loop EventKinds to the frontend's stream-protocol events.

    The agent emits a richer event vocabulary than the desktop UI cares
    about. This translator is the single source of truth for what the SSE
    stream exposes to the frontend. Returns None to drop an event.
    """
    # Pass-through (kinds that match exactly — either agent-synthesized events
    # that already use frontend vocabulary, or frontend-vocabulary events
    # emitted directly by run_chat_turn itself).
    if kind in (
        "turn_started", "error", "permission_required", "user_message",
        "assistant_token", "assistant_final", "tool_use", "turn_completed",
        "usage", "info", "checkpoint", "compact_progress", "file_changed",
        "ask_user_required", "warn", "tool_skipped",
    ):
        return kind, data

    # Streaming token deltas
    if kind == "assistant_delta":
        # Agent payloads vary; check common field names.
        text = data.get("delta") or data.get("text") or data.get("content") or ""
        if not text:
            return None
        return "assistant_token", {"text": text}

    # A complete assistant message (no streaming)
    if kind in ("assistant_message", "final_content"):
        text = data.get("content") or ""
        if not text:
            return None
        return "assistant_token", {"text": text}

    # Tool call started — mirror the agent's id/name/args shape into tool_use
    if kind == "tool_call":
        return "tool_use", {
            "id": str(data.get("id") or data.get("tool_call_id") or data.get("name", "")),
            "name": data.get("name", ""),
            "args": data.get("args") or data.get("arguments") or {},
        }

    # Tool result — translate name→tool_call_id when id missing
    if kind == "tool_result":
        return "tool_result", {
            "tool_call_id": str(data.get("tool_call_id") or data.get("id") or data.get("name", "")),
            "success": bool(data.get("success", True)),
            "output": str(data.get("output") or data.get("preview") or data.get("result") or ""),
        }

    # Turn end
    if kind == "agent_done":
        return "turn_completed", {
            "status": str(data.get("status", "ok")),
            "iterations": int(data.get("iterations") or 0),
            "result": str(data.get("result") or ""),
        }

    # Drop everything else: retry, context, tool_started,
    # guardrail_tripped, approval_required, final_output.
    # checkpoint / compact_progress / file_changed / ask_user_required
    # are forwarded above.
    return None


def _scratch_for(chat_id: str) -> str:
    return str(_scratch_dir(chat_id))


def _decide_by_mode(mode: str, file_path: str | None, project_root: str) -> str | None:
    """Resolve a permission request based on the chat's mode, or fall through.

    Returns the decision string (``allow_once``/``deny``) when the chat's
    permission mode is decisive, or ``None`` when the request should fall
    through to the grant store + user prompt. The four UI modes map as:

    - ``read_only`` — refuse all writes
    - ``full_access`` — auto-allow all writes
    - ``auto`` — auto-allow writes inside ``project_root``; prompt otherwise
    - ``ask`` (default) — always prompt

    Paths that fail to resolve (broken symlinks, perms errors) fall through
    rather than risk a false-positive auto-allow.
    """
    if mode == "read_only":
        return "deny"
    if mode == "full_access":
        return "allow_once"
    if mode == "auto":
        if file_path and project_root:
            try:
                resolved_file = Path(file_path).resolve()
                resolved_root = Path(project_root).resolve()
                if resolved_file == resolved_root or resolved_root in resolved_file.parents:
                    return "allow_once"
            except OSError:
                pass
    return None


# Sentinel: run_chat_turn's invoke was cancelled (vs. a real result).
_CANCELLED = object()


async def _invoke_or_cancel(invoke_coro, cancel_event, on_event):
    """Await ``invoke_coro`` unless ``cancel_event`` fires first.

    On cancel, the in-flight invoke task is cancelled (the agent loop turns the
    resulting CancelledError into a clean stop), a ``cancelled`` error event is
    emitted, and ``_CANCELLED`` is returned. Otherwise the invoke result is
    returned (re-raising any real invoke exception to the caller).
    """
    invoke_task = asyncio.ensure_future(invoke_coro)
    stop_task = asyncio.ensure_future(cancel_event.wait())
    done, _pending = await asyncio.wait(
        {invoke_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
    )
    if invoke_task in done:
        stop_task.cancel()
        try:
            await stop_task
        except asyncio.CancelledError:
            pass
        return invoke_task.result()  # propagates a real invoke exception
    # cancel_event fired first — abort the agent turn.
    invoke_task.cancel()
    try:
        await invoke_task
    except BaseException:  # noqa: BLE001 — discard the cancelled task's outcome
        pass
    on_event("error", {"message": "cancelled"})
    return _CANCELLED


def _bedrock_api_key() -> str:
    """Gateway token for BAG / LiteLLM — never reuse OPENAI_API_KEY here."""
    return (os.environ.get("BEDROCK_API_KEY") or "").strip() or "bedrock"


def _apply_aws_settings(settings) -> None:
    region = (getattr(settings, "aws_region", None) or "").strip()
    if region:
        os.environ["AWS_REGION"] = region
        os.environ.setdefault("AWS_DEFAULT_REGION", region)
    profile = (getattr(settings, "aws_profile", None) or "").strip()
    if profile:
        os.environ["AWS_PROFILE"] = profile


def _resolve_model_kwargs(model: str | None, settings) -> dict:
    """Translate app settings into create_claw_agent model/provider kwargs."""
    from clawagents.desktop_stores.url_trust import is_trusted_base_url

    kwargs: dict = {}
    effective_model = (model or getattr(settings, "default_model", None) or "").strip() or None
    if effective_model:
        kwargs["model"] = effective_model

    base_url = (getattr(settings, "base_url", None) or "").strip() or None
    if base_url and (
        is_trusted_base_url(base_url) or getattr(settings, "trust_custom_base_url", False)
    ):
        kwargs["base_url"] = base_url

    provider = str(getattr(settings, "provider", None) or "auto")
    if provider == "bedrock":
        _apply_aws_settings(settings)
        if not effective_model:
            kwargs["model"] = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
        if kwargs.get("base_url"):
            kwargs["api_key"] = _bedrock_api_key()
    elif provider == "ollama":
        if not kwargs.get("base_url"):
            kwargs["base_url"] = "http://localhost:11434/v1"
        if not effective_model:
            kwargs["model"] = "llama3.1"
        kwargs["api_key"] = (os.environ.get("OPENAI_API_KEY") or "").strip() or "ollama"
    elif provider == "openai" and kwargs.get("base_url"):
        kwargs["api_key"] = (os.environ.get("OPENAI_API_KEY") or "").strip() or "openai"
    elif provider in {"openai", "anthropic", "gemini"} and not effective_model:
        kwargs["profile"] = provider
    elif not effective_model and provider == "auto":
        # Leave model unset — create_claw_agent auto-detects from env.
        pass
    return kwargs


async def run_chat_turn(
    *,
    chat_id: str,
    content: str,
    agent_content: str | None = None,
    attachments: list[dict] | None = None,
    project_root: str,
    mode: str,
    model: str,
    on_event: Callable[[str, dict], None],
    auto_approve: dict | None = None,
    caveman: bool = False,
    interaction: str = "interactive",
    cancel_event: "asyncio.Event | None" = None,
) -> None:
    """Invoke the agent for one user turn, emitting SSE-shaped events.

    If ``cancel_event`` is provided and becomes set mid-turn (POST /cancel or
    client disconnect), the in-flight ``agent.invoke`` is cancelled so the
    turn actually stops instead of running to completion in the background.
    """
    from contextlib import contextmanager
    import inspect

    from clawagents.agent import create_claw_agent
    from clawagents.desktop_stores.settings_store import SettingsStore

    settings = SettingsStore().load()
    # Gate full_access behind an explicit settings toggle (VS Code parity).
    if mode == "full_access" and not settings.allow_full_access:
        mode = "ask"
        on_event("info", {
            "message": "full_access blocked — enable 'Allow Full Access' in Settings.",
        })

    CAVEMAN_INSTRUCTION = (
        "Caveman mode ON. Respond terse like smart caveman. All technical substance stay. Only fluff die.\n"
        "Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging.\n"
        "Fragments OK. Short synonyms. Technical terms exact. Code blocks unchanged. Errors quoted exact.\n"
        "Pattern: [thing] [action] [reason]. [next step]."
    )

    _EDIT_TOOLS = frozenset({
        "write_file", "edit_file", "create_file", "replace_in_file",
        "insert_in_file", "patch_file", "delete_file",
    })
    _WEB_TOOLS = frozenset({"web_fetch", "web_search"})
    _BROWSER_TOOLS = frozenset({
        "browser_navigate", "browser_snapshot", "browser_click", "browser_type",
        "browser_hover", "browser_select_option", "browser_screenshot",
        "browser_wait_for", "browser_back", "browser_forward", "browser_evaluate",
        "browser_close",
    })
    aa = auto_approve or {}

    def _auto_approve_allows(tool: str, file_path: str | None) -> bool:
        if mode == "read_only":
            return False
        name = tool or ""
        if name in _EDIT_TOOLS:
            return bool(aa.get("edit"))
        if name in _WEB_TOOLS:
            return bool(aa.get("web"))
        if name in _BROWSER_TOOLS:
            return bool(aa.get("browser"))
        return bool(aa.get("execute"))

    @contextmanager
    def _chdir(path: str):
        prev = os.getcwd()
        os.chdir(path)
        try:
            yield
        finally:
            os.chdir(prev)

    user_event = {"content": content}
    if attachments:
        user_event["attachments"] = attachments
    on_event("user_message", user_event)

    # Projectless chats live under app-support, not under the scratch dir.
    # _resolve_chat tells us which case this is.
    try:
        _, project_id_for_chat = _resolve_chat(chat_id)
    except HTTPException:
        # Chat not yet persisted (e.g. unit-test scenario); treat as project-scoped.
        project_id_for_chat = "unknown"
    if project_id_for_chat is None:
        sessions_dir = projectless_chats_dir()
    else:
        sessions_dir = Path(project_root) / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)

    # On the first user message in a chat, prepend project context so the
    # agent has it without re-paying tokens every turn. Sources, in order:
    #   1. project.system_prompt (set via Settings page / API)
    #   2. CLAUDE.md / .clawagents/instructions.md / AGENTS.md in root
    chat_jsonl = sessions_dir / f"{chat_id}.jsonl"
    is_first_turn = not _chat_has_user_message(chat_jsonl)
    augmented_content = agent_content or content
    if is_first_turn:
        sections: list[str] = []
        # Workspace prompt is the broadest — applies to every chat in the app.
        try:
            ws_prompt = settings.workspace_system_prompt or ""
            if ws_prompt.strip():
                sections.append(
                    f"<workspace_system_prompt>\n{ws_prompt.strip()}\n</workspace_system_prompt>"
                )
        except Exception:  # noqa: BLE001
            pass
        if project_id_for_chat is not None:
            try:
                project = ProjectStore().get(project_id_for_chat)
                if project.system_prompt and project.system_prompt.strip():
                    sections.append(
                        f"<project_system_prompt>\n{project.system_prompt.strip()}\n</project_system_prompt>"
                    )
            except ProjectNotFoundError:
                pass
        instructions = _read_project_instructions(Path(project_root))
        if instructions:
            sections.append(
                f"<project_instructions>\n{instructions}\n</project_instructions>"
            )
        if sections:
            augmented_content = "\n\n".join(sections) + "\n\n" + content

    # Persist the user's prompt to the JSONL so GET /chats/:id/messages
    # can replay it. The agent's SessionWriter only emits agent-side events
    # (system_prompt, assistant_message, tool_result) — user input arrives
    # as the `task` argument, never written by the agent itself.
    _user_writer = SessionWriter(session_id=chat_id, session_dir=sessions_dir)
    persisted_user = {"content": content}
    if attachments:
        persisted_user["attachments"] = attachments
    _user_writer.append("user_message", persisted_user)

    from clawagents.gateway.permissions_api import get_registry
    from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore

    # Assistant text is owned entirely by the TYPED stream channel:
    #   * ``assistant_delta``   → live per-token append (may include raw
    #                             ``<think>`` tokens / pre-sanitization text)
    #   * ``assistant_message`` → the COMPLETE, *sanitized* message; the UI
    #                             replaces the streamed text with it
    # The legacy channel's ``final_content`` / ``assistant_message`` are
    # dropped: forwarding them alongside the deltas doubled the text
    # ("Done." → "Done.Done.") and, because they are sanitized while the
    # deltas are not, would also leave stale think-token text on screen.
    def _on_stream_event(event):
        if isinstance(event, dict):
            kind = str(event.get("kind", "") or "")
            delta = event.get("delta") or event.get("text")
            content = event.get("content")
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
        else:
            kind = str(getattr(event, "kind", "") or "")
            delta = getattr(event, "delta", None)
            content = getattr(event, "content", None)
            raw_data = getattr(event, "data", None)
            data = raw_data if isinstance(raw_data, dict) else {}

        def _num(name: str) -> int:
            if isinstance(event, dict):
                raw = event.get(name)
            else:
                raw = getattr(event, name, None)
            if raw is None:
                raw = data.get(name)
            try:
                return int(raw or 0)
            except (TypeError, ValueError):
                return 0

        def _str(name: str) -> str:
            if isinstance(event, dict):
                raw = event.get(name)
            else:
                raw = getattr(event, name, None)
            if raw is None:
                raw = data.get(name)
            return str(raw or "")

        # Usage is emitted only on the typed channel (``_emit_typed``). Without
        # this forward, Compact % and run/session cost stay empty forever.
        if kind == "usage":
            on_event("usage", {
                "input_tokens": _num("input_tokens"),
                "output_tokens": _num("output_tokens"),
                "total_tokens": _num("total_tokens"),
                "cached_input_tokens": _num("cached_input_tokens"),
                "cache_creation_tokens": _num("cache_creation_tokens"),
                "model": _str("model"),
            })
            return

        if kind == "compact_progress":
            on_event("compact_progress", {
                "phase": _str("phase"),
                "message": _str("message"),
                "current_tokens": _num("current_tokens"),
                "budget": _num("budget"),
            })
            return

        if kind == "assistant_message":
            if content:
                # Replaces the accumulated streamed tokens with the clean text.
                thinking = None
                if isinstance(event, dict):
                    thinking = event.get("thinking")
                    if thinking is None:
                        thinking = data.get("thinking")
                else:
                    thinking = getattr(event, "thinking", None)
                    if thinking is None:
                        thinking = data.get("thinking")
                payload: dict = {"content": content}
                if thinking:
                    payload["thinking"] = thinking
                on_event("assistant_final", payload)
            return
        if delta:
            on_event("assistant_delta", {"delta": delta})

    def _forward_legacy(kind: str, data: dict | None = None) -> None:
        payload = data or {}
        if kind == "checkpoint":
            out = dict(payload)
            out.setdefault("chat_id", chat_id)
            on_event("checkpoint", out)
            return
        # ``final_content`` / ``assistant_message`` are deliberately dropped:
        # real agents deliver the sanitized message on the typed channel
        # (→ assistant_final), and forwarding the legacy copies too doubled
        # the text. ``assistant_token`` / ``assistant_delta`` stay forwardable
        # for callers that push complete text on the legacy channel (test
        # doubles, non-streaming shims); real agents never emit those here, so
        # this cannot re-introduce the double.
        if kind in {
            "assistant_token", "assistant_delta",
            "tool_use", "tool_call", "tool_result",
            "agent_done", "usage", "info", "error", "warn", "tool_skipped",
            "compact_progress", "file_changed", "ask_user_required",
            "permission_required", "user_message", "turn_started",
            "turn_completed",
        }:
            on_event(kind, payload)

    def _on_legacy_event(kind: str, data: dict | None = None) -> None:
        _forward_legacy(kind, data)

    async def _permission_cb(payload: dict) -> str:
        tool = str(payload.get("tool") or "")
        file_path = payload.get("file_path")
        # Granular auto-approve (VS Code parity) short-circuits ask prompts.
        if _auto_approve_allows(tool, file_path if isinstance(file_path, str) else None):
            return "allow_once"

        # Chat-level mode short-circuits the prompt entirely.
        # `read_only` denies, `full_access` allows, `auto` allows when the
        # touched path is inside the project root. `ask` (and unknown values)
        # fall through to the existing grant check + prompt flow.
        mode_decision = _decide_by_mode(mode, file_path if isinstance(file_path, str) else None, project_root)
        if mode_decision is not None:
            # Only surface DENY decisions. Auto-allows are the whole point of
            # `auto` / `full_access` modes — emitting an info banner per tool
            # call spams the chat. A denied tool result, by contrast, just
            # says "denied by user", which is misleading without context.
            if mode_decision == "deny" and mode == "read_only":
                fp = file_path
                target = f" on {fp}" if fp else ""
                on_event("info", {"message": f"Denied {tool}{target} — chat is in read-only mode."})
            return mode_decision

        # Short-circuit: existing grant?
        if project_id_for_chat is not None:
            if file_path and PermissionGrantStore().match(
                project_id_for_chat, file_path, scope="write"
            ):
                return "allow_once"

        registry = get_registry()
        request_id = registry.create()
        on_event("permission_required", {"request_id": request_id, **payload})
        try:
            decision = await registry.wait(request_id, timeout=600.0)
        except asyncio.TimeoutError:
            registry.resolve(request_id, "deny")
            return "deny"

        # Persist allow_always for project chats
        if decision == "allow_always" and project_id_for_chat is not None:
            if file_path:
                PermissionGrantStore().add(
                    project_id=project_id_for_chat,
                    path_pattern=file_path,
                    scope="write",
                )
        return decision

    # If this is a project chat, layer the project's env_vars into the
    # process env for the duration of the call so any tools the agent runs
    # (subprocess, shells, language SDKs) see them. Captured + restored
    # under the same chdir lock so concurrent turns from different chats
    # don't see each other's overrides.
    project_env_vars: dict[str, str] = {}
    if project_id_for_chat is not None:
        try:
            project = ProjectStore().get(project_id_for_chat)
            if project.env_vars:
                project_env_vars = dict(project.env_vars)
        except ProjectNotFoundError:
            pass

    @contextmanager
    def _temp_env(overrides: dict[str, str]):
        if not overrides:
            yield
            return
        prev: dict[str, str | None] = {k: os.environ.get(k) for k in overrides}
        os.environ.update(overrides)
        try:
            yield
        finally:
            for k, v in prev.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    # Rebuild prior-turn LLM messages from the existing JSONL so the agent
    # actually has memory of past turns. Without this every POST creates a
    # fresh agent that sees only the new user message — the user sees
    # "amnesia" symptoms ("which table?", repeated greetings, etc.).
    prior_session = None
    if chat_jsonl.exists():
        try:
            from clawagents.session.persistence import SessionReader
            from clawagents.session.backends import InMemorySession
            reader = SessionReader(chat_jsonl)
            prior_messages = reader.reconstruct_messages()
            # Drop the leading system message — the agent emits its own
            # system prompt; keep only the user/assistant/tool turns.
            replayable = [m for m in prior_messages if m.role != "system"]
            if replayable:
                prior_session = InMemorySession(session_id=chat_id)
                await prior_session.add_items(replayable)
        except Exception:  # noqa: BLE001
            # Best-effort — without history the chat still works, just amnesic.
            prior_session = None

    # Build create_claw_agent kwargs from settings (VS Code parity).
    agent_kwargs: dict = {}
    agent_kwargs.update(_resolve_model_kwargs(model, settings))
    instructions: list[str] = []
    if mode == "ask":
        instructions.append(
            "You are in ask mode. Prefer explaining and proposing changes "
            "over writing files or running shell commands unless explicitly asked."
        )
    if caveman:
        instructions.append(CAVEMAN_INSTRUCTION)
    if settings.trajectory:
        agent_kwargs["trajectory"] = True
    if settings.learn:
        agent_kwargs["learn"] = True

    workspace = Path(project_root)
    mcp_servers: list = []
    if settings.mcp_enabled:
        try:
            from clawagents.gateway.mcp_loader import load_mcp_servers
            mcp_servers.extend(
                load_mcp_servers(
                    workspace,
                    trust_workspace=bool(settings.mcp_trust_workspace),
                )
            )
        except Exception:  # noqa: BLE001
            pass
    if settings.context_mode:
        try:
            from clawagents.gateway.mcp_loader import (
                CONTEXT_MODE_ROUTING_INSTRUCTION,
                create_context_mode_server,
            )
            already = any(getattr(s, "name", "") == "context-mode" for s in mcp_servers)
            ctx_server = None if already else create_context_mode_server(workspace)
            if ctx_server is not None:
                mcp_servers.append(ctx_server)
            if already or ctx_server is not None:
                instructions.append(CONTEXT_MODE_ROUTING_INSTRUCTION)
        except Exception:  # noqa: BLE001
            pass
    if mcp_servers:
        agent_kwargs["mcp_servers"] = mcp_servers
    if instructions:
        agent_kwargs["instruction"] = "\n\n".join(instructions)

    agent_params = inspect.signature(create_claw_agent).parameters
    agent_mode = (settings.agent_mode or "").strip()
    if agent_mode and "mode" in agent_params:
        agent_kwargs["mode"] = agent_mode
    action_mode = (settings.action_mode or "tools").strip()
    if action_mode == "code" and "action_mode" in agent_params:
        agent_kwargs["action_mode"] = "code"

    if settings.browser_tools:
        try:
            from clawagents.browser import create_browser_tools
            agent_kwargs.setdefault("tools", [])
            agent_kwargs["tools"] = list(agent_kwargs["tools"]) + list(create_browser_tools())
        except Exception as exc:  # noqa: BLE001
            on_event(
                "warn",
                {
                    "message": (
                        "Browser tools enabled but failed to load "
                        f"({type(exc).__name__}: {exc}). "
                        "Install with: pip install 'clawagents[browser]' "
                        "&& playwright install chromium"
                    ),
                },
            )

    # Drop kwargs unsupported by older signatures.
    allowed = set(agent_params)
    agent_kwargs = {k: v for k, v in agent_kwargs.items() if k in allowed}

    # ask_user HITL — replace stdin tool when interaction is interactive.
    def _make_ask_user_tool():
        from clawagents.tools.interactive import AskUserTool
        from clawagents.gateway.agent_power_api import create_ask_request, wait_ask

        if interaction == "auto" or mode == "read_only":
            # Plan / auto: don't block the turn on a human.
            def ask_fn(question: str) -> str | None:
                return (
                    "[auto mode] User is not available to answer. "
                    f"Decide yourself based on the task. Original question: {question}"
                )
            return AskUserTool(ask_fn=ask_fn)

        # AskUserTool runs ``ask_fn`` in a thread-pool executor, where there is
        # no current event loop — ``asyncio.get_event_loop()`` raises there. So
        # capture the gateway's running loop *now* (registration happens on it)
        # and marshal the coroutine back onto it from the worker thread.
        gateway_loop = asyncio.get_running_loop()

        def ask_fn(question: str) -> str | None:
            async def _ask() -> str | None:
                request_id = create_ask_request()
                on_event("ask_user_required", {"request_id": request_id, "question": question})
                return await wait_ask(request_id, timeout=600.0)

            try:
                fut = asyncio.run_coroutine_threadsafe(_ask(), gateway_loop)
                return fut.result(timeout=620)
            except Exception:  # noqa: BLE001
                return None

        return AskUserTool(ask_fn=ask_fn)

    async with _chat_lock(chat_id):
        async with _chdir_lock:
            with _chdir(project_root), _temp_env(project_env_vars):
                agent = create_claw_agent(**agent_kwargs) if agent_kwargs else create_claw_agent()
                try:
                    agent.tools.register(_make_ask_user_tool())
                except Exception:  # noqa: BLE001
                    pass
                invoke_coro = agent.invoke(
                    augmented_content,
                    on_event=_on_legacy_event,
                    session=prior_session,
                    session_id=chat_id,
                    session_dir=sessions_dir,
                    permission_callback=_permission_cb,
                    on_stream_event=_on_stream_event,
                    # Desktop chats need persisted JSONL so GET
                    # /chats/:id/messages can replay history. The
                    # framework's default is off — opt in per turn.
                    # file_snapshots enables pre-write snapshot restore.
                    features={"session_persistence": True, "file_snapshots": True},
                )
                try:
                    if cancel_event is None:
                        result = await invoke_coro
                    else:
                        result = await _invoke_or_cancel(
                            invoke_coro, cancel_event, on_event
                        )
                        if result is _CANCELLED:
                            return
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
    attachment_context = ""
    visible_attachments: list[dict] = []
    if body.attachment_ids:
        from clawagents.gateway.attachments_api import build_attachment_context
        attachment_context, visible_attachments = build_attachment_context(chat_id, body.content, body.attachment_ids)
    else:
        try:
            from clawagents.gateway.attachments_api import build_attachment_context
            attachment_context, _ = build_attachment_context(chat_id, body.content, None)
        except Exception:  # noqa: BLE001
            attachment_context = ""
    agent_content = body.content
    if attachment_context:
        agent_content = f"{body.content}\n\n<uploaded_attachments>\n{attachment_context}\n</uploaded_attachments>"

    cancel_event = _cancel_events.setdefault(chat_id, asyncio.Event())
    cancel_event.clear()

    queue: asyncio.Queue[str | None] = asyncio.Queue()

    # Translate agent EventKinds to the frontend's stream-protocol vocabulary.
    # Unknown event kinds are dropped silently (warn / context / retry / etc.).
    def emit(kind: str, data: dict) -> None:
        translated = _translate_event(kind, data)
        if translated is None:
            return
        out_kind, out_data = translated
        line = f"event: {out_kind}\ndata: {json.dumps(out_data, default=str)}\n\n"
        queue.put_nowait(line)

    async def run() -> None:
        try:
            emit("turn_started", {"chat_id": chat_id})
            turn_kwargs = {
                "chat_id": chat_id,
                "content": body.content,
                "project_root": project_root,
                "mode": mode,
                "model": model,
                "on_event": emit,
                "caveman": bool(body.caveman),
                "interaction": body.interaction if body.interaction in ("interactive", "auto") else "interactive",
                # Lets POST /cancel and client-disconnect actually stop the turn.
                "cancel_event": cancel_event,
            }
            if body.auto_approve is not None:
                turn_kwargs["auto_approve"] = body.auto_approve.model_dump()
            if agent_content != body.content or visible_attachments:
                turn_kwargs["agent_content"] = agent_content
                turn_kwargs["attachments"] = visible_attachments
            await run_chat_turn(**turn_kwargs)
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


class MoveChatBody(_BM):
    """Target for a chat move. `project_id: null` ⇒ move to projectless."""
    project_id: str | None = None


@router.post("/chats/{chat_id}/move")
def move_chat(chat_id: str, body: MoveChatBody) -> dict:
    """Move an existing chat to a different project (or to projectless).

    Atomically renames the JSONL into the destination sessions dir. Refuses
    if the chat is already in the requested location (no-op) — saves the UI
    from having to special-case that. Refuses if a chat with the same id
    already exists in the destination (409). Cleans up the projectless
    scratch dir when graduating to a project; the agent doesn't need it
    anymore once a real project root takes over.
    """
    src_path, current_project_id = _resolve_chat(chat_id)
    if current_project_id == body.project_id:
        return {"ok": True, "moved": False, "reason": "already in destination"}

    if body.project_id is not None:
        try:
            project = ProjectStore().get(body.project_id)
        except ProjectNotFoundError:
            raise HTTPException(status_code=404, detail=f"project {body.project_id} not found")
        dst_dir = _project_sessions_dir(project)
    else:
        dst_dir = _projectless_sessions_dir()
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst_path = dst_dir / f"{chat_id}.jsonl"
    if dst_path.exists():
        raise HTTPException(status_code=409, detail="destination already has a chat with this id")

    try:
        src_path.rename(dst_path)
    except OSError:
        # Cross-mount fallback: copy + remove.
        dst_path.write_bytes(src_path.read_bytes())
        src_path.unlink()

    # Migrating away from projectless? The scratch dir was only ever useful
    # to that mode — drop it to avoid leftover state confusing future turns.
    if current_project_id is None and body.project_id is not None:
        scratch = projectless_scratch_dir() / chat_id
        if scratch.exists():
            shutil.rmtree(scratch, ignore_errors=True)
    return {"ok": True, "moved": True}


class AutoTitleBody(_BM):
    """Optional override of which model to use for the title call."""
    model: str | None = None


@router.post("/chats/{chat_id}/auto-title")
async def auto_title(chat_id: str, body: AutoTitleBody | None = None) -> dict:
    """Generate a concise 3-6 word title from the chat's first turn.

    Runs a single non-streaming, tool-less LLM call using the chat's
    configured model. The result is persisted via a new chat_meta event.
    Returns the new title. If the chat has no user messages yet, returns
    the current title unchanged.
    """
    path, project_id = _resolve_chat(chat_id)
    meta = _read_chat_meta(path)

    reader = SessionReader(path)
    messages = reader.reconstruct_messages()
    user_msgs = [m for m in messages if m.role == "user"]
    if not user_msgs:
        return {"title": meta["title"], "changed": False}

    first_user = user_msgs[0].content if isinstance(user_msgs[0].content, str) else str(user_msgs[0].content)
    first_assistant = next(
        (m.content if isinstance(m.content, str) else str(m.content)
         for m in messages if m.role == "assistant"),
        "",
    )

    # Build a tiny prompt. Cap inputs so we never blow context for the title call.
    sample = first_user[:600]
    if first_assistant:
        sample += "\n\nAssistant replied: " + first_assistant[:300]
    prompt = (
        "Summarise this conversation in 3–6 words for a sidebar title. "
        "Title Case, no quotes, no trailing punctuation. Reply with the title only.\n\n"
        f"Conversation:\n{sample}"
    )

    model_name = (body.model if body and body.model else meta.get("model")) or ""
    if not model_name:
        return {"title": meta["title"], "changed": False, "reason": "no model configured"}

    try:
        from clawagents.config.config import load_config
        from clawagents.providers.llm import LLMMessage, create_provider
        config = load_config()
        provider = create_provider(model_name, config)
        resp = await provider.chat(
            messages=[LLMMessage(role="user", content=prompt)],
            tools=None,
        )
        raw = (resp.content or "").strip()
    except Exception as exc:  # noqa: BLE001
        # Title generation is best-effort. Don't fail the request — return
        # the existing title so the UI doesn't show an error.
        return {"title": meta["title"], "changed": False, "error": str(exc)[:200]}

    # Sanitize: first line only, strip trailing punctuation, cap length.
    first_line = raw.splitlines()[0] if raw.splitlines() else ""
    title = first_line.strip().strip('"\'.,;:!?')
    if not title:
        return {"title": meta["title"], "changed": False, "reason": "empty response"}
    if len(title) > 80:
        title = title[:80].rstrip()

    sessions_dir = path.parent
    writer = SessionWriter(session_id=chat_id, session_dir=sessions_dir)
    writer.write_chat_meta(
        title=title,
        model=meta["model"],
        mode=meta["mode"],
        pinned=bool(meta.get("pinned")),
    )
    return {"title": title, "changed": title != meta["title"], "project_id": project_id}


@router.get("/chats/{chat_id}/compact/backups")
def list_compact_backups(chat_id: str) -> list[dict]:
    """List `<chat>.jsonl.before-compact-<ts>` files for this chat."""
    path, _ = _resolve_chat(chat_id)
    parent = path.parent
    out: list[dict] = []
    for p in parent.glob(f"{chat_id}.jsonl.before-compact-*"):
        try:
            stat = p.stat()
        except OSError:
            continue
        suffix = p.name.split(".before-compact-")[-1]
        out.append({
            "filename": p.name,
            "ts": stat.st_mtime,
            "size": stat.st_size,
            "suffix": suffix,
        })
    out.sort(key=lambda r: r["ts"], reverse=True)
    return out


class CompactRestoreBody(_BM):
    suffix: str


@router.post("/chats/{chat_id}/compact/restore")
def restore_compact_backup(chat_id: str, body: CompactRestoreBody) -> dict:
    """Replace the current JSONL with the backup identified by `suffix`.

    The current JSONL is itself saved as `.jsonl.before-restore-<ts>` so the
    restore is itself reversible.
    """
    if not body.suffix or any(c in body.suffix for c in "/\\"):
        raise HTTPException(status_code=400, detail="bad suffix")
    path, _ = _resolve_chat(chat_id)
    parent = path.parent
    backup = parent / f"{chat_id}.jsonl.before-compact-{body.suffix}"
    if not backup.exists():
        raise HTTPException(status_code=404, detail="backup not found")

    from clawagents.utils.atomic_write import atomic_write_text
    pre_restore = parent / f"{chat_id}.jsonl.before-restore-{int(time.time())}"
    try:
        pre_restore.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"safety backup failed: {exc}")

    try:
        atomic_write_text(path, backup.read_text(encoding="utf-8"))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"restore failed: {exc}")
    return {"ok": True, "safety_backup": str(pre_restore)}


@router.post("/chats/{chat_id}/compact")
async def compact_chat(chat_id: str) -> dict:
    """Summarise the chat with the LLM and rewrite the JSONL.

    The JSONL is reduced to: chat_meta (latest values) + system_prompt +
    one synthetic user_message ("Continue from this summary.") + one
    synthetic assistant_message containing the summary. The original file
    is backed up to `<chat>.jsonl.before-compact-<ts>` so the user can
    recover if the summary is off.
    """
    path, project_id = _resolve_chat(chat_id)
    meta = _read_chat_meta(path)
    reader = SessionReader(path)
    messages = reader.reconstruct_messages()

    # Only consider user/assistant/tool exchanges for the summary input.
    convo: list[str] = []
    for m in messages:
        if m.role == "system":
            continue
        content = m.content if isinstance(m.content, str) else str(m.content)
        if not content:
            continue
        role_label = m.role.title() if m.role else "Unknown"
        convo.append(f"[{role_label}] {content[:2000]}")
    if len(convo) <= 1:
        return {"compacted": False, "reason": "not enough history to compact"}

    transcript = "\n\n".join(convo)
    # Cap the input we hand to the model — keep the head and tail since both
    # ends tend to carry the most context.
    MAX_CHARS = 60_000
    if len(transcript) > MAX_CHARS:
        head = transcript[: MAX_CHARS // 2]
        tail = transcript[-MAX_CHARS // 2 :]
        transcript = head + "\n\n[…middle elided…]\n\n" + tail

    model_name = meta.get("model") or ""
    if not model_name:
        return {"compacted": False, "reason": "no model configured for this chat"}

    prompt = (
        "Summarise the following conversation so a fresh agent could pick up "
        "where we left off. Preserve: open tasks, decisions made, files mentioned, "
        "constraints, and any user preferences. Drop chit-chat and verbose tool "
        "output. Write in second person addressing the future agent. Markdown is "
        "fine. Aim for 8–15 short bullets max.\n\n"
        f"=== CONVERSATION ===\n{transcript}\n=== END ==="
    )

    try:
        from clawagents.config.config import load_config
        from clawagents.providers.llm import LLMMessage, create_provider
        config = load_config()
        provider = create_provider(model_name, config)
        resp = await provider.chat(
            messages=[LLMMessage(role="user", content=prompt)],
            tools=None,
        )
        summary = (resp.content or "").strip()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"summary call failed: {exc}")

    if not summary:
        raise HTTPException(status_code=502, detail="model returned an empty summary")

    # Back up the original JSONL before rewriting.
    backup_path = path.with_suffix(path.suffix + f".before-compact-{int(time.time())}")
    try:
        backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"backup failed: {exc}")

    # Rebuild: chat_meta + synthetic user + synthetic assistant carrying the summary.
    sessions_dir = path.parent
    from clawagents.utils.atomic_write import atomic_write_text
    atomic_write_text(path, "")  # truncate
    writer = SessionWriter(session_id=chat_id, session_dir=sessions_dir)
    writer.write_chat_meta(
        title=meta["title"],
        model=meta["model"],
        mode=meta["mode"],
        pinned=bool(meta.get("pinned")),
    )
    writer.append("user_message", {"content": "Continue from this summary."})
    writer.write_assistant_message(
        f"_[Summary of compacted conversation]_\n\n{summary}"
    )

    return {
        "compacted": True,
        "summary_chars": len(summary),
        "backup_path": str(backup_path),
        "project_id": project_id,
    }


@router.post("/chats/{chat_id}/fork", status_code=201)
def fork_chat(chat_id: str) -> dict:
    """Clone the chat's JSONL into a brand-new chat id.

    The new chat lives in the same directory (project-scoped or projectless,
    same as the source) and gets a `[fork] ` prefix on its title so it's easy
    to spot in the sidebar. The user can then edit/retry or continue freely
    without affecting the original.
    """
    src_path, project_id = _resolve_chat(chat_id)
    new_id = f"chat-{uuid.uuid4().hex[:12]}"
    dst_path = src_path.parent / f"{new_id}.jsonl"
    try:
        src_text = src_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"unable to read source chat: {exc}")

    # Bump the chat_meta title so the fork is distinguishable. We append a new
    # chat_meta line so the source's append-only invariant isn't violated.
    current_meta = _read_chat_meta(src_path)
    forked_title = current_meta["title"]
    if not forked_title.startswith("[fork] "):
        forked_title = f"[fork] {forked_title}"

    from clawagents.utils.atomic_write import atomic_write_text
    atomic_write_text(dst_path, src_text)
    fork_writer = SessionWriter(session_id=new_id, session_dir=src_path.parent)
    fork_writer.write_chat_meta(
        title=forked_title,
        model=current_meta["model"],
        mode=current_meta["mode"],
        pinned=False,  # Forks start unpinned even if the source was pinned.
    )
    return {"chat_id": new_id, "project_id": project_id, "title": forked_title}


@router.post("/chats/{chat_id}/truncate-after-last-user-message")
def truncate_after_last_user_message(chat_id: str) -> dict:
    """Drop the trailing assistant/tool exchange so the user can retry their
    last prompt with a different agent response.

    JSONL is otherwise append-only; this is the one place we rewrite it. The
    truncation point is the index of the LAST `user_message` event — that and
    everything after it disappear, taking the assistant_message, tool_call,
    tool_result, usage, and turn_completed events with them. The next
    POST /chats/{chat_id}/messages re-issues the (possibly edited) prompt as
    a fresh turn against the cleaned-up history.
    """
    path, _ = _resolve_chat(chat_id)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"unable to read chat: {exc}")

    lines = text.splitlines()
    last_user_idx = -1
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "user_message":
            last_user_idx = i

    if last_user_idx == -1:
        # Nothing to retry from — no user message recorded yet.
        return {"truncated": 0}

    kept = lines[:last_user_idx]
    new_text = "\n".join(kept) + ("\n" if kept else "")
    from clawagents.utils.atomic_write import atomic_write_text
    atomic_write_text(path, new_text)
    return {"truncated": len(lines) - len(kept)}
