"""POST /system/reveal-folder — refuses paths outside the allow-list.

The actual `open` subprocess call is patched out so the tests don't open
Finder windows on the developer's machine.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.projects_api import router as projects_router
from clawagents.gateway.system_api import router as system_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(system_router)
    return TestClient(app)


def test_reveal_app_support_ok(client: TestClient, app_support_dir: Path) -> None:
    with patch("clawagents.gateway.system_api.subprocess.Popen") as popen:
        with patch("clawagents.gateway.system_api.platform.system", return_value="Darwin"):
            r = client.post("/system/reveal-folder", json={"path": str(app_support_dir)})
    assert r.status_code == 200
    popen.assert_called_once()


def test_reveal_project_root_ok(
    client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    client.post("/projects", json={"name": "p", "root_path": str(root)})
    with patch("clawagents.gateway.system_api.subprocess.Popen"):
        with patch("clawagents.gateway.system_api.platform.system", return_value="Darwin"):
            r = client.post("/system/reveal-folder", json={"path": str(root)})
    assert r.status_code == 200


def test_reveal_arbitrary_path_403(client: TestClient, tmp_path: Path) -> None:
    rogue = tmp_path / "rogue"
    rogue.mkdir()
    with patch("clawagents.gateway.system_api.platform.system", return_value="Darwin"):
        r = client.post("/system/reveal-folder", json={"path": str(rogue)})
    assert r.status_code == 403


def test_reveal_nonexistent_path_404(client: TestClient, tmp_path: Path) -> None:
    r = client.post("/system/reveal-folder", json={"path": str(tmp_path / "ghost")})
    assert r.status_code == 404


def test_reveal_non_macos_501(client: TestClient, app_support_dir: Path) -> None:
    with patch("clawagents.gateway.system_api.platform.system", return_value="Linux"):
        r = client.post("/system/reveal-folder", json={"path": str(app_support_dir)})
    assert r.status_code == 501


def test_reveal_well_known_commands(client: TestClient) -> None:
    with patch("clawagents.gateway.system_api.subprocess.Popen"):
        with patch("clawagents.gateway.system_api.platform.system", return_value="Darwin"):
            r = client.post("/system/reveal-well-known", json={"name": "commands"})
    assert r.status_code == 200
    assert "commands" in r.json()["path"]


def test_reveal_well_known_unknown_400(client: TestClient) -> None:
    r = client.post("/system/reveal-well-known", json={"name": "bogus"})
    assert r.status_code == 400
