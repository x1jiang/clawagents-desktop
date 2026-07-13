"""GET /chats/:id/export.json — programmatic chat export."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.session.persistence import SessionWriter


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    return TestClient(app)


def test_export_json_shape(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Demo", "model": "gpt-4o-mini"}).json()["chat_id"]

    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "hi"})
    w.write_assistant_message("hi back")

    r = client.get(f"/chats/{cid}/export.json")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert f'filename="{cid}.json"' in r.headers["content-disposition"]
    body = r.json()
    assert body["meta"]["title"] == "Demo"
    assert body["meta"]["model"] == "gpt-4o-mini"
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "assistant"]
    # Round-trips through json.dumps without error.
    json.dumps(body)


def test_export_json_unknown_404(client: TestClient) -> None:
    assert client.get("/chats/nope/export.json").status_code == 404
