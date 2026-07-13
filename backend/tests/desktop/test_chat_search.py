"""GET /search/chats across all chats."""

from __future__ import annotations

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


def test_search_finds_user_and_assistant_text(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid1 = client.post(f"/projects/{pid}/chats", json={"title": "a"}).json()["chat_id"]
    cid2 = client.post(f"/projects/{pid}/chats", json={"title": "b"}).json()["chat_id"]

    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w1 = SessionWriter(session_id=cid1, session_dir=sessions_dir)
    w1.append("user_message", {"content": "How does authentication work?"})
    w2 = SessionWriter(session_id=cid2, session_dir=sessions_dir)
    w2.write_assistant_message("It uses JWT for authentication tokens.")

    r = client.get("/search/chats?q=authentication")
    assert r.status_code == 200
    hits = r.json()
    assert len(hits) == 2
    assert {h["chat_id"] for h in hits} == {cid1, cid2}
    roles = {h["role"] for h in hits}
    assert roles == {"user", "assistant"}
    for h in hits:
        assert "authentication" in h["snippet"].lower()


def test_search_empty_q_returns_empty(client: TestClient) -> None:
    assert client.get("/search/chats?q=").json() == []


def test_search_no_match(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "a"}).json()["chat_id"]
    SessionWriter(session_id=cid, session_dir=root / ".clawagents" / "sessions").append(
        "user_message", {"content": "anything"}
    )
    assert client.get("/search/chats?q=unmatched-xyz").json() == []


def test_search_includes_snippet_with_ellipsis(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "a"}).json()["chat_id"]
    long_text = "x" * 80 + "TARGET" + "y" * 80
    SessionWriter(
        session_id=cid, session_dir=root / ".clawagents" / "sessions"
    ).append("user_message", {"content": long_text})

    snippet = client.get("/search/chats?q=TARGET").json()[0]["snippet"]
    assert "TARGET" in snippet
    assert snippet.startswith("…")
    assert snippet.endswith("…")
