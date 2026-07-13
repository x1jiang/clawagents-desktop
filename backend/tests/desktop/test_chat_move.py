"""POST /chats/:id/move — relocate a chat between projects/projectless."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.app_paths import projectless_chats_dir, projectless_scratch_dir
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


def test_projectless_to_project(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post("/chats", json={"title": "t"}).json()["chat_id"]
    SessionWriter(session_id=cid, session_dir=projectless_chats_dir()).append(
        "user_message", {"content": "moved"},
    )
    assert (projectless_chats_dir() / f"{cid}.jsonl").exists()
    assert (projectless_scratch_dir() / cid).exists()

    r = client.post(f"/chats/{cid}/move", json={"project_id": pid})
    assert r.status_code == 200
    assert r.json()["moved"] is True
    assert not (projectless_chats_dir() / f"{cid}.jsonl").exists()
    # Scratch dir got cleaned up since it was projectless-only state.
    assert not (projectless_scratch_dir() / cid).exists()
    # Live in the new project list.
    assert any(c["id"] == cid for c in client.get(f"/projects/{pid}/chats").json())


def test_project_to_projectless(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]

    r = client.post(f"/chats/{cid}/move", json={"project_id": None})
    assert r.status_code == 200
    assert r.json()["moved"] is True
    assert any(c["id"] == cid for c in client.get("/chats").json())


def test_no_op_when_already_in_destination(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    cid = client.post(f"/projects/{pid}/chats", json={"title": "t"}).json()["chat_id"]
    r = client.post(f"/chats/{cid}/move", json={"project_id": pid})
    assert r.status_code == 200
    assert r.json()["moved"] is False


def test_move_to_unknown_project_404(client: TestClient, tmp_path: Path) -> None:
    cid = client.post("/chats", json={"title": "t"}).json()["chat_id"]
    r = client.post(f"/chats/{cid}/move", json={"project_id": "ghost"})
    assert r.status_code == 404


def test_move_destination_collision_409(client: TestClient, tmp_path: Path) -> None:
    """Trying to move a chat into a project where a chat with the same id
    already lives must refuse cleanly, never overwrite."""
    rootA = tmp_path / "a"
    rootB = tmp_path / "b"
    rootA.mkdir()
    rootB.mkdir()
    pidA = client.post("/projects", json={"name": "a", "root_path": str(rootA)}).json()["id"]
    pidB = client.post("/projects", json={"name": "b", "root_path": str(rootB)}).json()["id"]
    cid = client.post(f"/projects/{pidA}/chats", json={"title": "t"}).json()["chat_id"]
    # Manually plant a colliding file in pidB.
    from clawagents.desktop_stores.project_store import ProjectStore
    bsessions = Path(ProjectStore().get(pidB).root_path) / ".clawagents" / "sessions"
    bsessions.mkdir(parents=True, exist_ok=True)
    (bsessions / f"{cid}.jsonl").write_text('{"type":"chat_meta","ts":0,"title":"x"}\n')

    r = client.post(f"/chats/{cid}/move", json={"project_id": pidB})
    assert r.status_code == 409
