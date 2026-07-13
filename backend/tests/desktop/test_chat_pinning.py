"""Chat pinning via PATCH /chats/:id."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def _create(client: TestClient, tmp_path: Path) -> str:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    return client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]


def test_new_chat_is_not_pinned(client: TestClient, tmp_path: Path) -> None:
    cid = _create(client, tmp_path)
    assert client.get(f"/chats/{cid}").json()["pinned"] is False


def test_patch_can_pin(client: TestClient, tmp_path: Path) -> None:
    cid = _create(client, tmp_path)
    r = client.patch(f"/chats/{cid}", json={"pinned": True})
    assert r.status_code == 200
    assert r.json()["pinned"] is True
    # Survives a fresh GET (i.e. persisted).
    assert client.get(f"/chats/{cid}").json()["pinned"] is True


def test_patch_can_unpin(client: TestClient, tmp_path: Path) -> None:
    cid = _create(client, tmp_path)
    client.patch(f"/chats/{cid}", json={"pinned": True})
    client.patch(f"/chats/{cid}", json={"pinned": False})
    assert client.get(f"/chats/{cid}").json()["pinned"] is False


def test_patch_title_keeps_pinned(client: TestClient, tmp_path: Path) -> None:
    """Pinning must not get reset by an unrelated title PATCH."""
    cid = _create(client, tmp_path)
    client.patch(f"/chats/{cid}", json={"pinned": True})
    client.patch(f"/chats/{cid}", json={"title": "renamed"})
    meta = client.get(f"/chats/{cid}").json()
    assert meta["title"] == "renamed"
    assert meta["pinned"] is True
