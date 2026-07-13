"""HTTP surface for projects CRUD."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)  # auth disabled for tests
    app = FastAPI()
    app.include_router(projects_router)
    return TestClient(app)


def test_list_empty(client: TestClient) -> None:
    r = client.get("/projects")
    assert r.status_code == 200
    assert r.json() == []


def test_create_then_list(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    r = client.post("/projects", json={"name": "my-proj", "root_path": str(root)})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    listed = client.get("/projects").json()
    assert [p["id"] for p in listed] == [pid]


def test_create_rejects_missing_root(client: TestClient) -> None:
    r = client.post("/projects", json={"name": "x", "root_path": "/nope/x"})
    assert r.status_code == 400


def test_create_ssh_project(client: TestClient) -> None:
    r = client.post(
        "/projects",
        json={
            "name": "remote-app",
            "root_path": "/home/me/app",
            "kind": "ssh",
            "ssh_host": "bastion",
            "remote_path": "/home/me/app",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "ssh"
    assert body["ssh_host"] == "bastion"
    assert body["remote_path"] == "/home/me/app"
    assert body["root_path"] == "/home/me/app"


def test_upsert_with_fixed_id(client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    fixed = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    r = client.post(
        "/projects",
        json={"id": fixed, "name": "seed", "root_path": str(root)},
    )
    assert r.status_code == 201, r.text
    assert r.json()["id"] == fixed
    r2 = client.post(
        "/projects",
        json={"id": fixed, "name": "seed2", "root_path": str(root)},
    )
    assert r2.status_code == 201
    assert r2.json()["name"] == "seed2"
    assert len(client.get("/projects").json()) == 1


def test_patch_rename(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "old", "root_path": str(tmp_path / "p")}).json()["id"]
    r = client.patch(f"/projects/{pid}", json={"name": "new"})
    assert r.status_code == 200
    assert r.json()["name"] == "new"


def test_delete(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    pid = client.post("/projects", json={"name": "p", "root_path": str(tmp_path / "p")}).json()["id"]
    assert client.delete(f"/projects/{pid}").status_code == 204
    assert client.get("/projects").json() == []


def test_patch_unknown_returns_404(client: TestClient) -> None:
    r = client.patch("/projects/nope", json={"name": "x"})
    assert r.status_code == 404


def test_delete_unknown_returns_404(client: TestClient) -> None:
    r = client.delete("/projects/nope")
    assert r.status_code == 404
