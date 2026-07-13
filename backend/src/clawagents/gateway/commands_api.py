"""User-defined slash commands.

Each `.md` file in `app_support/commands/` becomes a `/<filename>` command.
The body of the file is sent to the agent verbatim when invoked. A short
header `--- description: <text> ---` is parsed if present so the autocomplete
popup can show a useful blurb.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from clawagents.desktop_stores.app_paths import user_commands_dir
from clawagents.gateway.desktop_router import require_auth
from clawagents.utils.atomic_write import atomic_write_text

router = APIRouter(tags=["commands"], dependencies=[require_auth()])


# Names map directly to filenames so we lock them down to a safe slug.
_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")


def _parse(path: Path) -> dict | None:
    """Read one .md file. Returns None on read failure."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    description = ""
    body = raw
    # Optional frontmatter: `--- description: ... ---` on the first lines.
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
        "description": description or "Custom command",
        "body": body.strip(),
    }


@router.get("/commands")
def list_commands() -> list[dict]:
    """Return all user-defined slash commands, alphabetically by name."""
    d = user_commands_dir()
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("*.md")):
        parsed = _parse(p)
        if parsed is not None:
            out.append(parsed)
    return out


class CommandBody(BaseModel):
    description: str = ""
    body: str


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="name must match [a-z][a-z0-9_-]{0,40}",
        )


def _render_md(description: str, body: str) -> str:
    """Format a command as an .md file. Empty description means no frontmatter."""
    desc = description.strip()
    body_stripped = body.strip()
    if desc:
        # Strip newlines in description so the frontmatter stays single-line-safe.
        desc_one_line = " ".join(desc.split())
        return f"---\ndescription: {desc_one_line}\n---\n{body_stripped}\n"
    return f"{body_stripped}\n"


@router.put("/commands/{name}")
def upsert_command(name: str, body: CommandBody) -> dict:
    """Create or replace a user command. Idempotent — same name overwrites."""
    _validate_name(name)
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="body cannot be empty")
    d = user_commands_dir()
    d.mkdir(parents=True, exist_ok=True)
    atomic_write_text(d / f"{name}.md", _render_md(body.description, body.body))
    parsed = _parse(d / f"{name}.md")
    if parsed is None:
        raise HTTPException(status_code=500, detail="failed to read back command")
    return parsed


@router.delete("/commands/{name}", status_code=204)
def delete_command(name: str) -> Response:
    _validate_name(name)
    path = user_commands_dir() / f"{name}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"command {name} not found")
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"failed to delete: {exc}")
    return Response(status_code=204)
