"""GET /projects/:id/files for @-mention autocomplete."""

from __future__ import annotations

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


def test_lists_project_files(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text("x")
    (root / "README.md").write_text("readme")

    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    files = client.get(f"/projects/{pid}/files").json()
    paths = {f["path"] for f in files}
    assert "src/main.py" in paths
    assert "README.md" in paths


def test_skips_noisy_dirs(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "node_modules").mkdir()
    (root / "node_modules" / "junk.js").write_text("x")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("x")
    (root / ".venv").mkdir()
    (root / ".venv" / "lib.py").write_text("x")
    (root / "src.py").write_text("x")

    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    files = client.get(f"/projects/{pid}/files").json()
    paths = {f["path"] for f in files}
    assert "src.py" in paths
    assert not any("node_modules" in p for p in paths)
    assert not any(".git" in p for p in paths)
    assert not any(".venv" in p for p in paths)


def test_filter_query(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "alpha.py").write_text("x")
    (root / "beta.py").write_text("x")
    (root / "gamma.txt").write_text("x")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]

    files = client.get(f"/projects/{pid}/files?q=al").json()
    paths = [f["path"] for f in files]
    assert paths == ["alpha.py"]


def test_404_unknown_project(client: TestClient) -> None:
    assert client.get("/projects/does-not-exist/files").status_code == 404


def test_dotfile_and_dotdir_skipped(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / ".env").write_text("x")
    (root / ".secret").mkdir()
    (root / ".secret" / "private.txt").write_text("x")
    (root / "regular.py").write_text("x")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    files = client.get(f"/projects/{pid}/files").json()
    paths = {f["path"] for f in files}
    assert "regular.py" in paths
    assert ".env" not in paths
    assert not any(p.startswith(".secret") for p in paths)
