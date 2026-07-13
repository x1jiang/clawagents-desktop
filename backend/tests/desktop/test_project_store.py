"""ProjectStore: file-backed CRUD over projects.json."""

from __future__ import annotations

from pathlib import Path

import pytest

from clawagents.desktop_stores.project_store import (
    Project,
    ProjectStore,
    ProjectNotFoundError,
)


def test_list_empty_returns_empty(app_support_dir: Path) -> None:
    store = ProjectStore()
    assert store.list() == []


def test_create_persists_to_disk(app_support_dir: Path, tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    store = ProjectStore()
    p = store.create(name="my-proj", root_path=str(root))

    assert p.id
    assert p.name == "my-proj"
    assert p.root_path == str(root)
    assert (app_support_dir / "projects.json").exists()

    # Reload from disk and confirm we read the same record back.
    store2 = ProjectStore()
    listed = store2.list()
    assert len(listed) == 1
    assert listed[0].id == p.id


def test_list_sorted_by_last_used_at_desc(
    app_support_dir: Path, tmp_path: Path
) -> None:
    store = ProjectStore()
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    a = store.create(name="a", root_path=str(tmp_path / "a"), now="2026-01-01T00:00:00Z")
    b = store.create(name="b", root_path=str(tmp_path / "b"), now="2026-02-01T00:00:00Z")

    listed = store.list()
    assert [p.name for p in listed] == ["b", "a"]


def test_update_changes_record(app_support_dir: Path, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    store = ProjectStore()
    p = store.create(name="p", root_path=str(tmp_path / "p"))

    store.update(p.id, name="renamed", default_model="claude-opus-4.7")
    reloaded = ProjectStore().get(p.id)
    assert reloaded.name == "renamed"
    assert reloaded.default_model == "claude-opus-4.7"


def test_delete_removes_record(app_support_dir: Path, tmp_path: Path) -> None:
    (tmp_path / "p").mkdir()
    store = ProjectStore()
    p = store.create(name="p", root_path=str(tmp_path / "p"))

    store.delete(p.id)
    assert store.list() == []


def test_get_missing_raises(app_support_dir: Path) -> None:
    with pytest.raises(ProjectNotFoundError):
        ProjectStore().get("does-not-exist")


def test_create_rejects_nonexistent_root_path(app_support_dir: Path) -> None:
    with pytest.raises(FileNotFoundError):
        ProjectStore().create(name="x", root_path="/this/does/not/exist")


def test_create_ssh_skips_local_exists(app_support_dir: Path) -> None:
    store = ProjectStore()
    p = store.create(
        name="remote",
        root_path="/home/me/code/app",
        kind="ssh",
        ssh_host="jumpbox",
        remote_path="/home/me/code/app",
    )
    assert p.kind == "ssh"
    assert p.ssh_host == "jumpbox"
    assert p.remote_path == "/home/me/code/app"
    assert p.root_path == "/home/me/code/app"
    reloaded = ProjectStore().get(p.id)
    assert reloaded.kind == "ssh"
    assert reloaded.ssh_host == "jumpbox"


def test_create_ssh_requires_host(app_support_dir: Path) -> None:
    with pytest.raises(ValueError, match="ssh_host"):
        ProjectStore().create(
            name="x",
            root_path="/remote/path",
            kind="ssh",
            remote_path="/remote/path",
        )


def test_upsert_preserves_id(app_support_dir: Path, tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    store = ProjectStore()
    fixed = "11111111-2222-3333-4444-555555555555"
    p = store.upsert(id=fixed, name="seeded", root_path=str(root))
    assert p.id == fixed
    again = store.upsert(id=fixed, name="renamed", root_path=str(root))
    assert again.id == fixed
    assert again.name == "renamed"
    assert len(store.list()) == 1


def test_update_preserves_ssh_fields(app_support_dir: Path) -> None:
    store = ProjectStore()
    p = store.create(
        name="remote",
        root_path="/r/path",
        kind="ssh",
        ssh_host="host1",
        remote_path="/r/path",
    )
    updated = store.update(p.id, name="remote2")
    assert updated.kind == "ssh"
    assert updated.ssh_host == "host1"
    assert updated.remote_path == "/r/path"
