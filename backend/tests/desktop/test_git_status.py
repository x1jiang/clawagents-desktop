"""GET /projects/:id/git/status reads the project root via git CLI."""

from __future__ import annotations

import subprocess
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


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        env={"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", "HOME": str(cwd), "PATH": "/usr/bin:/bin:/usr/local/bin"},
    )


def test_not_a_repo(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    body = client.get(f"/projects/{pid}/git/status").json()
    assert body["is_repo"] is False


def test_clean_repo(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    _git(root, "init", "-b", "main")
    (root / "f.txt").write_text("hello\n")
    _git(root, "add", ".")
    _git(root, "commit", "-m", "init")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    body = client.get(f"/projects/{pid}/git/status").json()
    assert body["is_repo"] is True
    assert body["branch"] == "main"
    assert body["diff"] == ""


def test_dirty_repo_returns_diff(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    _git(root, "init", "-b", "main")
    (root / "f.txt").write_text("hello\n")
    _git(root, "add", ".")
    _git(root, "commit", "-m", "init")
    # Modify
    (root / "f.txt").write_text("hello\nworld\n")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    body = client.get(f"/projects/{pid}/git/status").json()
    assert body["is_repo"] is True
    assert "+world" in body["diff"]


def test_unknown_project_404(client: TestClient) -> None:
    assert client.get("/projects/nope/git/status").status_code == 404
