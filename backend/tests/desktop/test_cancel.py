"""POST /chats/:id/cancel sets the per-chat cancel event."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import clawagents.gateway.chats_api as chats_api
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def test_cancel_known_chat(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    # Force-create the cancel event so we can observe state.
    chats_api._cancel_events.setdefault(cid, asyncio.Event())

    r = client.post(f"/chats/{cid}/cancel")
    assert r.status_code == 200
    assert chats_api._cancel_events[cid].is_set()


def test_cancel_unknown_chat_returns_404(client: TestClient) -> None:
    assert client.post("/chats/nope/cancel").status_code == 404


def test_cancel_is_idempotent(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    assert client.post(f"/chats/{cid}/cancel").status_code == 200
    assert client.post(f"/chats/{cid}/cancel").status_code == 200  # second call also OK
