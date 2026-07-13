"""Chat templates: saved seeds you can spawn a new chat from.

Stored as `.md` files in `app_support/templates/`. Same simple structure as
custom commands — optional `--- description: ... ---` frontmatter, then
markdown body that becomes the first user message of the new chat.

Endpoints:
  GET    /templates              — list templates
  PUT    /templates/{name}       — create / replace
  DELETE /templates/{name}       — remove
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from clawagents.desktop_stores.app_paths import user_templates_dir
from clawagents.gateway.desktop_router import require_auth
from clawagents.utils.atomic_write import atomic_write_text

router = APIRouter(tags=["templates"], dependencies=[require_auth()])

_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")


def _parse(path: Path) -> dict | None:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    description = ""
    body = raw
    if raw.startswith("---"):
        end = raw.find("---", 3)
        if end != -1:
            block = raw[3:end].strip().splitlines()
            for line in block:
                if ":" in line:
                    k, _, v = line.partition(":")
                    if k.strip().lower() == "description":
                        description = v.strip()
            body = raw[end + 3:].lstrip()
    return {
        "name": path.stem,
        "description": description or "Chat template",
        "body": body.strip(),
    }


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="name must match [a-z][a-z0-9_-]{0,40}",
        )


def _render_md(description: str, body: str) -> str:
    desc = description.strip()
    body_stripped = body.strip()
    if desc:
        desc_one_line = " ".join(desc.split())
        return f"---\ndescription: {desc_one_line}\n---\n{body_stripped}\n"
    return f"{body_stripped}\n"


@router.get("/templates")
def list_templates() -> list[dict]:
    d = user_templates_dir()
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.md")):
        parsed = _parse(p)
        if parsed is not None:
            out.append(parsed)
    return out


class TemplateBody(BaseModel):
    description: str = ""
    body: str


@router.put("/templates/{name}")
def upsert_template(name: str, body: TemplateBody) -> dict:
    _validate_name(name)
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="body cannot be empty")
    d = user_templates_dir()
    d.mkdir(parents=True, exist_ok=True)
    atomic_write_text(d / f"{name}.md", _render_md(body.description, body.body))
    parsed = _parse(d / f"{name}.md")
    if parsed is None:
        raise HTTPException(status_code=500, detail="failed to read back template")
    return parsed


@router.delete("/templates/{name}", status_code=204)
def delete_template(name: str) -> Response:
    _validate_name(name)
    path = user_templates_dir() / f"{name}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"template {name} not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"failed to delete: {exc}")
    return Response(status_code=204)
