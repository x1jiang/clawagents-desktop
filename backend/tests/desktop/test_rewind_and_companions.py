"""Desktop catch-up: rewind API + companion diagnostics smoke tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.diagnostics_api import router as diagnostics_router
from clawagents.gateway.rewind_api import router as rewind_router


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    monkeypatch.setattr(
        "clawagents.desktop_stores.settings_store.settings_file",
        lambda: tmp_path / "settings.json",
    )
    app = FastAPI()
    app.include_router(diagnostics_router)
    app.include_router(rewind_router)
    return TestClient(app)


def test_diagnostics_includes_companions(client: TestClient) -> None:
    resp = client.get("/diagnostics")
    assert resp.status_code == 200
    data = resp.json()
    assert "companions" in data
    assert "ensure_companions" in data
    assert isinstance(data["companions"], list)


def test_rewind_list_empty_workspace(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    resp = client.get("/rewind", params={"root_path": str(root)})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ok") is True
    assert data.get("snapshots") == []


def test_ensure_companions_respects_setting(client: TestClient) -> None:
    from clawagents.desktop_stores.settings_store import AppSettings, SettingsStore

    SettingsStore().save(AppSettings(ensure_companions=False))
    resp = client.post("/diagnostics/ensure-companions", json={"force": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("skipped") is True
