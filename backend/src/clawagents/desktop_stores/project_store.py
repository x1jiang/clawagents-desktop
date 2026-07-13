"""File-backed CRUD for desktop Project records."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from clawagents.desktop_stores.app_paths import projects_file
from clawagents.utils.atomic_write import atomic_write_text


class ProjectNotFoundError(KeyError):
    pass


@dataclass
class Project:
    id: str
    name: str
    root_path: str
    default_model: str | None = None
    default_mode: str | None = None
    system_prompt: str | None = None
    env_vars: dict[str, str] | None = None
    pinned: bool = False
    created_at: str = ""
    last_used_at: str = ""
    # "local" | "ssh" — ssh projects live on a remote host; root_path is the
    # remote absolute path and is not validated against the Mac filesystem.
    kind: str = "local"
    ssh_host: str | None = None
    remote_path: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _project_from_dict(raw: dict) -> Project:
    known = {f.name for f in fields(Project)}
    return Project(**{k: v for k, v in raw.items() if k in known})


class ProjectStore:
    """Loads projects.json on each operation.

    v1 is single-process, so no inter-process locking. Writes go through
    ``atomic_write_text`` (tempfile + ``os.replace``), so a crash mid-save
    leaves the previous valid file in place rather than a truncated one.
    Reads are tolerant of a corrupt file (return empty list) so a single
    bad write does not permanently brick the store.
    """

    def __init__(self) -> None:
        self.path = projects_file()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> list[Project]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text() or "[]")
            return [_project_from_dict(r) for r in raw]
        except (json.JSONDecodeError, TypeError):
            # Corrupt or schema-incompatible file. Treat as empty rather than
            # crashing every read. The next _save() will overwrite it.
            return []

    def _save(self, projects: Iterable[Project]) -> None:
        atomic_write_text(
            self.path,
            json.dumps([asdict(p) for p in projects], indent=2),
        )

    def list(self) -> list[Project]:
        projects = self._load()
        projects.sort(key=lambda p: p.last_used_at or "", reverse=True)
        return projects

    def get(self, project_id: str) -> Project:
        for p in self._load():
            if p.id == project_id:
                return p
        raise ProjectNotFoundError(project_id)

    def create(
        self,
        *,
        name: str,
        root_path: str,
        default_model: str | None = None,
        default_mode: str | None = None,
        system_prompt: str | None = None,
        env_vars: dict[str, str] | None = None,
        now: str | None = None,
        kind: str = "local",
        ssh_host: str | None = None,
        remote_path: str | None = None,
        id: str | None = None,
    ) -> Project:
        kind = (kind or "local").strip().lower() or "local"
        if kind == "ssh":
            host = (ssh_host or "").strip()
            remote = (remote_path or root_path or "").strip()
            if not host:
                raise ValueError("ssh projects require ssh_host")
            if not remote:
                raise ValueError("ssh projects require remote_path")
            root_path = remote
            ssh_host = host
            remote_path = remote
        else:
            kind = "local"
            ssh_host = None
            remote_path = None
            if not Path(root_path).exists():
                raise FileNotFoundError(root_path)

        ts = now or _now_iso()
        p = Project(
            id=id or str(uuid.uuid4()),
            name=name,
            root_path=root_path,
            default_model=default_model,
            default_mode=default_mode,
            system_prompt=system_prompt,
            env_vars=env_vars,
            created_at=ts,
            last_used_at=ts,
            kind=kind,
            ssh_host=ssh_host,
            remote_path=remote_path,
        )
        projects = self._load()
        if any(existing.id == p.id for existing in projects):
            raise ValueError(f"project id already exists: {p.id}")
        projects.append(p)
        self._save(projects)
        return p

    def upsert(
        self,
        *,
        id: str,
        name: str,
        root_path: str,
        default_model: str | None = None,
        default_mode: str | None = None,
        system_prompt: str | None = None,
        env_vars: dict[str, str] | None = None,
        kind: str = "local",
        ssh_host: str | None = None,
        remote_path: str | None = None,
    ) -> Project:
        """Create or replace a project with a fixed id (remote seed)."""
        kind = (kind or "local").strip().lower() or "local"
        if kind == "ssh":
            host = (ssh_host or "").strip()
            remote = (remote_path or root_path or "").strip()
            if not host or not remote:
                raise ValueError("ssh projects require ssh_host and remote_path")
            root_path = remote
            ssh_host = host
            remote_path = remote
        else:
            kind = "local"
            ssh_host = None
            remote_path = None
            if not Path(root_path).exists():
                raise FileNotFoundError(root_path)

        projects = self._load()
        ts = _now_iso()
        for i, existing in enumerate(projects):
            if existing.id == id:
                updated = Project(
                    id=id,
                    name=name,
                    root_path=root_path,
                    default_model=default_model if default_model is not None else existing.default_model,
                    default_mode=default_mode if default_mode is not None else existing.default_mode,
                    system_prompt=system_prompt if system_prompt is not None else existing.system_prompt,
                    env_vars=env_vars if env_vars is not None else existing.env_vars,
                    pinned=existing.pinned,
                    created_at=existing.created_at or ts,
                    last_used_at=ts,
                    kind=kind,
                    ssh_host=ssh_host,
                    remote_path=remote_path,
                )
                projects[i] = updated
                self._save(projects)
                return updated

        p = Project(
            id=id,
            name=name,
            root_path=root_path,
            default_model=default_model,
            default_mode=default_mode,
            system_prompt=system_prompt,
            env_vars=env_vars,
            created_at=ts,
            last_used_at=ts,
            kind=kind,
            ssh_host=ssh_host,
            remote_path=remote_path,
        )
        projects.append(p)
        self._save(projects)
        return p

    # Sentinel for distinguishing "user explicitly cleared the field" (passes
    # `None`) from "user didn't touch this field at all" (omits the keyword).
    _UNSET = object()

    def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        default_model: str | None = None,
        default_mode: str | None = None,
        system_prompt: object = _UNSET,
        env_vars: object = _UNSET,
        pinned: bool | None = None,
    ) -> Project:
        projects = self._load()
        for i, p in enumerate(projects):
            if p.id == project_id:
                updated = Project(
                    id=p.id,
                    name=name if name is not None else p.name,
                    root_path=p.root_path,
                    default_model=default_model if default_model is not None else p.default_model,
                    default_mode=default_mode if default_mode is not None else p.default_mode,
                    system_prompt=p.system_prompt if system_prompt is self._UNSET else system_prompt,  # type: ignore[arg-type]
                    env_vars=p.env_vars if env_vars is self._UNSET else env_vars,  # type: ignore[arg-type]
                    pinned=p.pinned if pinned is None else pinned,
                    created_at=p.created_at,
                    last_used_at=_now_iso(),
                    kind=p.kind,
                    ssh_host=p.ssh_host,
                    remote_path=p.remote_path,
                )
                projects[i] = updated
                self._save(projects)
                return updated
        raise ProjectNotFoundError(project_id)

    def touch(self, project_id: str) -> None:
        """Bump last_used_at without other changes."""
        self.update(project_id)

    def delete(self, project_id: str) -> None:
        projects = self._load()
        new = [p for p in projects if p.id != project_id]
        if len(new) == len(projects):
            raise ProjectNotFoundError(project_id)
        self._save(new)
