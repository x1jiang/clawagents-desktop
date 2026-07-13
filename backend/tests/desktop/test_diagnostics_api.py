"""GET /diagnostics exposes safe-to-read app/gateway info."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.commands_api import router as commands_router
from clawagents.gateway.diagnostics_api import router as diagnostics_router
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    app.include_router(commands_router)
    app.include_router(diagnostics_router)
    return TestClient(app)


def test_basic_shape(client: TestClient) -> None:
    body = client.get("/diagnostics").json()
    assert "backend_version" in body
    assert "python_version" in body
    assert "platform" in body
    assert "app_support_dir" in body
    assert "counts" in body
    assert body["counts"]["projects"] == 0
    assert body["providers_with_env_keys"] == []


def test_reflects_projects_and_keys(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "p"
    root.mkdir()
    client.post("/projects", json={"name": "p", "root_path": str(root)})
    monkeypatch.setenv("OPENAI_API_KEY", "x")

    body = client.get("/diagnostics").json()
    assert body["counts"]["projects"] == 1
    assert "openai" in body["providers_with_env_keys"]


def test_counts_commands_and_templates(
    client: TestClient, app_support_dir: Path
) -> None:
    client.put("/commands/foo", json={"body": "hi"})
    body = client.get("/diagnostics").json()
    assert body["counts"]["custom_commands"] >= 1


def test_external_tools_section(client: TestClient) -> None:
    body = client.get("/diagnostics").json()
    tools = body.get("external_tools")
    assert tools is not None, "external_tools field missing"
    # We don't pin which tools are present (CI vs. dev machines differ) — just
    # the shape: the well-known names get bool-valued entries.
    for name in (
        "pandoc",
        "git",
        "python3",
        "node",
        "ffmpeg",
        "pdftotext",
        "pdftoppm",
        "tesseract",
    ):
        assert name in tools
        assert isinstance(tools[name], bool)
