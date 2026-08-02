"""Read-only Memory browser over workspace `.clawagents/` artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from clawagents.desktop_stores.project_store import ProjectNotFoundError, ProjectStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["memory"], dependencies=[require_auth()])

_PREVIEW_CHARS = 1200


def _registered_project_roots() -> set[Path]:
    roots: set[Path] = set()
    try:
        for project in ProjectStore().list():
            try:
                roots.add(Path(project.root_path).expanduser().resolve())
            except OSError:
                continue
    except Exception:  # noqa: BLE001
        return roots
    return roots


def _project_root(project_id: str | None, root_path: str | None) -> Path:
    """Resolve workspace root. Prefer project_id; root_path must match a registered project."""
    if project_id:
        try:
            project = ProjectStore().get(project_id)
        except ProjectNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        root = Path(project.root_path).expanduser().resolve()
    elif root_path:
        root = Path(root_path).expanduser().resolve()
        if root not in _registered_project_roots():
            raise HTTPException(
                status_code=400,
                detail="root_path must match a registered project (use project_id)",
            )
    else:
        raise HTTPException(status_code=400, detail="project_id required")
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"root {root} is not a directory")
    return root


def _stat_row(path: Path, *, rel: str, kind: str, label: str) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        st = path.stat()
    except OSError:
        return None
    preview = ""
    if path.is_file() and st.st_size <= 256_000:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            preview = text[:_PREVIEW_CHARS]
        except OSError:
            preview = ""
    return {
        "kind": kind,
        "label": label,
        "path": rel,
        "exists": True,
        "is_dir": path.is_dir(),
        "size": st.st_size if path.is_file() else None,
        "mtime": st.st_mtime,
        "preview": preview,
    }


def _list_dir_entries(directory: Path, *, rel_prefix: str, kind: str, limit: int = 40) -> list[dict[str, Any]]:
    if not directory.is_dir():
        return []
    rows: list[tuple[float, dict[str, Any]]] = []
    try:
        children = list(directory.iterdir())
    except OSError:
        return []
    for child in children:
        if child.name.startswith(".") and child.name not in (".", ".."):
            # Keep normal hidden files out; workshop/system dirs are requested explicitly.
            if child.name not in ("clawagents",):
                pass
        try:
            st = child.stat()
        except OSError:
            continue
        rel = f"{rel_prefix}/{child.name}".replace("//", "/")
        rows.append((
            st.st_mtime,
            {
                "kind": kind,
                "label": child.name,
                "path": rel,
                "exists": True,
                "is_dir": child.is_dir(),
                "size": st.st_size if child.is_file() else None,
                "mtime": st.st_mtime,
                "preview": "",
            },
        ))
    rows.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in rows[:limit]]


@router.get("/memory/overview")
def memory_overview(
    project_id: str | None = Query(default=None),
    root_path: str | None = Query(default=None),
) -> dict[str, Any]:
    """Aggregate durable memory artifacts under `.clawagents/` for the Memory browser."""
    root = _project_root(project_id, root_path)
    claw = root / ".clawagents"
    artifacts: list[dict[str, Any]] = []

    durable_specs = [
        (claw / "MEMORY.md", ".clawagents/MEMORY.md", "durable", "MEMORY.md (dream)"),
        (claw / "core-memory.md", ".clawagents/core-memory.md", "durable", "Core memory"),
        (claw / "facts.jsonl", ".clawagents/facts.jsonl", "durable", "Facts store"),
        (claw / "context-ledger.md", ".clawagents/context-ledger.md", "durable", "Context ledger"),
        (claw / "dream_state.json", ".clawagents/dream_state.json", "durable", "Dream state"),
        (claw / "smart_memory.sqlite3", ".clawagents/smart_memory.sqlite3", "durable", "Smart memory index"),
    ]
    for path, rel, kind, label in durable_specs:
        row = _stat_row(path, rel=rel, kind=kind, label=label)
        if row:
            artifacts.append(row)

    bank = claw / "memory-bank"
    for name in ("product.md", "tech.md", "progress.md", "decisions.md"):
        row = _stat_row(
            bank / name,
            rel=f".clawagents/memory-bank/{name}",
            kind="memory_bank",
            label=f"Memory bank · {name}",
        )
        if row:
            artifacts.append(row)

    artifacts.extend(
        _list_dir_entries(
            claw / "memory-sessions",
            rel_prefix=".clawagents/memory-sessions",
            kind="session_log",
        )
    )
    artifacts.extend(
        _list_dir_entries(
            claw / "compaction",
            rel_prefix=".clawagents/compaction",
            kind="compaction",
        )
    )
    artifacts.extend(
        _list_dir_entries(
            claw / "history",
            rel_prefix=".clawagents/history",
            kind="history",
        )
    )
    artifacts.extend(
        _list_dir_entries(
            claw / "transcripts",
            rel_prefix=".clawagents/transcripts",
            kind="transcript",
        )
    )
    artifacts.extend(
        _list_dir_entries(
            claw / "hunks",
            rel_prefix=".clawagents/hunks",
            kind="hunks",
            limit=20,
        )
    )
    artifacts.extend(
        _list_dir_entries(
            claw / "context-observatory",
            rel_prefix=".clawagents/context-observatory",
            kind="observatory",
            limit=20,
        )
    )

    facts_live: list[dict[str, Any]] = []
    facts_path = claw / "facts.jsonl"
    if facts_path.is_file():
        try:
            from dataclasses import asdict

            from clawagents.memory.facts import list_facts

            facts_live = [asdict(f) for f in list_facts(workspace=root, live_only=True)[:40]]
        except Exception:  # noqa: BLE001
            try:
                lines = [
                    ln for ln in facts_path.read_text(encoding="utf-8").splitlines() if ln.strip()
                ][-20:]
                for ln in lines:
                    try:
                        facts_live.append(json.loads(ln))
                    except json.JSONDecodeError:
                        continue
            except OSError:
                pass

    return {
        "ok": True,
        "workspace": str(root),
        "clawagents_dir": str(claw),
        "clawagents_exists": claw.is_dir(),
        "artifacts": artifacts,
        "facts": facts_live,
        "counts": {
            "artifacts": len(artifacts),
            "facts": len(facts_live),
            "session_logs": sum(1 for a in artifacts if a["kind"] == "session_log"),
            "compaction": sum(1 for a in artifacts if a["kind"] == "compaction"),
        },
    }


@router.get("/memory/file")
def memory_file(
    path: str = Query(..., min_length=1),
    project_id: str | None = Query(default=None),
    root_path: str | None = Query(default=None),
    max_chars: int = Query(default=80_000, ge=1000, le=500_000),
) -> dict[str, Any]:
    """Read a `.clawagents/` text file for the Memory browser."""
    root = _project_root(project_id, root_path)
    rel = path.strip().lstrip("/")
    if ".." in Path(rel).parts:
        raise HTTPException(status_code=400, detail="path escapes workspace")
    if not (rel.startswith(".clawagents/") or rel == ".clawagents"):
        raise HTTPException(status_code=400, detail="only .clawagents paths are readable here")
    target = (root / rel).resolve()
    try:
        target.relative_to((root / ".clawagents").resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="path escapes .clawagents") from exc
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if target.suffix.lower() in {".sqlite3", ".db", ".bin"}:
        raise HTTPException(status_code=400, detail="binary memory index — use Search instead")
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    truncated = len(text) > max_chars
    return {
        "ok": True,
        "path": rel,
        "content": text[:max_chars],
        "truncated": truncated,
        "size": target.stat().st_size,
        "mtime": target.stat().st_mtime,
    }


class MemorySearchBody(BaseModel):
    project_id: str | None = None
    root_path: str | None = None
    query: str = Field(..., min_length=1)
    limit: int = Field(default=12, ge=1, le=40)


@router.post("/memory/search")
def memory_search(body: MemorySearchBody) -> dict[str, Any]:
    root = _project_root(body.project_id, body.root_path)
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query required")
    try:
        from clawagents.memory.smart_store import MemorySearchConfig, search_memories

        hits = search_memories(
            query,
            workspace=str(root),
            config=MemorySearchConfig(max_results=body.limit),
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "hits": []}
    out: list[dict[str, Any]] = []
    for hit in hits or []:
        if isinstance(hit, dict):
            out.append(hit)
            continue
        out.append({
            "text": str(getattr(hit, "snippet", "") or getattr(hit, "text", "")),
            "score": getattr(hit, "score", None),
            "source": getattr(hit, "source", None),
            "path": getattr(hit, "path", None),
            "chunk_id": getattr(hit, "chunk_id", None),
        })
    return {"ok": True, "query": query, "hits": out}


# ─── Pinned context ──────────────────────────────────────────────────────
#
# Short, always-on instructions the user edits inline ("use .venv312", "the
# staging DB is read-only this week"). The engine already discovers
# `.clawagents/pinned-context.md` as a rules source and leads the injected
# block with it; these two routes are the editing surface.
#
# It is a plain file, not app state, so it stays diffable, survives outside
# the app, and is picked up by every ClawAgents front end.

_PINNED_MAX_CHARS = 4_000


class PinnedContextBody(BaseModel):
    project_id: str | None = None
    root_path: str | None = None
    text: str = Field(default="", max_length=100_000)


@router.get("/memory/pinned-context")
def get_pinned_context(
    project_id: str | None = Query(default=None),
    root_path: str | None = Query(default=None),
) -> dict[str, Any]:
    root = _project_root(project_id, root_path)
    from clawagents.memory.rules import pinned_context_path, read_pinned_context

    text = read_pinned_context(str(root))
    return {
        "ok": True,
        "text": text,
        "chars": len(text),
        "max_chars": _PINNED_MAX_CHARS,
        "path": str(pinned_context_path(str(root))),
    }


@router.put("/memory/pinned-context")
def put_pinned_context(body: PinnedContextBody) -> dict[str, Any]:
    root = _project_root(body.project_id, body.root_path)
    from clawagents.memory.rules import pinned_context_path, write_pinned_context

    # write_pinned_context truncates rather than rejecting, and returns what it
    # actually stored — echo that back so the editor shows the real state
    # instead of the text the user thought they saved. Clearing removes the
    # file entirely.
    stored = write_pinned_context(body.text, str(root), max_chars=_PINNED_MAX_CHARS)
    return {
        "ok": True,
        "text": stored,
        "chars": len(stored),
        "max_chars": _PINNED_MAX_CHARS,
        "truncated": len((body.text or "").strip()) > len(stored),
        "path": str(pinned_context_path(str(root))),
    }
