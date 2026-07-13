"""GET /backup/export + POST /backup/import roundtrip."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.app_paths import (
    projectless_chats_dir,
    user_commands_dir,
)
from clawagents.gateway.backup_api import router as backup_router
from clawagents.gateway.chats_api import router as chats_router
from clawagents.gateway.commands_api import router as commands_router
from clawagents.gateway.projects_api import router as projects_router
from clawagents.session.persistence import SessionWriter


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(chats_router)
    app.include_router(commands_router)
    app.include_router(backup_router)
    return TestClient(app)


def _seed(client: TestClient, tmp_path: Path) -> tuple[str, str, str]:
    """Create one project chat, one projectless chat, one custom command."""
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    pchat = client.post(f"/projects/{pid}/chats", json={"title": "project chat"}).json()["chat_id"]
    pless = client.post("/chats", json={"title": "projectless"}).json()["chat_id"]
    # Write content into each chat.
    SessionWriter(session_id=pchat, session_dir=root / ".clawagents" / "sessions").append(
        "user_message", {"content": "from project chat"}
    )
    SessionWriter(session_id=pless, session_dir=projectless_chats_dir()).append(
        "user_message", {"content": "from projectless"}
    )
    client.put("/commands/my-cmd", json={"description": "test", "body": "do the thing"})
    return pid, pchat, pless


def test_export_returns_zip(client: TestClient, tmp_path: Path) -> None:
    _seed(client, tmp_path)
    r = client.get("/backup/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/zip")
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert "projects.json" in names
    assert any(n.startswith("chats/") and n.endswith(".jsonl") for n in names)
    assert any(n.startswith("project_chats/") and n.endswith(".jsonl") for n in names)
    assert any(n == "commands/my-cmd.md" for n in names)


def test_export_then_import_roundtrip(
    client: TestClient, tmp_path: Path, app_support_dir: Path
) -> None:
    pid, pchat, pless = _seed(client, tmp_path)
    backup = client.get("/backup/export").content

    # Wipe local state: delete the chats + the command.
    client.delete(f"/chats/{pchat}")
    client.delete(f"/chats/{pless}")
    client.delete("/commands/my-cmd")

    # Sanity check: state really is gone.
    assert not any(c["id"] == pchat for c in client.get(f"/projects/{pid}/chats").json())
    assert not any(c["id"] == pless for c in client.get("/chats").json())
    assert not any(c["name"] == "my-cmd" for c in client.get("/commands").json())

    # Restore.
    r = client.post("/backup/import", files={"file": ("b.zip", backup, "application/zip")})
    assert r.status_code == 200
    counts = r.json()
    assert counts["ok"] is True
    assert counts["chats_restored"] >= 2
    assert counts["commands_restored"] >= 1

    # Verify state came back.
    assert any(c["id"] == pchat for c in client.get(f"/projects/{pid}/chats").json())
    assert any(c["id"] == pless for c in client.get("/chats").json())
    assert any(c["name"] == "my-cmd" for c in client.get("/commands").json())


def test_import_invalid_zip_400(client: TestClient) -> None:
    r = client.post("/backup/import", files={"file": ("bad.zip", b"not a zip", "application/zip")})
    assert r.status_code == 400


def test_import_skips_unknown_project_chats(
    client: TestClient, tmp_path: Path, app_support_dir: Path
) -> None:
    """If the archive contains chats for a project id we don't have, they're
    silently skipped (no home to put them in)."""
    # Build a synthetic archive that mentions a fake project id.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("project_chats/nonexistent/chat-xyz.jsonl", '{"type":"user_message","content":"ghost"}\n')
    r = client.post("/backup/import", files={"file": ("b.zip", buf.getvalue(), "application/zip")})
    assert r.status_code == 200
    # No chats restored — the project wasn't there.
    assert r.json()["chats_restored"] == 0
