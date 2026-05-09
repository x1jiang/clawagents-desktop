"""File-backed CRUD for desktop Project records."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
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
    created_at: str = ""
    last_used_at: str = ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
            return [Project(**r) for r in raw]
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
        now: str | None = None,
    ) -> Project:
        if not Path(root_path).exists():
            raise FileNotFoundError(root_path)
        ts = now or _now_iso()
        p = Project(
            id=str(uuid.uuid4()),
            name=name,
            root_path=root_path,
            default_model=default_model,
            default_mode=default_mode,
            created_at=ts,
            last_used_at=ts,
        )
        projects = self._load()
        projects.append(p)
        self._save(projects)
        return p

    def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        default_model: str | None = None,
        default_mode: str | None = None,
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
                    created_at=p.created_at,
                    last_used_at=_now_iso(),
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
