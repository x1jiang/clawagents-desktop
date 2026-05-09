"""HTTP surface for chats CRUD (project + projectless), no streaming yet."""

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


@pytest.fixture()
def project_id(client: TestClient, tmp_path: Path) -> str:
    (tmp_path / "p").mkdir()
    return client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]


def test_create_project_chat_then_list(client: TestClient, project_id: str) -> None:
    r = client.post(f"/projects/{project_id}/chats", json={"title": "first", "model": "m", "mode": "auto"})
    assert r.status_code == 201, r.text
    cid = r.json()["chat_id"]

    listed = client.get(f"/projects/{project_id}/chats").json()
    assert [c["id"] for c in listed] == [cid]
    assert listed[0]["title"] == "first"


def test_create_projectless_chat(client: TestClient) -> None:
    r = client.post("/chats", json={"title": "scratch", "model": "m"})
    assert r.status_code == 201, r.text
    cid = r.json()["chat_id"]

    listed = client.get("/chats").json()
    assert [c["id"] for c in listed] == [cid]


def test_get_chat_metadata(client: TestClient, project_id: str) -> None:
    cid = client.post(
        f"/projects/{project_id}/chats", json={"title": "t", "model": "m"}
    ).json()["chat_id"]
    r = client.get(f"/chats/{cid}")
    assert r.status_code == 200
    assert r.json()["id"] == cid
    assert r.json()["title"] == "t"


def test_get_messages_returns_empty_for_new_chat(client: TestClient, project_id: str) -> None:
    cid = client.post(
        f"/projects/{project_id}/chats", json={"title": "t", "model": "m"}
    ).json()["chat_id"]
    r = client.get(f"/chats/{cid}/messages")
    assert r.status_code == 200
    assert r.json() == []


def test_delete_project_chat(client: TestClient, project_id: str) -> None:
    cid = client.post(
        f"/projects/{project_id}/chats", json={"title": "t", "model": "m"}
    ).json()["chat_id"]
    assert client.delete(f"/chats/{cid}").status_code == 204
    assert client.get(f"/projects/{project_id}/chats").json() == []


def test_delete_projectless_chat_removes_scratch(
    client: TestClient, app_support_dir: Path
) -> None:
    cid = client.post("/chats", json={"title": "x"}).json()["chat_id"]
    scratch = app_support_dir / "scratch" / cid
    assert scratch.exists()
    client.delete(f"/chats/{cid}")
    assert not scratch.exists()


def test_create_chat_falls_back_to_settings_default_mode(
    client: TestClient, app_support_dir: Path
) -> None:
    """If neither body nor project specifies mode, settings.default_mode wins.

    Projectless chats hardcode read_only as the safe default and ignore
    settings.default_mode — confirm that's what we see, and that the
    default_model fallback DID propagate.
    """
    from clawagents.desktop_stores.settings_store import AppSettings, SettingsStore

    SettingsStore().save(AppSettings(default_mode="ask", default_model="claude-x"))
    cid = client.post("/chats", json={"title": "no-mode"}).json()["chat_id"]
    meta = client.get(f"/chats/{cid}").json()
    assert meta["mode"] == "read_only"
    assert meta["model"] == "claude-x"


def test_create_project_chat_uses_project_default_mode(
    client: TestClient, project_id: str
) -> None:
    """When body.mode is unset, project.default_mode wins over settings."""
    client.patch(f"/projects/{project_id}", json={"default_mode": "ask", "default_model": "p-model"})
    cid = client.post(f"/projects/{project_id}/chats", json={"title": "no-mode"}).json()["chat_id"]
    meta = client.get(f"/chats/{cid}").json()
    assert meta["mode"] == "ask"
    assert meta["model"] == "p-model"
