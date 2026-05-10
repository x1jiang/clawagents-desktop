"""PATCH /chats/:id appends a new chat_meta event so updates take precedence
without mutating the append-only JSONL."""

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


def test_patch_title_takes_effect(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "first", "model": "m"}).json()["chat_id"]

    r = client.patch(f"/chats/{cid}", json={"title": "renamed"})
    assert r.status_code == 200
    assert r.json()["title"] == "renamed"

    # Subsequent GET returns the new title
    assert client.get(f"/chats/{cid}").json()["title"] == "renamed"


def test_patch_partial_inherits_other_fields(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(
        f"/projects/{pid}/chats",
        json={"title": "t", "model": "claude-x", "mode": "ask"},
    ).json()["chat_id"]

    client.patch(f"/chats/{cid}", json={"title": "renamed"})
    meta = client.get(f"/chats/{cid}").json()
    assert meta["title"] == "renamed"
    assert meta["model"] == "claude-x"
    assert meta["mode"] == "ask"


def test_patch_unknown_chat_returns_404(client: TestClient) -> None:
    r = client.patch("/chats/nope", json={"title": "x"})
    assert r.status_code == 404
