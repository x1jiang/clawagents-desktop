"""POST /chats/:id/fork clones a chat into a new id with [fork] prefix."""

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


def _make(client: TestClient, tmp_path: Path) -> tuple[str, str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "Orig"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    w.append("user_message", {"content": "hello"})
    w.write_assistant_message("hi back")
    return pid, cid, sessions_dir


def test_fork_creates_independent_chat(client: TestClient, tmp_path: Path) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    r = client.post(f"/chats/{cid}/fork")
    assert r.status_code == 201
    fork_id = r.json()["chat_id"]
    assert fork_id != cid

    # Both chats have the same content history.
    orig = client.get(f"/chats/{cid}/messages").json()
    fork = client.get(f"/chats/{fork_id}/messages").json()
    assert [(m["role"], m["content"]) for m in fork] == [(m["role"], m["content"]) for m in orig]


def test_fork_title_prefix(client: TestClient, tmp_path: Path) -> None:
    pid, cid, _ = _make(client, tmp_path)
    fork_id = client.post(f"/chats/{cid}/fork").json()["chat_id"]
    fork_meta = client.get(f"/chats/{fork_id}").json()
    assert fork_meta["title"] == "[fork] Orig"


def test_fork_does_not_double_prefix(client: TestClient, tmp_path: Path) -> None:
    pid, cid, _ = _make(client, tmp_path)
    fork_id = client.post(f"/chats/{cid}/fork").json()["chat_id"]
    fork2_id = client.post(f"/chats/{fork_id}/fork").json()["chat_id"]
    assert client.get(f"/chats/{fork2_id}").json()["title"] == "[fork] Orig"


def test_forked_chat_changes_do_not_affect_source(client: TestClient, tmp_path: Path) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    fork_id = client.post(f"/chats/{cid}/fork").json()["chat_id"]
    # Mutate the fork only.
    SessionWriter(session_id=fork_id, session_dir=sessions_dir).append(
        "user_message", {"content": "fork-only message"}
    )
    orig = client.get(f"/chats/{cid}/messages").json()
    fork = client.get(f"/chats/{fork_id}/messages").json()
    assert len(fork) == len(orig) + 1
    assert all("fork-only message" not in m["content"] for m in orig)


def test_fork_unknown_chat_404(client: TestClient) -> None:
    assert client.post("/chats/does-not-exist/fork").status_code == 404


def test_fork_appears_in_chat_list(client: TestClient, tmp_path: Path) -> None:
    pid, cid, _ = _make(client, tmp_path)
    fork_id = client.post(f"/chats/{cid}/fork").json()["chat_id"]
    chats = client.get(f"/projects/{pid}/chats").json()
    ids = [c["id"] for c in chats]
    assert cid in ids and fork_id in ids
