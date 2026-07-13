"""GET /projects/:id/tree returns a directory tree with noise dirs filtered."""

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


def _make(client: TestClient, tmp_path: Path) -> tuple[str, Path]:
    root = tmp_path / "p"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text("x")
    (root / "src" / "lib").mkdir()
    (root / "src" / "lib" / "helpers.py").write_text("x")
    (root / "README.md").write_text("readme")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "junk.js").write_text("x")
    (root / ".git").mkdir()
    pid = client.post("/projects", json={"name": "demo", "root_path": str(root)}).json()["id"]
    return pid, root


def test_tree_root_has_friendly_name(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    tree = client.get(f"/projects/{pid}/tree").json()
    assert tree["name"] == "demo"
    assert tree["type"] == "dir"


def test_tree_filters_noisy_dirs(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    tree = client.get(f"/projects/{pid}/tree").json()
    names = [c["name"] for c in tree["children"]]
    assert "node_modules" not in names
    assert ".git" not in names


def test_tree_directories_sorted_before_files(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    tree = client.get(f"/projects/{pid}/tree").json()
    # demo/ → [src (dir), README.md (file)]
    types = [c["type"] for c in tree["children"]]
    assert types == sorted(types, key=lambda t: 0 if t == "dir" else 1)


def test_tree_recursive(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    tree = client.get(f"/projects/{pid}/tree").json()
    src = next(c for c in tree["children"] if c["name"] == "src")
    assert src["type"] == "dir"
    src_children = [c["name"] for c in src["children"]]
    assert "lib" in src_children
    lib = next(c for c in src["children"] if c["name"] == "lib")
    assert any(c["name"] == "helpers.py" for c in lib["children"])


def test_tree_404_unknown_project(client: TestClient) -> None:
    assert client.get("/projects/nope/tree").status_code == 404
