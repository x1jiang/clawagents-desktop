"""DELETE /chats/:id must prune the per-chat cancel event from the registry."""

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


def test_delete_prunes_cancel_event(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    # Force-create the cancel event (as a running turn would)
    chats_api._cancel_events[cid] = asyncio.Event()
    assert cid in chats_api._cancel_events

    assert client.delete(f"/chats/{cid}").status_code == 204
    assert cid not in chats_api._cancel_events
