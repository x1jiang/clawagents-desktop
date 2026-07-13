"""Project pinning via PATCH /projects/:id."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    return TestClient(app)


def test_new_project_not_pinned(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"; root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    assert p["pinned"] is False


def test_patch_can_pin(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"; root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    r = client.patch(f"/projects/{p['id']}", json={"pinned": True})
    assert r.status_code == 200
    assert r.json()["pinned"] is True


def test_patch_can_unpin(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"; root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    client.patch(f"/projects/{p['id']}", json={"pinned": True})
    client.patch(f"/projects/{p['id']}", json={"pinned": False})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["pinned"] is False


def test_unrelated_patch_preserves_pinned(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"; root.mkdir()
    p = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()
    client.patch(f"/projects/{p['id']}", json={"pinned": True})
    client.patch(f"/projects/{p['id']}", json={"name": "renamed"})
    refreshed = next(x for x in client.get("/projects").json() if x["id"] == p["id"])
    assert refreshed["name"] == "renamed"
    assert refreshed["pinned"] is True
