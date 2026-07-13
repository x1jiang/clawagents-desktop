"""REST endpoints for listing/revoking permission grants per project."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore
from clawagents.gateway.projects_api import router as projects_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(projects_router)
    return TestClient(app)


def _make_project(client: TestClient, tmp_path: Path) -> str:
    root = tmp_path / "p"
    root.mkdir()
    return client.post("/projects", json={"name": "p", "root_path": str(root)}).json()["id"]


def test_list_grants_for_project(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    PermissionGrantStore().add(project_id=pid, path_pattern="src/*.py", scope="write")
    PermissionGrantStore().add(project_id=pid, path_pattern="README.md", scope="write")

    r = client.get(f"/projects/{pid}/permission-grants")
    assert r.status_code == 200
    grants = r.json()
    assert len(grants) == 2
    patterns = {g["path_pattern"] for g in grants}
    assert patterns == {"src/*.py", "README.md"}


def test_list_grants_404_unknown_project(client: TestClient) -> None:
    r = client.get("/projects/does-not-exist/permission-grants")
    assert r.status_code == 404


def test_revoke_single_grant(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    PermissionGrantStore().add(project_id=pid, path_pattern="src/*.py", scope="write")
    PermissionGrantStore().add(project_id=pid, path_pattern="README.md", scope="write")

    r = client.post(
        f"/projects/{pid}/permission-grants/revoke",
        json={"path_pattern": "src/*.py", "scope": "write"},
    )
    assert r.status_code == 200
    remaining = client.get(f"/projects/{pid}/permission-grants").json()
    assert [g["path_pattern"] for g in remaining] == ["README.md"]


def test_revoke_unknown_grant_404(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    r = client.post(
        f"/projects/{pid}/permission-grants/revoke",
        json={"path_pattern": "nope", "scope": "write"},
    )
    assert r.status_code == 404


def test_revoke_all_grants(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    PermissionGrantStore().add(project_id=pid, path_pattern="a", scope="write")
    PermissionGrantStore().add(project_id=pid, path_pattern="b", scope="write")

    r = client.delete(f"/projects/{pid}/permission-grants")
    assert r.status_code == 204
    assert client.get(f"/projects/{pid}/permission-grants").json() == []


def test_add_grant_manually(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    r = client.post(
        f"/projects/{pid}/permission-grants",
        json={"path_pattern": "src/**/*.py", "scope": "write"},
    )
    assert r.status_code == 201
    assert r.json()["path_pattern"] == "src/**/*.py"
    grants = client.get(f"/projects/{pid}/permission-grants").json()
    assert any(g["path_pattern"] == "src/**/*.py" for g in grants)


def test_add_grant_invalid_scope(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    r = client.post(
        f"/projects/{pid}/permission-grants",
        json={"path_pattern": "x", "scope": "garbage"},
    )
    assert r.status_code == 400


def test_add_grant_empty_pattern(client: TestClient, tmp_path: Path) -> None:
    pid = _make_project(client, tmp_path)
    r = client.post(
        f"/projects/{pid}/permission-grants",
        json={"path_pattern": "  ", "scope": "write"},
    )
    assert r.status_code == 400


def test_add_grant_unknown_project_404(client: TestClient) -> None:
    r = client.post(
        "/projects/missing/permission-grants",
        json={"path_pattern": "x", "scope": "write"},
    )
    assert r.status_code == 404


def test_grants_isolated_per_project(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    pid_a = client.post("/projects", json={"name": "a", "root_path": str(tmp_path / "a")}).json()["id"]
    pid_b = client.post("/projects", json={"name": "b", "root_path": str(tmp_path / "b")}).json()["id"]

    PermissionGrantStore().add(project_id=pid_a, path_pattern="a-only", scope="write")
    PermissionGrantStore().add(project_id=pid_b, path_pattern="b-only", scope="write")

    a_grants = client.get(f"/projects/{pid_a}/permission-grants").json()
    b_grants = client.get(f"/projects/{pid_b}/permission-grants").json()
    assert [g["path_pattern"] for g in a_grants] == ["a-only"]
    assert [g["path_pattern"] for g in b_grants] == ["b-only"]
