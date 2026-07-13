"""Soft-delete via DELETE /chats/:id; restore via POST /chats/:id/restore."""

from __future__ import annotations

import time
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
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    SessionWriter(session_id=cid, session_dir=sessions_dir).append(
        "user_message", {"content": "save me"},
    )
    return pid, cid, sessions_dir


def test_delete_moves_to_trash(client: TestClient, tmp_path: Path) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    assert (sessions_dir / f"{cid}.jsonl").exists()

    r = client.delete(f"/chats/{cid}")
    assert r.status_code == 204
    assert not (sessions_dir / f"{cid}.jsonl").exists()
    trash = sessions_dir / ".trash"
    assert trash.exists()
    assert any(p.name.startswith(f"{cid}-") for p in trash.glob("*.jsonl"))

    # The chat no longer shows up in the live list.
    chats = client.get(f"/projects/{pid}/chats").json()
    assert not any(c["id"] == cid for c in chats)


def test_restore_brings_back_chat(client: TestClient, tmp_path: Path) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    client.delete(f"/chats/{cid}")

    r = client.post(f"/chats/{cid}/restore")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert (sessions_dir / f"{cid}.jsonl").exists()
    # Live again
    chats = client.get(f"/projects/{pid}/chats").json()
    assert any(c["id"] == cid for c in chats)
    # The user_message content survived round-trip.
    msgs = client.get(f"/chats/{cid}/messages").json()
    assert any(m["role"] == "user" and "save me" in m["content"] for m in msgs)


def test_restore_unknown_id_404(client: TestClient, tmp_path: Path) -> None:
    # Build a project so the trash search has somewhere to look.
    _make(client, tmp_path)
    r = client.post("/chats/never-existed/restore")
    assert r.status_code == 404


def test_restore_when_live_exists_409(client: TestClient, tmp_path: Path) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    client.delete(f"/chats/{cid}")
    # Recreate a chat with the same id by directly writing the JSONL.
    SessionWriter(session_id=cid, session_dir=sessions_dir).append(
        "user_message", {"content": "different copy"},
    )
    r = client.post(f"/chats/{cid}/restore")
    assert r.status_code == 409


def test_list_trash(client: TestClient, tmp_path: Path) -> None:
    pid, cid, _ = _make(client, tmp_path)
    client.delete(f"/chats/{cid}")
    items = client.get("/trash/chats").json()
    assert any(item["chat_id"] == cid for item in items)


def test_empty_trash_removes_everything(client: TestClient, tmp_path: Path) -> None:
    pid, cid, _ = _make(client, tmp_path)
    client.delete(f"/chats/{cid}")
    assert len(client.get("/trash/chats").json()) >= 1
    r = client.delete("/trash/chats")
    assert r.status_code == 204
    assert client.get("/trash/chats").json() == []


def test_old_trash_purged_on_next_delete(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pid, cid, sessions_dir = _make(client, tmp_path)
    client.delete(f"/chats/{cid}")
    # Backdate the trash file beyond the 30-day retention.
    trash = sessions_dir / ".trash"
    old = next(iter(trash.glob("*.jsonl")))
    old_mtime = time.time() - 40 * 24 * 60 * 60
    import os as _os
    _os.utime(old, (old_mtime, old_mtime))

    # Create + delete another chat to trigger purge.
    cid2 = client.post(f"/projects/{pid}/chats", json={"title": "t2"}).json()["chat_id"]
    SessionWriter(session_id=cid2, session_dir=sessions_dir).append(
        "user_message", {"content": "x"},
    )
    client.delete(f"/chats/{cid2}")

    # The 40-day-old trash file is gone.
    remaining = list(trash.glob("*.jsonl"))
    assert old.name not in {p.name for p in remaining}
