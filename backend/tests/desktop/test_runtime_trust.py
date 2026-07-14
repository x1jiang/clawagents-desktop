from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.project_store import ProjectStore
from clawagents.desktop_stores.runtime_trust import RuntimeTrustStore
from clawagents.desktop_stores.settings_store import effective_settings
from clawagents.gateway.settings_api import router as settings_router


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(settings_router)
    return TestClient(app)


def test_trust_isolated_by_canonical_project(app_support_dir: Path, tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    store = RuntimeTrustStore()
    store.update(first, {"mcp_trust_workspace": True})
    assert store.load(first).mcp_trust_workspace is True
    assert store.load(second).mcp_trust_workspace is False


def test_gateway_trust_is_bound_to_exact_url(app_support_dir: Path, tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    store = RuntimeTrustStore()
    store.update(project, {
        "base_url": "https://first.example/v1/",
        "trust_custom_base_url": True,
    })
    assert store.is_url_trusted(project, "https://first.example/v1")
    assert not store.is_url_trusted(project, "https://second.example/v1")


def test_legacy_global_grants_are_not_effective(app_support_dir: Path, tmp_path: Path) -> None:
    (app_support_dir / "settings.json").write_text(json.dumps({
        "base_url": "https://first.example/v1",
        "trust_custom_base_url": True,
        "mcp_trust_workspace": True,
        "allow_full_access": True,
    }))
    project = tmp_path / "project"
    project.mkdir()
    settings = effective_settings(project)
    assert settings.trust_custom_base_url is False
    assert settings.mcp_trust_workspace is False
    assert settings.allow_full_access is False


def test_settings_api_requires_scope_and_does_not_reuse_url_approval(
    app_support_dir: Path,
    project_root: Path,
    client: TestClient,
) -> None:
    project = ProjectStore().create(name="one", root_path=str(project_root))
    unscoped = client.patch(
        "/settings/app",
        json={"mcp_trust_workspace": True},
    )
    assert unscoped.status_code == 400

    first = client.patch(
        f"/settings/app?project_id={project.id}",
        json={
            "base_url": "https://first.example/v1",
            "trust_custom_base_url": True,
            "mcp_trust_workspace": True,
        },
    )
    assert first.status_code == 200
    assert first.json()["mcp_trust_workspace"] is True

    second = client.patch(
        f"/settings/app?project_id={project.id}",
        json={"base_url": "https://second.example/v1"},
    )
    assert second.status_code == 400
    assert "Untrusted base_url" in second.json()["detail"]


def test_project_scopes_do_not_share_runtime_grants(
    app_support_dir: Path,
    tmp_path: Path,
    client: TestClient,
) -> None:
    roots = [tmp_path / "one", tmp_path / "two"]
    for root in roots:
        root.mkdir()
    projects = [
        ProjectStore().create(name=root.name, root_path=str(root))
        for root in roots
    ]
    response = client.patch(
        f"/settings/app?project_id={projects[0].id}",
        json={"allow_full_access": True},
    )
    assert response.status_code == 200
    assert client.get(f"/settings/app?project_id={projects[0].id}").json()["allow_full_access"] is True
    assert client.get(f"/settings/app?project_id={projects[1].id}").json()["allow_full_access"] is False


def test_projectless_chat_children_share_the_stable_scope(app_support_dir: Path) -> None:
    parent = app_support_dir / "scratch"
    child = parent / "chat-123"
    child.mkdir(parents=True)
    RuntimeTrustStore().update(parent, {"allow_full_access": True})
    assert RuntimeTrustStore().load(child).allow_full_access is True


def test_concurrent_updates_do_not_overwrite_another_grant(
    app_support_dir: Path,
    project_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clawagents.desktop_stores.runtime_trust as trust_module

    original_write = trust_module.atomic_write_text
    first_write_ready = threading.Event()
    release_first = threading.Event()
    calls = 0

    def delayed_write(path: Path, content: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            first_write_ready.set()
            assert release_first.wait(2)
        original_write(path, content)

    monkeypatch.setattr(trust_module, "atomic_write_text", delayed_write)
    store = RuntimeTrustStore()
    first = threading.Thread(target=lambda: store.update(project_root, {"mcp_trust_workspace": True}))
    second = threading.Thread(target=lambda: store.update(project_root, {"allow_full_access": True}))
    first.start()
    assert first_write_ready.wait(2)
    second.start()
    release_first.set()
    first.join(2)
    second.join(2)
    assert not first.is_alive() and not second.is_alive()
    record = store.load(project_root)
    assert record.mcp_trust_workspace is True
    assert record.allow_full_access is True


def test_ssh_scope_fails_before_global_preferences_are_saved(
    app_support_dir: Path,
    client: TestClient,
) -> None:
    project = ProjectStore().create(
        name="remote",
        root_path="/remote/workspace",
        kind="ssh",
        ssh_host="example",
        remote_path="/remote/workspace",
    )
    response = client.patch(
        f"/settings/app?project_id={project.id}",
        json={"theme": "dark", "allow_full_access": True},
    )
    assert response.status_code == 400
    assert client.get("/settings/app").json()["theme"] == "system"
