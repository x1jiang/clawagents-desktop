"""File-backed permission grants ("Allow always for this project" decisions).

v1 is single-process. Writes use atomic_write_text (tempfile + os.replace),
so a crash mid-save leaves the previous valid file in place. Reads tolerate
a corrupt file by returning an empty list.
"""

from __future__ import annotations

import fnmatch
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from clawagents.desktop_stores.app_paths import permissions_file
from clawagents.utils.atomic_write import atomic_write_text


@dataclass(frozen=True)
class PermissionGrant:
    project_id: str
    path_pattern: str
    scope: str  # "read" | "write"
    granted_at: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class PermissionGrantStore:
    def __init__(self) -> None:
        self.path = permissions_file()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> list[PermissionGrant]:
        if not self.path.exists():
            return []
        try:
            return [PermissionGrant(**r) for r in json.loads(self.path.read_text() or "[]")]
        except (json.JSONDecodeError, TypeError):
            return []

    def _save(self, grants: list[PermissionGrant]) -> None:
        atomic_write_text(self.path, json.dumps([asdict(g) for g in grants], indent=2))

    def list(self) -> list[PermissionGrant]:
        return self._load()

    def add(self, *, project_id: str, path_pattern: str, scope: str) -> PermissionGrant:
        g = PermissionGrant(
            project_id=project_id,
            path_pattern=path_pattern,
            scope=scope,
            granted_at=_now_iso(),
        )
        grants = self._load()
        grants.append(g)
        self._save(grants)
        return g

    def match(self, project_id: str, file_path: str, *, scope: str) -> bool:
        for g in self._load():
            if g.project_id != project_id:
                continue
            if g.scope != scope:
                continue
            if fnmatch.fnmatch(file_path, g.path_pattern):
                return True
        return False

    def remove_for_project(self, project_id: str) -> None:
        kept = [g for g in self._load() if g.project_id != project_id]
        self._save(kept)
