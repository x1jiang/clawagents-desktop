"""Regression: patch_app_settings did a read-modify-write on SettingsStore
with no lock. `def` FastAPI routes run on a threadpool, so two concurrent
PATCH /settings/app calls could both load() the same base snapshot, mutate
independent fields, and save() -- whichever finished last silently discarded
the other's change (a classic lost update). settings_store_lock now guards
the whole load -> mutate -> save sequence.
"""

from __future__ import annotations

import threading
import time

import pytest

from clawagents.desktop_stores.settings_store import SettingsStore
from clawagents.gateway.settings_api import AppSettingsPatchBody, patch_app_settings


def test_concurrent_patches_to_different_fields_both_survive(
    tmp_path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("CLAWAGENTS_DESKTOP_APP_SUPPORT", str(tmp_path / "ClawAgentsDesktop"))

    # Widen the load -> save window so two real OS threads reliably overlap
    # inside the critical section (proves the LOCK, not luck, prevents the
    # lost update).
    real_load = SettingsStore.load

    def slow_load(self):
        settings = real_load(self)
        time.sleep(0.05)
        return settings

    monkeypatch.setattr(SettingsStore, "load", slow_load)

    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def patch_theme():
        try:
            barrier.wait(timeout=2)
            patch_app_settings(AppSettingsPatchBody(theme="dark"))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    def patch_effort():
        try:
            barrier.wait(timeout=2)
            patch_app_settings(AppSettingsPatchBody(reasoning_effort="high"))
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    t1 = threading.Thread(target=patch_theme)
    t2 = threading.Thread(target=patch_effort)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not errors, f"unexpected errors: {errors}"

    final = SettingsStore().load()
    assert final.theme == "dark", "lost update: theme patch was silently discarded"
    assert final.reasoning_effort == "high", "lost update: reasoning_effort patch was silently discarded"


def test_settings_store_lock_is_reentrant_rlock():
    """RLock (not Lock) is required: patch_app_settings's critical section
    calls RuntimeTrustStore().update(...) and store.save(...) internally;
    an ordinary Lock would deadlock if any nested code path re-enters."""
    from clawagents.desktop_stores.settings_store import settings_store_lock

    acquired_twice = settings_store_lock.acquire(timeout=1)
    try:
        assert acquired_twice
        assert settings_store_lock.acquire(timeout=1), "must be reentrant"
        settings_store_lock.release()
    finally:
        settings_store_lock.release()
