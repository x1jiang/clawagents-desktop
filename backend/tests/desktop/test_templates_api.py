"""Templates CRUD endpoint."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.templates_api import router as templates_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(templates_router)
    return TestClient(app)


def test_empty_list(client: TestClient) -> None:
    assert client.get("/templates").json() == []


def test_put_creates_template(client: TestClient) -> None:
    r = client.put("/templates/review", json={"description": "Review", "body": "Review my recent changes."})
    assert r.status_code == 200
    assert r.json()["name"] == "review"
    assert r.json()["description"] == "Review"
    assert "Review my recent changes" in r.json()["body"]


def test_put_overwrites(client: TestClient) -> None:
    client.put("/templates/t", json={"body": "first"})
    client.put("/templates/t", json={"body": "second"})
    t = next(x for x in client.get("/templates").json() if x["name"] == "t")
    assert t["body"] == "second"


def test_invalid_name(client: TestClient) -> None:
    assert client.put("/templates/UPPER", json={"body": "x"}).status_code == 400
    assert client.put("/templates/name with space", json={"body": "x"}).status_code == 400


def test_empty_body_rejected(client: TestClient) -> None:
    assert client.put("/templates/empty", json={"body": "   "}).status_code == 400


def test_delete(client: TestClient) -> None:
    client.put("/templates/gone", json={"body": "x"})
    assert client.delete("/templates/gone").status_code == 204
    assert not any(t["name"] == "gone" for t in client.get("/templates").json())


def test_delete_missing(client: TestClient) -> None:
    assert client.delete("/templates/nope").status_code == 404


def test_listing_alphabetical(client: TestClient) -> None:
    client.put("/templates/zebra", json={"body": "z"})
    client.put("/templates/alpha", json={"body": "a"})
    client.put("/templates/mike",  json={"body": "m"})
    names = [t["name"] for t in client.get("/templates").json()]
    assert names == ["alpha", "mike", "zebra"]
