"""Project-scoped runtime approvals.

Runtime authority is deliberately kept out of the application-wide settings
file.  Records are keyed by a digest of the canonical workspace root so a
renamed project record continues to refer to the same on-disk workspace.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path
from typing import Any, Mapping

from clawagents.desktop_stores.app_paths import projectless_scratch_dir, runtime_trust_file
from clawagents.utils.atomic_write import atomic_write_text


def normalize_url(value: str | None) -> str:
    return (value or "").strip().rstrip("/")


_store_lock = threading.RLock()


def canonical_project_root(project_root: str | Path) -> Path:
    canonical = Path(project_root).expanduser().resolve(strict=True)
    projectless = projectless_scratch_dir().resolve()
    try:
        canonical.relative_to(projectless)
        return projectless
    except ValueError:
        return canonical


def _project_key(project_root: str | Path) -> str:
    canonical = str(canonical_project_root(project_root))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RuntimeTrust:
    trusted_base_url: str = ""
    mcp_trust_workspace: bool = False
    allow_full_access: bool = False
    allow_external_skill_dirs: bool = False

    @property
    def trust_custom_base_url(self) -> bool:
        return bool(self.trusted_base_url)


class RuntimeTrustStore:
    _FIELDS = {field.name for field in fields(RuntimeTrust)}

    def __init__(self) -> None:
        self.path = runtime_trust_file()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load_all(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text() or "{}")
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(value, dict):
            return {}
        return {str(k): v for k, v in value.items() if isinstance(v, dict)}

    def load(self, project_root: str | Path) -> RuntimeTrust:
        with _store_lock:
            try:
                raw = self._load_all().get(_project_key(project_root), {})
            except (OSError, RuntimeError):
                return RuntimeTrust()
            clean = {name: raw[name] for name in self._FIELDS if name in raw}
            try:
                return RuntimeTrust(**clean)
            except TypeError:
                return RuntimeTrust()

    def update(
        self,
        project_root: str | Path,
        changes: Mapping[str, Any],
    ) -> RuntimeTrust:
        with _store_lock:
            key = _project_key(project_root)
            current = self.load(project_root)
            clean: dict[str, Any] = {}
            for name, value in changes.items():
                if name == "base_url":
                    continue
                if name == "trust_custom_base_url":
                    if not value:
                        clean["trusted_base_url"] = ""
                    elif "base_url" in changes:
                        clean["trusted_base_url"] = normalize_url(str(changes["base_url"]))
                    continue
                if name == "trusted_base_url":
                    clean[name] = normalize_url(str(value))
                elif name in self._FIELDS:
                    clean[name] = bool(value)
            updated = replace(current, **clean)
            records = self._load_all()
            records[key] = asdict(updated)
            atomic_write_text(self.path, json.dumps(records, indent=2, sort_keys=True))
            return updated

    def is_url_trusted(self, project_root: str | Path, url: str | None) -> bool:
        approved = self.load(project_root).trusted_base_url
        return bool(approved) and approved == normalize_url(url)
