"""create_app() must wire the four new desktop routers."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from clawagents.gateway.server import create_app


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app, _, _ = create_app()
    return TestClient(app)


def test_projects_route_mounted(client: TestClient) -> None:
    assert client.get("/projects").status_code == 200


def test_chats_route_mounted(client: TestClient) -> None:
    assert client.get("/chats").status_code == 200


def test_providers_route_mounted(client: TestClient) -> None:
    assert client.get("/providers").status_code == 200


def test_legacy_health_still_mounted(client: TestClient) -> None:
    """Sanity: the original /health endpoint still works alongside new routers."""
    assert client.get("/health").status_code == 200
