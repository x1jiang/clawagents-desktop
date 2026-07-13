"""REST router for desktop Project CRUD."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore
from clawagents.desktop_stores.project_store import (
    ProjectNotFoundError,
    ProjectStore,
)
from clawagents.gateway.desktop_router import require_auth, require_auth_with_query_token

router = APIRouter(tags=["projects"], dependencies=[require_auth()])
# Separate router for endpoints that accept token-in-URL auth (so `<img src>`
# can resolve them). Same router root, just a different dependency.
img_router = APIRouter(tags=["projects"], dependencies=[require_auth_with_query_token()])


class ProjectCreateBody(BaseModel):
    name: str
    root_path: str
    default_model: str | None = None
    default_mode: str | None = None
    system_prompt: str | None = None
    env_vars: dict[str, str] | None = None
    kind: str = "local"
    ssh_host: str | None = None
    remote_path: str | None = None
    # When set, upsert with this fixed id (used to seed the same UUID on a
    # remote gateway so the Mac UI and remote store share project identity).
    id: str | None = None


class ProjectPatchBody(BaseModel):
    name: str | None = None
    default_model: str | None = None
    default_mode: str | None = None
    system_prompt: str | None = None
    env_vars: dict[str, str] | None = None
    pinned: bool | None = None


@router.get("/projects")
def list_projects() -> list[dict]:
    return [asdict(p) for p in ProjectStore().list()]


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreateBody) -> dict:
    kind = (body.kind or "local").strip().lower() or "local"
    store = ProjectStore()
    try:
        if body.id:
            p = store.upsert(
                id=body.id,
                name=body.name,
                root_path=body.root_path,
                default_model=body.default_model,
                default_mode=body.default_mode,
                system_prompt=body.system_prompt,
                env_vars=body.env_vars,
                kind=kind,
                ssh_host=body.ssh_host,
                remote_path=body.remote_path,
            )
        elif kind == "ssh":
            remote = (body.remote_path or body.root_path or "").strip()
            if not (body.ssh_host or "").strip() or not remote:
                raise HTTPException(
                    status_code=400,
                    detail="ssh projects require ssh_host and remote_path",
                )
            p = store.create(
                name=body.name,
                root_path=remote,
                default_model=body.default_model,
                default_mode=body.default_mode,
                system_prompt=body.system_prompt,
                env_vars=body.env_vars,
                kind="ssh",
                ssh_host=body.ssh_host,
                remote_path=remote,
            )
        else:
            if not Path(body.root_path).exists():
                raise HTTPException(
                    status_code=400,
                    detail=f"root_path does not exist: {body.root_path}",
                )
            p = store.create(
                name=body.name,
                root_path=body.root_path,
                default_model=body.default_model,
                default_mode=body.default_mode,
                system_prompt=body.system_prompt,
                env_vars=body.env_vars,
                kind="local",
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"root_path does not exist: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return asdict(p)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatchBody) -> dict:
    # Pydantic v2: detect which keys the client actually sent so we can
    # distinguish "leave system_prompt alone" from "clear it" (both look like
    # None on the body otherwise).
    sent = body.model_fields_set
    try:
        kwargs: dict = {
            "name": body.name,
            "default_model": body.default_model,
            "default_mode": body.default_mode,
        }
        if "system_prompt" in sent:
            kwargs["system_prompt"] = body.system_prompt
        if "env_vars" in sent:
            kwargs["env_vars"] = body.env_vars
        if "pinned" in sent:
            kwargs["pinned"] = body.pinned
        return asdict(ProjectStore().update(project_id, **kwargs))
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    try:
        ProjectStore().delete(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    PermissionGrantStore().remove_for_project(project_id)
    return Response(status_code=204)


@router.get("/projects/{project_id}/permission-grants")
def list_project_permission_grants(project_id: str) -> list[dict]:
    """Return all permission grants for a project (newest first)."""
    try:
        ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    grants = [
        asdict(g) for g in PermissionGrantStore().list() if g.project_id == project_id
    ]
    grants.sort(key=lambda g: g["granted_at"], reverse=True)
    return grants


class GrantRevokeBody(BaseModel):
    path_pattern: str
    scope: str


class GrantAddBody(BaseModel):
    path_pattern: str
    scope: str = "write"


@router.post("/projects/{project_id}/permission-grants", status_code=201)
def add_project_permission_grant(project_id: str, body: GrantAddBody) -> dict:
    """Pre-define an "allow always" pattern so the agent doesn't prompt for
    matching paths. Use fnmatch-style globs (e.g. `src/**/*.py`).
    """
    try:
        ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    if body.scope not in ("read", "write"):
        raise HTTPException(status_code=400, detail="scope must be 'read' or 'write'")
    pattern = body.path_pattern.strip()
    if not pattern:
        raise HTTPException(status_code=400, detail="path_pattern required")
    grant = PermissionGrantStore().add(
        project_id=project_id, path_pattern=pattern, scope=body.scope,
    )
    from dataclasses import asdict as _asdict
    return _asdict(grant)


@router.post("/projects/{project_id}/permission-grants/revoke")
def revoke_project_permission_grant(project_id: str, body: GrantRevokeBody) -> dict:
    """Revoke a specific permission grant. 404 if no match."""
    try:
        ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    removed = PermissionGrantStore().remove_one(
        project_id=project_id, path_pattern=body.path_pattern, scope=body.scope
    )
    if not removed:
        raise HTTPException(status_code=404, detail="grant not found")
    return {"ok": True}


@router.delete("/projects/{project_id}/permission-grants", status_code=204)
def revoke_all_project_permission_grants(project_id: str) -> Response:
    try:
        ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    PermissionGrantStore().remove_for_project(project_id)
    return Response(status_code=204)


# ─── Project files (for @-mention autocomplete) ────────────────────────

# Skip these noisy/large directories to keep the listing snappy on big repos.
_FILE_LIST_SKIP_DIRS = frozenset({
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    "dist", "build", ".next", "target", ".cargo", ".idea", ".vscode",
    ".clawagents",
})

_FILE_LIST_LIMIT = 200


@router.get("/projects/{project_id}/files")
def list_project_files(project_id: str, q: str = "") -> list[dict]:
    """List files in the project root, optionally filtered by substring.

    Designed for @-mention autocomplete in the composer. Limited to
    {_FILE_LIST_LIMIT} results so even large repos stay responsive.
    """
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    root = Path(project.root_path)
    if not root.exists():
        return []

    needle = q.lower()
    out: list[dict] = []

    for dirpath, dirnames, filenames in __import__("os").walk(root):
        # Mutate dirnames in place to prune traversal.
        dirnames[:] = [d for d in dirnames if d not in _FILE_LIST_SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            if f.startswith("."):
                continue
            full = Path(dirpath) / f
            try:
                rel = full.relative_to(root).as_posix()
            except ValueError:
                continue
            if needle and needle not in rel.lower():
                continue
            out.append({"path": rel})
            if len(out) >= _FILE_LIST_LIMIT:
                # Sort by depth (shallower first) then alphabetically for a
                # predictable order before returning.
                out.sort(key=lambda r: (r["path"].count("/"), r["path"]))
                return out

    out.sort(key=lambda r: (r["path"].count("/"), r["path"]))
    return out


_PREVIEW_MAX_BYTES = 4_000
_EDIT_MAX_BYTES = 2 * 1024 * 1024  # 2 MB — editor panel read/write cap


def _resolve_project_file(project_id: str, path: str) -> Path:
    """Resolve ``path`` under the project root, or raise HTTPException."""
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    root = Path(project.root_path).resolve()
    if not root.exists():
        raise HTTPException(status_code=404, detail="project root missing on disk")

    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes project root")
    return candidate


class FileWriteBody(BaseModel):
    path: str
    content: str
_GIT_OUTPUT_MAX_CHARS = 30_000
_RECENT_FILES_LIMIT = 25


@router.get("/projects/{project_id}/files/recent")
def list_recent_project_files(project_id: str) -> list[dict]:
    """Return up to {_RECENT_FILES_LIMIT} recently-modified files in the
    project root, newest first. Useful for a "what changed lately?" panel
    on the project landing page.
    """
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    root = Path(project.root_path)
    if not root.exists():
        return []

    import os as _os
    found: list[tuple[float, Path]] = []
    for dirpath, dirnames, filenames in _os.walk(root):
        # Reuse the same skip-set as the file listing endpoint.
        dirnames[:] = [d for d in dirnames if d not in _FILE_LIST_SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            if f.startswith("."):
                continue
            full = Path(dirpath) / f
            try:
                mtime = full.stat().st_mtime
            except OSError:
                continue
            found.append((mtime, full))

    found.sort(key=lambda r: r[0], reverse=True)
    out: list[dict] = []
    for mtime, full in found[:_RECENT_FILES_LIMIT]:
        try:
            rel = full.relative_to(root).as_posix()
        except ValueError:
            continue
        out.append({"path": rel, "mtime": mtime})
    return out


@router.get("/projects/{project_id}/git/status")
def project_git_status(project_id: str) -> dict:
    """Return `git status -sb` + `git diff` (HEAD vs working tree) for a project.

    Read-only — never mutates the repo. Cleanly degrades when the project root
    isn't a git repo. Each subprocess capped at ~30K chars so we don't OOM the
    gateway on a really large diff.
    """
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    import subprocess
    root = Path(project.root_path)
    if not root.exists():
        raise HTTPException(status_code=404, detail="project root missing on disk")

    def run(cmd: list[str]) -> tuple[bool, str]:
        try:
            r = subprocess.run(
                cmd, cwd=str(root), capture_output=True, text=True, timeout=10,
            )
            if r.returncode != 0:
                return False, (r.stderr or r.stdout or "").strip()[:1000]
            return True, r.stdout
        except (subprocess.SubprocessError, OSError) as exc:
            return False, str(exc)[:200]

    ok, head = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if not ok:
        return {"is_repo": False, "error": head}

    ok_status, status_out = run(["git", "status", "-sb"])
    ok_diff, diff_out = run(["git", "diff", "--no-color"])

    def truncate(s: str) -> tuple[str, bool]:
        if len(s) > _GIT_OUTPUT_MAX_CHARS:
            return s[:_GIT_OUTPUT_MAX_CHARS] + "\n…\n", True
        return s, False

    status_out, status_truncated = truncate(status_out if ok_status else "")
    diff_out, diff_truncated = truncate(diff_out if ok_diff else "")

    return {
        "is_repo": True,
        "branch": head.strip(),
        "status": status_out,
        "status_truncated": status_truncated,
        "diff": diff_out,
        "diff_truncated": diff_truncated,
    }


@router.get("/projects/{project_id}/tree")
def list_project_tree(project_id: str) -> dict:
    """Return the project's directory tree (sans noisy/skip dirs).

    Shape: { "name": str, "type": "dir", "children": [<node>, ...] }
    Leaf nodes: { "name": str, "type": "file" }
    Children are sorted: directories first, then alphabetical.
    """
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    root = Path(project.root_path)
    if not root.exists():
        return {"name": project.name, "type": "dir", "children": []}

    def walk(p: Path) -> dict:
        children: list[dict] = []
        try:
            entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
        except OSError:
            return {"name": p.name, "type": "dir", "children": []}
        for entry in entries:
            if entry.name.startswith(".") and entry.name not in {".clawagents"}:
                continue
            if entry.is_dir():
                if entry.name in _FILE_LIST_SKIP_DIRS:
                    continue
                children.append(walk(entry))
            else:
                children.append({"name": entry.name, "type": "file"})
        return {"name": p.name, "type": "dir", "children": children}

    tree = walk(root)
    tree["name"] = project.name  # use the friendly name, not the root folder
    return tree


@router.get("/projects/{project_id}/files/preview")
def preview_project_file(project_id: str, path: str) -> dict:
    """Return a short preview of a single file inside the project root.

    Used by the @-mention hover popup so the user can see what they're about
    to reference. Refuses any path that resolves outside the project root
    (path-traversal guard). Reads at most {_PREVIEW_MAX_BYTES} bytes.
    """
    candidate = _resolve_project_file(project_id, path)
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="file not found")
    if not candidate.is_file():
        raise HTTPException(status_code=400, detail="not a regular file")

    try:
        size = candidate.stat().st_size
        with candidate.open("rb") as f:
            raw = f.read(_PREVIEW_MAX_BYTES + 1)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"read failed: {exc}")

    truncated = size > _PREVIEW_MAX_BYTES
    payload = raw[:_PREVIEW_MAX_BYTES]
    try:
        content = payload.decode("utf-8")
        binary = False
    except UnicodeDecodeError:
        # Surface a tiny hint instead of binary garbage.
        content = "(binary file)"
        binary = True

    return {
        "path": path,
        "size": size,
        "truncated": truncated,
        "binary": binary,
        "content": content,
    }


@router.get("/projects/{project_id}/files/content")
def read_project_file(project_id: str, path: str) -> dict:
    """Return file contents for the in-app editor panel (up to 2 MB)."""
    candidate = _resolve_project_file(project_id, path)
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="file not found")
    if not candidate.is_file():
        raise HTTPException(status_code=400, detail="not a regular file")

    try:
        size = candidate.stat().st_size
        with candidate.open("rb") as f:
            raw = f.read(_EDIT_MAX_BYTES + 1)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"read failed: {exc}")

    truncated = len(raw) > _EDIT_MAX_BYTES or size > _EDIT_MAX_BYTES
    payload = raw[:_EDIT_MAX_BYTES]
    try:
        content = payload.decode("utf-8")
        binary = False
    except UnicodeDecodeError:
        content = ""
        binary = True

    return {
        "path": path,
        "size": size,
        "truncated": truncated,
        "binary": binary,
        "content": content,
        "writable": not binary and not truncated,
    }


@router.put("/projects/{project_id}/files/content")
def write_project_file(project_id: str, body: FileWriteBody) -> dict:
    """Write UTF-8 text to a project file (editor autosave)."""
    if len(body.content.encode("utf-8")) > _EDIT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large to write via editor")

    candidate = _resolve_project_file(project_id, body.path)
    if candidate.exists() and not candidate.is_file():
        raise HTTPException(status_code=400, detail="not a regular file")
    if candidate.parent and not candidate.parent.exists():
        raise HTTPException(status_code=404, detail="parent directory missing")

    tmp = candidate.with_name(candidate.name + ".clawagents-tmp")
    try:
        tmp.write_text(body.content, encoding="utf-8")
        tmp.replace(candidate)
    except OSError as exc:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"write failed: {exc}")

    size = candidate.stat().st_size
    return {"path": body.path, "size": size, "ok": True}


_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}
_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
}
_SERVE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB — generous for project images.


@img_router.get("/projects/{project_id}/files/serve")
def serve_project_file(project_id: str, path: str) -> Response:
    """Stream the raw bytes of a project file (images only).

    Used by Markdown's `<img>` rewriter so the agent can produce reports
    with embedded screenshots / photos. Auth is via header *or* `?token=`
    so headerless `<img>` requests work. Path-jailed inside project root;
    extension allow-list keeps it from doubling as an exfil channel.
    """
    try:
        project = ProjectStore().get(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")

    root = Path(project.root_path).resolve()
    if not root.exists():
        raise HTTPException(status_code=404, detail="project root missing on disk")

    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes project root")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    ext = candidate.suffix.lower()
    if ext not in _IMAGE_EXTS:
        raise HTTPException(status_code=415, detail=f"only image types served; {ext!r} is not one")

    size = candidate.stat().st_size
    if size > _SERVE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"file too large ({size} bytes)")

    try:
        data = candidate.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"read failed: {exc}")

    return Response(content=data, media_type=_MIME_BY_EXT[ext])
