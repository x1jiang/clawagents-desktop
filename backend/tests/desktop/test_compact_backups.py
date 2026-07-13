"""/chats/:id/compact/backups + /compact/restore — recovery from /compact."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

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


def _seed_and_compact(client: TestClient, tmp_path: Path) -> tuple[str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t", "model": "gpt-4o-mini"}).json()["chat_id"]
    sessions_dir = root / ".clawagents" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    w = SessionWriter(session_id=cid, session_dir=sessions_dir)
    for i in range(4):
        w.append("user_message", {"content": f"q{i}"})
        w.write_assistant_message(f"a{i}")

    fake_resp = type("R", (), {"content": "compacted summary"})()
    fake_provider = type("P", (), {"chat": AsyncMock(return_value=fake_resp)})()
    with patch("clawagents.providers.llm.create_provider", return_value=fake_provider):
        client.post(f"/chats/{cid}/compact")
    return cid, sessions_dir


def test_backups_endpoint_lists_files(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _seed_and_compact(client, tmp_path)
    backups = client.get(f"/chats/{cid}/compact/backups").json()
    assert len(backups) >= 1
    assert backups[0]["filename"].startswith(cid)
    assert backups[0]["size"] > 0


def test_restore_replaces_jsonl(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _seed_and_compact(client, tmp_path)
    # After /compact the messages collapsed to 1 user + 1 assistant pair.
    assert len(client.get(f"/chats/{cid}/messages").json()) == 2

    backups = client.get(f"/chats/{cid}/compact/backups").json()
    suffix = backups[0]["suffix"]
    r = client.post(f"/chats/{cid}/compact/restore", json={"suffix": suffix})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert "before-restore" in r.json()["safety_backup"]
    # Restoration brought back the pre-compact history.
    assert len(client.get(f"/chats/{cid}/messages").json()) > 2


def test_restore_unknown_suffix_404(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _seed_and_compact(client, tmp_path)
    r = client.post(f"/chats/{cid}/compact/restore", json={"suffix": "9999999"})
    assert r.status_code == 404


def test_restore_rejects_traversal_in_suffix(client: TestClient, tmp_path: Path) -> None:
    cid, _ = _seed_and_compact(client, tmp_path)
    r = client.post(f"/chats/{cid}/compact/restore", json={"suffix": "../../etc/passwd"})
    assert r.status_code == 400
