"""File-backed AppSettings.

Atomic writes via atomic_write_text. Corrupt JSON returns defaults.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from clawagents.desktop_stores.app_paths import settings_file
from clawagents.utils.atomic_write import atomic_write_text


@dataclass
class AppSettings:
    default_model: str = ""
    default_mode: str = "auto"  # ExecMode wire value
    theme: str = "system"       # "light" | "dark" | "system"


class SettingsStore:
    def __init__(self) -> None:
        self.path = settings_file()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> AppSettings:
        if not self.path.exists():
            return AppSettings()
        try:
            data = json.loads(self.path.read_text() or "{}")
        except json.JSONDecodeError:
            return AppSettings()
        return AppSettings(**{k: v for k, v in data.items() if k in AppSettings.__dataclass_fields__})

    def save(self, settings: AppSettings) -> None:
        atomic_write_text(self.path, json.dumps(asdict(settings), indent=2))
