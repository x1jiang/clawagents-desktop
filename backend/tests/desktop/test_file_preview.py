"""GET /projects/:id/files/preview returns a bounded file preview."""

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
    (root / "src" / "main.py").write_text("def main():\n    print('hello')\n")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    return pid, root


def test_preview_returns_content(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    r = client.get(f"/projects/{pid}/files/preview", params={"path": "src/main.py"})
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == "src/main.py"
    assert "print('hello')" in body["content"]
    assert body["truncated"] is False
    assert body["binary"] is False


def test_preview_truncates_long_file(client: TestClient, tmp_path: Path) -> None:
    pid, root = _make(client, tmp_path)
    big = "x" * 20_000
    (root / "big.txt").write_text(big)
    r = client.get(f"/projects/{pid}/files/preview", params={"path": "big.txt"})
    assert r.status_code == 200
    body = r.json()
    assert body["truncated"] is True
    assert len(body["content"]) < 20_000
    assert body["size"] == 20_000


def test_preview_rejects_traversal(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    r = client.get(f"/projects/{pid}/files/preview", params={"path": "../../etc/passwd"})
    assert r.status_code == 400


def test_preview_404_missing_file(client: TestClient, tmp_path: Path) -> None:
    pid, _ = _make(client, tmp_path)
    assert client.get(f"/projects/{pid}/files/preview", params={"path": "nope.py"}).status_code == 404


def test_preview_binary_marker(client: TestClient, tmp_path: Path) -> None:
    pid, root = _make(client, tmp_path)
    (root / "blob.bin").write_bytes(b"\x00\x01\x02\xff\xfe")
    r = client.get(f"/projects/{pid}/files/preview", params={"path": "blob.bin"})
    assert r.status_code == 200
    assert r.json()["binary"] is True
    assert r.json()["content"] == "(binary file)"


def test_preview_404_unknown_project(client: TestClient) -> None:
    assert client.get("/projects/missing/files/preview", params={"path": "x"}).status_code == 404


def test_content_read_write_round_trip(client: TestClient, tmp_path: Path) -> None:
    pid, root = _make(client, tmp_path)
    (root / "note.txt").write_text("hello\n", encoding="utf-8")

    r = client.get(f"/projects/{pid}/files/content", params={"path": "note.txt"})
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "hello\n"
    assert body["writable"] is True

    w = client.put(
        f"/projects/{pid}/files/content",
        json={"path": "note.txt", "content": "edited\n"},
    )
    assert w.status_code == 200
    assert (root / "note.txt").read_text(encoding="utf-8") == "edited\n"
