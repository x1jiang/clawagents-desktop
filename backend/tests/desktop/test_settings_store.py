"""SettingsStore: simple JSON-backed app settings."""

from __future__ import annotations

from pathlib import Path

from clawagents.desktop_stores.settings_store import AppSettings, SettingsStore


def test_load_defaults(app_support_dir: Path) -> None:
    s = SettingsStore().load()
    assert s == AppSettings()
    assert s.default_mode == "auto"


def test_save_and_reload(app_support_dir: Path) -> None:
    SettingsStore().save(AppSettings(default_model="claude-opus-4.7", theme="dark"))
    s2 = SettingsStore().load()
    assert s2.default_model == "claude-opus-4.7"
    assert s2.theme == "dark"
    assert s2.default_mode == "auto"  # unchanged default
