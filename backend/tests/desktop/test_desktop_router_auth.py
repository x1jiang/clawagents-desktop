"""Shared auth dependency for desktop endpoints."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.desktop_router import require_auth


def _build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/secret")
    def secret(_: None = require_auth()) -> dict:
        return {"ok": True}

    return app


def test_no_key_set_means_no_auth_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    client = TestClient(_build_app())
    assert client.get("/secret").status_code == 200


def test_key_set_requires_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GATEWAY_API_KEY", "secret-xyz")
    client = TestClient(_build_app())
    assert client.get("/secret").status_code == 401
    assert client.get("/secret", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/secret", headers={"Authorization": "Bearer secret-xyz"}).status_code == 200
