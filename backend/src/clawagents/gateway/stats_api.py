"""Aggregate token + cost statistics across all chats.

Walks every chat JSONL, sums `usage` events, and returns per-project +
overall totals. Cost is computed by the client (using its prices table) —
the gateway only returns token counts and model names so we don't bake
pricing data into the backend.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter

from clawagents.desktop_stores.app_paths import projectless_chats_dir
from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["stats"], dependencies=[require_auth()])


def _scan_jsonl(path: Path) -> dict[str, dict]:
    """Return a map of `model -> usage totals` for one chat JSONL."""
    per_model: dict[str, dict] = defaultdict(lambda: {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cached_input_tokens": 0,
        "cache_creation_tokens": 0,
        "turns": 0,
    })
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
                t = ev.get("type")
                if t == "usage":
                    model = str(ev.get("model") or "unknown")
                    bucket = per_model[model]
                    bucket["input_tokens"] += int(ev.get("input_tokens") or 0)
                    bucket["output_tokens"] += int(ev.get("output_tokens") or 0)
                    bucket["total_tokens"] += int(ev.get("total_tokens") or 0)
                    bucket["cached_input_tokens"] += int(ev.get("cached_input_tokens") or 0)
                    bucket["cache_creation_tokens"] += int(ev.get("cache_creation_tokens") or 0)
                elif t == "turn_completed":
                    # Charge the turn against whichever model was active.
                    # We approximate "active model" as the most recently
                    # observed `usage.model`; if no usage events have fired
                    # yet, fall back to "unknown".
                    if per_model:
                        last_model = next(reversed(per_model))
                        per_model[last_model]["turns"] += 1
                    else:
                        per_model["unknown"]["turns"] += 1
    except OSError:
        pass
    return per_model


def _merge(into: dict[str, dict], extra: dict[str, dict]) -> None:
    for model, vals in extra.items():
        bucket = into.setdefault(model, {
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
            "cached_input_tokens": 0, "cache_creation_tokens": 0, "turns": 0,
        })
        for k in bucket:
            bucket[k] += vals.get(k, 0)


@router.get("/stats/usage")
def usage_stats() -> dict:
    """Return per-project, projectless, and grand-total usage breakdowns."""
    overall: dict[str, dict] = {}
    projects_out: list[dict] = []

    for project in ProjectStore().list():
        per_model: dict[str, dict] = {}
        sessions_dir = Path(project.root_path) / ".clawagents" / "sessions"
        if sessions_dir.exists():
            for path in sessions_dir.glob("*.jsonl"):
                _merge(per_model, _scan_jsonl(path))
        projects_out.append({
            "project_id": project.id,
            "project_name": project.name,
            "by_model": per_model,
        })
        _merge(overall, per_model)

    projectless_per_model: dict[str, dict] = {}
    pl_dir = projectless_chats_dir()
    if pl_dir.exists():
        for path in pl_dir.glob("*.jsonl"):
            _merge(projectless_per_model, _scan_jsonl(path))
    _merge(overall, projectless_per_model)

    return {
        "overall": overall,
        "projectless": projectless_per_model,
        "projects": projects_out,
    }
