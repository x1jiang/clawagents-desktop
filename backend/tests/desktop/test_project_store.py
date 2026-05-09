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
