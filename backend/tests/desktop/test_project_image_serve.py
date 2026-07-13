"""GET /projects/{pid}/files/serve streams raw image bytes for `<img>` use.

Path-jailed inside the project root, extension allow-listed (no `.docx`
exfil channel), token-in-URL accepted because `<img>` can't add headers.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# Minimal valid 1x1 PNG so we don't depend on PIL just for tests.
def _tiny_png() -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CLAWAGENTS_DESKTOP_APP_SUPPORT", str(tmp_path / "appsupport"))
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    from clawagents.gateway.server import create_app
    app, _llm, _model = create_app()
    return TestClient(app)


def _seed_project_with_image(client: TestClient, tmp_path: Path, name: str = "img.png") -> tuple[str, Path]:
    root = tmp_path / "proj"
    root.mkdir()
    img = root / name
    img.write_bytes(_tiny_png())
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    return pid, root


def test_serve_png_returns_image_bytes(client: TestClient, tmp_path: Path) -> None:
    pid, _root = _seed_project_with_image(client, tmp_path)
    r = client.get(f"/projects/{pid}/files/serve?path=img.png")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_serve_rejects_non_image_extension(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    (root / "secret.docx").write_bytes(b"PK\x03\x04 fake docx")
    pid = client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]
    r = client.get(f"/projects/{pid}/files/serve?path=secret.docx")
    assert r.status_code == 415


def test_serve_rejects_path_escape(client: TestClient, tmp_path: Path) -> None:
    pid, _root = _seed_project_with_image(client, tmp_path)
    r = client.get(f"/projects/{pid}/files/serve?path=../etc/passwd")
    assert r.status_code == 400


def test_serve_unknown_project(client: TestClient) -> None:
    r = client.get("/projects/does-not-exist/files/serve?path=foo.png")
    assert r.status_code == 404


def test_serve_missing_file(client: TestClient, tmp_path: Path) -> None:
    pid, _root = _seed_project_with_image(client, tmp_path)
    r = client.get(f"/projects/{pid}/files/serve?path=nope.png")
    assert r.status_code == 404


def test_serve_accepts_query_token(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When GATEWAY_API_KEY is set, header-OR-query-token both unlock the endpoint."""
    # Seed BEFORE we lock auth so project creation doesn't 401.
    pid, _root = _seed_project_with_image(client, tmp_path)
    monkeypatch.setenv("GATEWAY_API_KEY", "secret")
    # Without auth → 401.
    r = client.get(f"/projects/{pid}/files/serve?path=img.png")
    assert r.status_code == 401
    # With query token → 200.
    r = client.get(f"/projects/{pid}/files/serve?path=img.png&token=secret")
    assert r.status_code == 200
    # With header → 200.
    r = client.get(f"/projects/{pid}/files/serve?path=img.png", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200
    # With wrong token → 401.
    r = client.get(f"/projects/{pid}/files/serve?path=img.png&token=wrong")
    assert r.status_code == 401
