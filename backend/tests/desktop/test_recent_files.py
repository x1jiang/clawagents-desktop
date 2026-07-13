"""GET /projects/:id/files/recent — most-recently-modified files first."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    return TestClient(app)


def test_returns_files_by_mtime_desc(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "older.py").write_text("x")
    older_mtime = time.time() - 300
    os.utime(root / "older.py", (older_mtime, older_mtime))
    (root / "newer.py").write_text("y")

    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    files = client.get(f"/projects/{pid}/files/recent").json()
    paths = [f["path"] for f in files]
    assert paths.index("newer.py") < paths.index("older.py")


def test_skips_noise_dirs(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "node_modules").mkdir()
    (root / "node_modules" / "junk.js").write_text("x")
    (root / "real.py").write_text("y")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    paths = [f["path"] for f in client.get(f"/projects/{pid}/files/recent").json()]
    assert "real.py" in paths
    assert not any("node_modules" in p for p in paths)


def test_404_unknown(client: TestClient) -> None:
    assert client.get("/projects/unknown/files/recent").status_code == 404
